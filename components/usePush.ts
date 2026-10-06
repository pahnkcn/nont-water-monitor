"use client";

import { useCallback, useEffect, useState } from "react";
import type { AlertPreference } from "@/lib/alerts";
import { inAppBrowser, type InAppBrowser } from "@/lib/inapp";
import { DEFAULT_REPEAT, type RepeatPref } from "@/lib/remind";
import type { DigestPref } from "@/lib/schedule";

/**
 * `offsetCm` is the personal alert point against the site thresholds (OFFSET_CHOICES);
 * `repeat` the minutes between reminders at each level (REPEAT_CHOICES).
 */
export type Prefs = { digest: DigestPref; alerts: AlertPreference; offsetCm: number; repeat: RepeatPref };

/** Settings as the server returned them; fills what an older response leaves out. */
function toPrefs(d: Partial<Prefs> & Pick<Prefs, "digest" | "alerts">): Prefs {
  return { digest: d.digest, alerts: d.alerts, offsetCm: d.offsetCm ?? 0, repeat: d.repeat ?? DEFAULT_REPEAT };
}

export type Platform = { ios: boolean; inApp: InAppBrowser | null };

export type PushPhase =
  | "checking"
  | "in-app" // opened inside LINE, Facebook and the like: move to the phone's own browser first
  | "unsupported" // browser has no web push
  | "ios-install" // iPhone/iPad Safari: push works only from the Home Screen app
  | "denied" // user blocked notifications for this site
  | "off" // supported, not subscribed
  | "working" // subscribing or unsubscribing
  | "on"
  | "error";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function toBase64Url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * This browser's push subscription for the site's current VAPID key. One made with an older key
 * is replaced, because the push service rejects every message sent to it after the keys change.
 * Needs permission granted. `replaced` is the old endpoint, so the server can carry its settings over.
 */
export async function pushSubscription(): Promise<{ sub: PushSubscription; replaced: string | null }> {
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) throw new Error("ระบบแจ้งเตือนของเว็บยังไม่ได้ตั้งค่า");
  const { key } = (await keyRes.json()) as { key: string };
  const existing = await reg.pushManager.getSubscription();
  const existingKey = existing?.options.applicationServerKey;
  // Browsers that do not report the key get the benefit of the doubt.
  if (existing && (!existingKey || toBase64Url(existingKey) === key)) return { sub: existing, replaced: null };
  if (existing) await existing.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  return { sub, replaced: existing?.endpoint ?? null };
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function usePush() {
  const [phase, setPhase] = useState<PushPhase>("checking");
  const [platform, setPlatform] = useState<Platform>({ ios: false, inApp: null });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const here: Platform = { ios: isIOS(), inApp: inAppBrowser(navigator.userAgent) };
      setPlatform(here);
      if (here.inApp) return setPhase("in-app");
      // Arrived from LINE's "open in browser" link: drop its flag from the address bar.
      const url = new URL(window.location.href);
      if (url.searchParams.has("openExternalBrowser")) {
        url.searchParams.delete("openExternalBrowser");
        window.history.replaceState(null, "", url.href);
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPhase(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const found = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (Notification.permission === "denied") return setPhase("denied");
        if (!found) return setPhase("off");
        // Swap a subscription made with old VAPID keys for a working one; permission is already granted.
        const { sub, replaced } =
          Notification.permission === "granted" ? await pushSubscription() : { sub: found, replaced: null };
        if (cancelled) return;
        const res = replaced
          ? null
          : await post<{ subscribed: boolean } & Partial<Prefs>>("/api/push/me", { endpoint: sub.endpoint });
        if (cancelled) return;
        if (res?.ok && res.data.subscribed && res.data.digest && res.data.alerts) {
          setEndpoint(sub.endpoint);
          setPrefs(toPrefs({ ...res.data, digest: res.data.digest, alerts: res.data.alerts }));
          setPhase("on");
        } else {
          // New subscription, or the server forgot this device: register it, keeping the old settings if any.
          const again = await post<Prefs>("/api/push/subscribe", {
            subscription: sub.toJSON(),
            previousEndpoint: replaced ?? undefined,
          });
          if (cancelled) return;
          if (again.ok) {
            setEndpoint(sub.endpoint);
            setPrefs(toPrefs(again.data));
            setPhase("on");
          } else setPhase("off");
        }
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setMessage(null);
    setPhase("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPhase(permission === "denied" ? "denied" : "off");
        if (permission === "default") setMessage({ text: "ยังไม่ได้กดอนุญาต ลองกดปุ่มอีกครั้ง", tone: "bad" });
        return;
      }
      const { sub, replaced } = await pushSubscription();
      const res = await post<Prefs & { error?: string }>("/api/push/subscribe", {
        subscription: sub.toJSON(),
        previousEndpoint: replaced ?? undefined,
      });
      if (!res.ok) throw new Error(res.status === 503 ? "ผู้รับการแจ้งเตือนเต็มแล้ว" : "บันทึกการสมัครไม่สำเร็จ");
      setEndpoint(sub.endpoint);
      setPrefs(toPrefs(res.data));
      setPhase("on");
      setMessage({ text: "เปิดการแจ้งเตือนแล้ว", tone: "ok" });
    } catch (e) {
      setPhase("off");
      setMessage({ text: `เปิดการแจ้งเตือนไม่สำเร็จ (${(e as Error).message}) ลองกดอีกครั้ง หรือเปิดหน้านี้ด้วยเบราว์เซอร์อื่น`, tone: "bad" });
    }
  }, []);

  const update = useCallback(
    async (next: Prefs) => {
      if (!endpoint) return;
      const previous = prefs;
      setPrefs(next);
      setMessage(null);
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) throw new Error("no subscription");
        const res = await post<Prefs>("/api/push/subscribe", { subscription: sub.toJSON(), ...next });
        if (res.status === 409) {
          setPrefs(previous);
          setMessage({ text: "น้ำสูงเลยจุดนั้นแล้ว เลือกจุดที่สูงกว่าระดับน้ำตอนนี้", tone: "bad" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setPrefs(toPrefs(res.data));
        setMessage({ text: "บันทึกแล้ว", tone: "ok" });
      } catch {
        setPrefs(previous);
        setMessage({ text: "บันทึกไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", tone: "bad" });
      }
    },
    [endpoint, prefs],
  );

  const sendTest = useCallback(async () => {
    if (!endpoint) return;
    setMessage(null);
    const res = await post<{ error?: string }>("/api/push/test", { endpoint });
    if (res.ok) setMessage({ text: "ส่งแล้ว ควรเห็นการแจ้งเตือนภายในไม่กี่วินาที", tone: "ok" });
    else if (res.status === 429) setMessage({ text: "เพิ่งส่งไป รอ 1 นาทีแล้วลองใหม่", tone: "bad" });
    else if (res.status === 410 || res.status === 404) {
      setPhase("off");
      setMessage({ text: "การสมัครหมดอายุ กดเปิดการแจ้งเตือนอีกครั้ง", tone: "bad" });
    } else setMessage({ text: "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง", tone: "bad" });
  }, [endpoint]);

  const unsubscribe = useCallback(async () => {
    setMessage(null);
    setPhase("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEndpoint(null);
      setPrefs(null);
      setPhase("off");
      setMessage({ text: "ปิดการแจ้งเตือนแล้ว เครื่องนี้จะไม่ได้รับข่าวอีก", tone: "ok" });
    } catch {
      setPhase("on");
      setMessage({ text: "ปิดไม่สำเร็จ ลองใหม่อีกครั้ง", tone: "bad" });
    }
  }, []);

  return { phase, platform, prefs, message, subscribe, update, sendTest, unsubscribe };
}

export type PushApi = ReturnType<typeof usePush>;
