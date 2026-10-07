"use client";

import { useEffect, useState } from "react";
import { STATUS_LABEL, formatEvery } from "@/lib/format";
import { externalBrowserUrl, type InAppBrowser } from "@/lib/inapp";
import { REPEAT_CHOICES, type RepeatPref } from "@/lib/remind";
import type { DigestEvery, DigestPref } from "@/lib/schedule";
import { BellIcon, StateIcon } from "./icons";
import type { Prefs, PushApi } from "./usePush";

const EVERY_LABEL: Record<DigestEvery, string> = {
  "1h": "ทุกชั่วโมง",
  "3h": "ทุก 3 ชั่วโมง",
  "6h": "ทุก 6 ชั่วโมง",
  daily: "วันละครั้ง",
  off: "ไม่รับข่าวตามรอบ",
};

const pad = (h: number) => `${String(h).padStart(2, "0")}:00 น.`;

function digestSummary(d: DigestPref) {
  if (d.every === "off") return "ไม่รับข่าวตามรอบ";
  if (d.every === "daily") return `ข่าวระดับน้ำทุกวัน ${pad(d.dailyHour)}`;
  return `ข่าวระดับน้ำ${EVERY_LABEL[d.every]}`;
}

/** Every device gets these; only the reminders after them can be changed. */
const ALERT_SUMMARY = "เตือนทันทีเมื่อน้ำถึงระดับเฝ้าระวังและอันตราย";

/** "เตือนซ้ำทุก 10 นาทีจนน้ำลด", naming the levels only when they repeat differently. */
function repeatSummary(r: RepeatPref) {
  if (!r.watch && !r.danger) return "ไม่เตือนซ้ำ";
  if (r.watch === r.danger) return `เตือนซ้ำ${formatEvery(r.danger)}จนน้ำลด`;
  if (!r.danger) return `เตือนซ้ำเฉพาะระดับเฝ้าระวัง ${formatEvery(r.watch)}`;
  if (!r.watch) return `เตือนซ้ำเฉพาะระดับอันตราย ${formatEvery(r.danger)}`;
  return `เตือนซ้ำระดับเฝ้าระวัง${formatEvery(r.watch)} อันตราย${formatEvery(r.danger)}`;
}

const repeatLabel = (minutes: number) => (minutes ? formatEvery(minutes) : "ไม่เตือนซ้ำ");

function Message({ push }: { push: PushApi }) {
  return (
    <p className="status-line" role="status" data-tone={push.message?.tone}>
      {push.message?.text}
    </p>
  );
}

const APP_NAME: Record<InAppBrowser, string> = { line: "LINE", facebook: "Facebook", instagram: "Instagram", other: "แอปนี้" };

/** Opened from a chat app: get the visitor into the phone's own browser, where push works. */
function InAppHelp({ push }: { push: PushApi }) {
  const { ios, inApp } = push.platform;
  const [copied, setCopied] = useState<"ok" | "bad" | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied("ok");
    } catch {
      setCopied("bad");
    }
  };

  return (
    <div className="notice">
      <strong>
        {APP_NAME[inApp as InAppBrowser]} เปิดหน้านี้ในเบราว์เซอร์ของแอป ซึ่งรับการแจ้งเตือนจากเว็บไม่ได้
      </strong>
      <p style={{ marginTop: 8 }}>
        {ios
          ? "เปิดหน้านี้ใน Safari ก่อน แล้วเพิ่มลงหน้าจอโฮมและกดเปิดการแจ้งเตือนจากไอคอนนั้น"
          : "เปิดหน้านี้ใน Chrome หรือเบราว์เซอร์หลักของเครื่องก่อน แล้วกดเปิดการแจ้งเตือนที่นั่น"}
      </p>
      {inApp === "line" && (
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginTop: 12 }}
          onClick={() => window.location.assign(externalBrowserUrl(window.location.href))}
        >
          {ios ? "เปิดใน Safari" : "เปิดในเบราว์เซอร์ของเครื่อง"}
        </button>
      )}
      <ol className="steps">
        <li>{inApp === "line" ? "ถ้าปุ่มไม่ทำงาน แตะปุ่มเมนูหรือปุ่มแชร์ที่มุมจอ" : "แตะปุ่มเมนูหรือปุ่มแชร์ที่มุมจอ"}</li>
        <li>เลือก {ios ? "เปิดใน Safari" : "เปิดในเบราว์เซอร์"}</li>
      </ol>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={copy}>
          คัดลอกลิงก์
        </button>
      </div>
      <p className="status-line" role="status" data-tone={copied === "bad" ? "bad" : undefined}>
        {copied === "ok" && `คัดลอกแล้ว วางในแถบที่อยู่ของ ${ios ? "Safari" : "เบราว์เซอร์"} ได้เลย`}
        {copied === "bad" && "คัดลอกไม่ได้ในแอปนี้ ใช้ปุ่มเมนูของแอปแทน"}
      </p>
    </div>
  );
}

/** iPhone lets no web app ring through a Focus such as Do Not Disturb or Sleep. */
function FocusNote() {
  return (
    <p className="notice" data-tone="warn" style={{ marginBottom: 24 }}>
      <strong>iPhone: การเตือนจะไม่ดังระหว่างโหมดโฟกัส</strong> เช่น ห้ามรบกวน หรือ นอนหลับ เพราะ iPhone
      ไม่ยอมให้เว็บส่งการแจ้งเตือนที่ดังทะลุโหมดเหล่านี้ ถ้าต้องการให้การเตือนภัยดังตอนกลางคืน ให้เพิ่มแอป
      น้ำท่าน้ำนนท์ ในรายการแอปที่อนุญาต: การตั้งค่า &gt; โฟกัส &gt; เลือกโหมดที่ใช้ &gt; แอป
    </p>
  );
}

/** First-viewport control: one tap to subscribe, or a summary once subscribed. */
export function NotifyCta({ push }: { push: PushApi }) {
  const { phase, prefs } = push;

  if (phase === "on" && prefs) {
    return (
      <div>
        <p className="facts" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0 }}>
          <BellIcon />
          <span>
            <strong>แจ้งเตือนเปิดอยู่:</strong>{" "}
            {[digestSummary(prefs.digest), ALERT_SUMMARY, repeatSummary(prefs.repeat)].join(" · ")}{" "}
            <a href="#notify">ปรับการแจ้งเตือน</a>
          </span>
        </p>
      </div>
    );
  }

  if (phase === "in-app" && push.platform.inApp) return <InAppHelp push={push} />;

  if (phase === "ios-install") {
    return (
      <div className="notice">
        <strong>iPhone และ iPad ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อนจึงจะรับการแจ้งเตือนได้</strong>
        <ol className="steps">
          <li>แตะปุ่มแชร์ในแถบของ Safari</li>
          <li>เลือก เพิ่มไปยังหน้าจอโฮม</li>
          <li>เปิดแอปจากหน้าจอโฮม แล้วกดเปิดการแจ้งเตือน</li>
        </ol>
        <p className="quiet" style={{ marginTop: 8 }}>ใช้ได้กับ iOS 16.4 ขึ้นไป</p>
      </div>
    );
  }

  if (phase === "unsupported") {
    return (
      <p className="notice">
        เบราว์เซอร์นี้รับการแจ้งเตือนจากเว็บไม่ได้ ลองเปิดด้วย Chrome, Edge, Firefox หรือ Safari รุ่นใหม่
      </p>
    );
  }

  if (phase === "denied") {
    return (
      <p className="notice" data-tone="warn">
        เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ เปิดได้ที่ไอคอนหน้าที่อยู่เว็บ เลือกการแจ้งเตือนเป็นอนุญาต แล้วโหลดหน้านี้ใหม่
      </p>
    );
  }

  if (phase === "error") {
    return (
      <p className="notice" data-tone="warn">
        ตรวจสอบสถานะการแจ้งเตือนไม่สำเร็จ โหลดหน้านี้ใหม่แล้วลองอีกครั้ง
      </p>
    );
  }

  const busy = phase === "working" || phase === "checking";
  return (
    <div>
      <button type="button" className="btn btn--primary" onClick={push.subscribe} disabled={busy} aria-busy={busy}>
        <BellIcon />
        {phase === "working" ? "กำลังเปิดการแจ้งเตือน…" : "เปิดการแจ้งเตือน"}
      </button>
      <p className="facts quiet" style={{ marginTop: 8 }}>
        ได้ข่าวระดับน้ำทุกเช้า 07:00 น. เตือนทันทีเมื่อน้ำถึงระดับเฝ้าระวังและอันตราย และเตือนซ้ำจนน้ำลด ปรับได้หลังเปิด
      </p>
      <Message push={push} />
    </div>
  );
}

/** Full preferences, shown once this device is subscribed. */
export function NotifySettings({ push, provisional }: { push: PushApi; provisional?: boolean }) {
  const mark = provisional ? " (เกณฑ์ชั่วคราว)" : "";
  const { phase, prefs } = push;

  if (phase !== "on" || !prefs) {
    return (
      <div className="facts">
        <p>
          กดปุ่มเปิดการแจ้งเตือนครั้งเดียว เครื่องนี้จะได้ข่าวระดับน้ำตามรอบที่เลือก และได้รับเตือนทันทีเมื่อน้ำถึงเกณฑ์
          โดยไม่ต้องสมัครสมาชิกหรือกรอกข้อมูลใดๆ
        </p>
        <p className="quiet" style={{ marginTop: 8 }}>
          ระบบอ่านค่าจากกล้องทุก 10 นาที การเตือนภัยจึงมาถึงช้าสุดราว 10 นาทีหลังน้ำถึงเกณฑ์
        </p>
      </div>
    );
  }

  const set = (patch: Partial<Prefs>) => push.update({ ...prefs, ...patch });
  const setDigest = (patch: Partial<DigestPref>) => set({ digest: { ...prefs.digest, ...patch } });
  const repeatSelect = (level: keyof RepeatPref) => (
    <label className="inline-select">
      <span className="repeat-level" data-level={level}>
        <StateIcon status={level} size={18} cut="var(--ground)" />
        ระดับ{STATUS_LABEL[level]}
      </span>
      <select value={prefs.repeat[level]} onChange={(e) => set({ repeat: { ...prefs.repeat, [level]: Number(e.target.value) } })}>
        {REPEAT_CHOICES[level].map((m) => (
          <option key={m} value={m}>
            {repeatLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <fieldset className="field">
        <legend>ข่าวระดับน้ำตามรอบ</legend>
        <div className="choices">
          {(["1h", "3h", "6h", "daily", "off"] as DigestEvery[]).map((v) => (
            <label key={v} className="choice">
              <input
                type="radio"
                name="every"
                value={v}
                checked={prefs.digest.every === v}
                onChange={() => setDigest({ every: v })}
              />
              <span>{EVERY_LABEL[v]}</span>
            </label>
          ))}
        </div>
        {prefs.digest.every === "daily" && (
          <label className="inline-select">
            <span>ส่งเวลา</span>
            <select value={prefs.digest.dailyHour} onChange={(e) => setDigest({ dailyHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>เตือนซ้ำจนกว่าน้ำจะลด</legend>
        <p className="hint">
          ทุกเครื่องได้เตือนทันทีเมื่อน้ำถึงระดับเฝ้าระวังและระดับอันตราย ระดับละ 1 ครั้ง{mark}{" "}
          จากนั้นส่งซ้ำตามรอบที่เลือกจนน้ำลดต่ำกว่าเกณฑ์ และแจ้งอีกครั้งเมื่อน้ำลด
        </p>
        {repeatSelect("watch")}
        {repeatSelect("danger")}
      </fieldset>

      {push.platform.ios && <FocusNote />}

      <fieldset className="field">
        <legend>ช่วงเวลาไม่รบกวน</legend>
        <label className="choices choice">
          <input
            type="checkbox"
            checked={prefs.digest.quiet !== null}
            onChange={(e) => setDigest({ quiet: e.target.checked ? { start: 22, end: 6 } : null })}
          />
          <span>
            งดข่าวตามรอบช่วง 22:00 ถึง 06:00 น.
            <small>งดเตือนซ้ำระดับเฝ้าระวังด้วย ส่วนการเตือนภัยและเตือนซ้ำระดับอันตรายยังส่งตามปกติ</small>
          </span>
        </label>
      </fieldset>

      <div className="btn-row">
        <button type="button" className="btn" onClick={push.sendTest}>
          ส่งการแจ้งเตือนทดสอบ
        </button>
        <UnsubscribeButton onConfirm={push.unsubscribe} />
      </div>
      <Message push={push} />
    </form>
  );
}

/** Turning alerts off is the one destructive action here, so it asks for a second tap. */
function UnsubscribeButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className="btn btn--quiet" onClick={() => setArmed(true)}>
        ปิดการแจ้งเตือนในเครื่องนี้
      </button>
    );
  }
  return (
    <>
      <button type="button" className="btn" onClick={onConfirm} style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
        ยืนยัน ปิดการแจ้งเตือน
      </button>
      <button type="button" className="btn btn--quiet" onClick={() => setArmed(false)}>
        ไม่ปิด
      </button>
    </>
  );
}
