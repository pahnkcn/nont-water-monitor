"use client";

import { useEffect, useState } from "react";
import type { AlertPreference } from "@/lib/alerts";
import { cmBetween } from "@/lib/format";
import type { DigestEvery, DigestPref } from "@/lib/schedule";
import { BellIcon } from "./icons";
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

function alertSummary(a: AlertPreference) {
  if (a === "off") return "ไม่รับการเตือนภัย";
  return a === "watch" ? "เตือนทันทีตั้งแต่ระดับเฝ้าระวัง" : "เตือนทันทีเมื่อถึงระดับอันตราย";
}

function Message({ push }: { push: PushApi }) {
  return (
    <p className="status-line" role="status" data-tone={push.message?.tone}>
      {push.message?.text}
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
            <strong>แจ้งเตือนเปิดอยู่:</strong> {digestSummary(prefs.digest)} · {alertSummary(prefs.alerts)}{" "}
            <a href="#notify">ปรับการแจ้งเตือน</a>
          </span>
        </p>
      </div>
    );
  }

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
        ได้ข่าวระดับน้ำทุกเช้า 07:00 น. และเตือนทันทีเมื่อน้ำถึงระดับอันตราย เปลี่ยนรอบได้หลังเปิด
      </p>
      <Message push={push} />
    </div>
  );
}

/** Full preferences, shown once this device is subscribed. */
export function NotifySettings({
  push,
  watch,
  danger,
  provisional,
}: {
  push: PushApi;
  watch: number;
  danger: number;
  provisional?: boolean;
}) {
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
        <legend>เตือนทันทีเมื่อน้ำถึง</legend>
        <p className="hint">ได้แจ้งอีกครั้งเมื่อน้ำลดพ้นระดับที่เคยเตือน</p>
        <div className="choices">
          <label className="choice">
            <input type="radio" name="alerts" checked={prefs.alerts === "watch"} onChange={() => set({ alerts: "watch" })} />
            <span>
              ระดับเฝ้าระวัง
              <small>และระดับอันตราย{mark}</small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="alerts" checked={prefs.alerts === "danger"} onChange={() => set({ alerts: "danger" })} />
            <span>
              ระดับอันตรายเท่านั้น
              <small className="num">
                สูงกว่าระดับเฝ้าระวัง {cmBetween(danger, watch)} ซม.{mark}
              </small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="alerts" checked={prefs.alerts === "off"} onChange={() => set({ alerts: "off" })} />
            <span>
              ไม่รับการเตือนภัย
              <small>รับเฉพาะข่าวตามรอบ</small>
            </span>
          </label>
        </div>
      </fieldset>

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
            <small>การเตือนภัยยังส่งตามปกติ</small>
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
