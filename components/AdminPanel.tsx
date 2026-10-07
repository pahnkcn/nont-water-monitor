"use client";

import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { Thresholds } from "@/lib/alerts";
import { MAX_REFS, type TrackingStatus } from "@/lib/autotrack";
import type { SiteConfig } from "@/lib/config";
import { REASON_LABEL, STATUS_LABEL, describeMove, formatDateTime } from "@/lib/format";
import type { GaugeConfig } from "@/lib/gauge-config";
import { MAX_SUSPECTS } from "@/lib/jump";
import type { SiteState, SnapshotMeta, Suspect } from "@/lib/store";
import type { PushProblem } from "@/lib/push";
import { IDENTITY, applyTransform } from "@/lib/track";
import { pushSubscription } from "./usePush";

type AdminData = {
  config: SiteConfig;
  state: SiteState;
  snapshot: SnapshotMeta | null;
  subscribers: number;
  refs: { t: number; meanLuma: number }[];
  push: { subject: string | null; problems: PushProblem[] };
  suspects: Suspect[];
};

const PUSH_PROBLEM: Record<PushProblem, string> = {
  "public-key": "ยังไม่ได้ตั้ง VAPID_PUBLIC_KEY",
  "private-key": "ยังไม่ได้ตั้ง VAPID_PRIVATE_KEY",
  "subject-missing": "ยังไม่ได้ตั้ง VAPID_SUBJECT",
  "subject-format": "VAPID_SUBJECT ต้องขึ้นต้นด้วย https:// หรือ mailto: ไม่อย่างนั้น iPhone จะไม่ได้รับการแจ้งเตือน",
  "subject-localhost": "VAPID_SUBJECT เป็น localhost ซึ่ง iPhone ไม่รับ",
};
/** `near` puts the status line next to the section the action came from. */
type Msg = { text: string; tone: "ok" | "bad"; near?: "track" } | null;

const KEY = "nont-admin";

const TRACK_LABEL: Record<TrackingStatus, string> = {
  learning: "รอเก็บภาพอ้างอิงจากรอบที่อ่านได้ชัด",
  ok: "ตามไม้วัดได้ปกติ",
  moved: "กล้องเพิ่งขยับ รอรอบถัดไปยืนยัน",
  lost: "หาไม้วัดในภาพไม่เจอ ระบบหยุดใช้ค่าที่อ่านได้",
  covered: "น้ำท่วมช่วงบนของไม้วัด ใช้ตำแหน่งล่าสุดไปก่อน",
  manual: "ปิดอยู่ อ่านตามเส้นที่ตั้งไว้ด้านล่าง",
};

/** The calibration drawn where the camera has the gauge now, so the overlay and the form match the snapshot. */
function liveGauge(d: AdminData): GaugeConfig {
  const g = applyTransform(d.config.gauge, d.config.autoTrack ? d.state.tracking.transform : IDENTITY);
  return { ...g, marks: g.marks.map((m) => ({ ...m, y: Math.round(m.y * 10) / 10 })) };
}

export function AdminPanel() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [gauge, setGauge] = useState<GaugeConfig | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [pointerY, setPointerY] = useState<number | null>(null);

  const load = useCallback(async (pw: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/config", { headers: { "x-admin-password": pw }, cache: "no-store" });
      if (res.status === 401) throw new Error("รหัสผ่านไม่ถูกต้อง");
      if (!res.ok) throw new Error(`โหลดไม่สำเร็จ (${res.status})`);
      const d = (await res.json()) as AdminData;
      setData(d);
      setThresholds(d.config.thresholds);
      setGauge(liveGauge(d));
      try {
        sessionStorage.setItem(KEY, pw);
      } catch {}
    } catch (e) {
      setData(null);
      setMsg({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {}
    if (saved) {
      const pw = saved;
      Promise.resolve().then(() => {
        setPassword(pw);
        load(pw);
      });
    }
  }, [load]);

  const save = async (
    body: { thresholds?: Thresholds; gauge?: GaugeConfig; autoTrack?: boolean; resetRefs?: boolean },
    done = "บันทึกแล้ว มีผลตั้งแต่รอบอ่านค่าถัดไป",
    near?: "track",
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-admin-password": password },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `บันทึกไม่สำเร็จ (${res.status})`);
      // load() clears the status line, so report after it.
      await load(password);
      setMsg({ text: done, tone: "ok", near });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: "bad", near });
    } finally {
      setBusy(false);
    }
  };

  const tick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/tick", { method: "POST", headers: { "x-admin-password": password } });
      const d = await res.json();
      if (res.status === 409) throw new Error("กำลังอ่านค่ารอบอื่นอยู่ ลองใหม่ในอีกสักครู่");
      if (!res.ok || !d.ok) throw new Error(`อ่านค่าไม่สำเร็จ: ${d.error ?? d.reading?.reason ?? res.status}`);
      const reason = d.reading?.reason ? ` · ${REASON_LABEL[d.reading.reason] ?? d.reading.reason}` : "";
      const read =
        d.reading?.level == null
          ? "อ่านค่าไม่ได้"
          : d.reading.estimate === "below"
            ? `น้ำต่ำกว่าช่วงที่อ่านได้ (ต่ำกว่า ${d.reading.level.toFixed(2)} ม. ตามสเกลไม้วัด)`
            : d.reading.estimate === "covered"
              ? `มีสิ่งบังผิวน้ำ (น้ำต่ำกว่า ${d.reading.level.toFixed(2)} ม. ตามสเกลไม้วัด)`
              : `อ่านได้${d.reading.estimate === "approx" ? "ประมาณ" : ""} ${d.reading.level.toFixed(2)} ม. ตามสเกลไม้วัด`;
      await load(password);
      setMsg({
        text: `${read} (ความมั่นใจ ${d.reading?.confidence ?? "-"}${reason}) · ส่งเตือน ${d.sent.alerts} · เตือนซ้ำ ${d.sent.reminders} · ข่าวตามรอบ ${d.sent.digests} · ถึงผู้ดูแล ${d.sent.system}`,
        tone: d.reading?.level != null ? "ok" : "bad",
      });
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    load(password);
  };

  const onImageMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPointerY(Math.round(((e.clientY - rect.top) / rect.height) * 600));
  };

  if (!data || !thresholds || !gauge) {
    return (
      <form onSubmit={onLogin} className="prose" style={{ maxWidth: 420 }}>
        <h1>ผู้ดูแล</h1>
        <label className="inline-select" style={{ display: "grid", gap: 8 }}>
          <span>รหัสผ่าน (ADMIN_PASSWORD)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{ minHeight: 44, padding: "0 12px", border: "1.5px solid var(--ink)", borderRadius: 2, background: "var(--ground)" }}
          />
        </label>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
          </button>
        </div>
        <p className="status-line" role="status" data-tone={msg?.tone}>
          {msg?.text}
        </p>
      </form>
    );
  }

  const { state } = data;
  const numInput = (label: string, key: keyof Thresholds, step = 0.01) => (
    <label className="inline-select" key={key}>
      <span style={{ minWidth: 180 }}>{label}</span>
      <input
        type="number"
        name={key}
        inputMode="decimal"
        step={step}
        value={thresholds[key]}
        onChange={(e) => setThresholds({ ...thresholds, [key]: Number(e.target.value) })}
        className="num"
        style={{ minHeight: 44, width: 120, padding: "0 12px", border: "1.5px solid var(--ink)", borderRadius: 2, background: "var(--ground)" }}
      />
      <span>ม.</span>
    </label>
  );

  const shiftMeters = (d: number) =>
    setGauge({ ...gauge, marks: gauge.marks.map((m) => ({ ...m, level: Math.round((m.level + d) * 100) / 100 })) });

  return (
    <div style={{ paddingTop: 32, display: "grid", gap: 48 }}>
      <section className="section">
        <div className="section__head">
          <h1 className="section__title">สถานะระบบ</h1>
          <button type="button" className="btn" onClick={tick} disabled={busy}>
            {busy ? "กำลังอ่านค่า…" : "อ่านค่าตอนนี้"}
          </button>
        </div>
        <ul className="facts num">
          <li>สถานะเตือน: {STATUS_LABEL[state.alert.status]}</li>
          <li>
            อ่านล่าสุด:{" "}
            {state.lastRead
              ? `${formatDateTime(state.lastRead.t)} ${state.lastRead.ok ? `${state.lastRead.estimate === "below" || state.lastRead.estimate === "covered" ? "ต่ำกว่า " : state.lastRead.estimate === "approx" ? "ประมาณ " : ""}${state.lastRead.level?.toFixed(2)} ม. (${state.lastRead.confidence})` : `ไม่สำเร็จ: ${REASON_LABEL[state.lastRead.reason ?? ""] ?? state.lastRead.reason}`}`
              : "ยังไม่เคยอ่าน"}
          </li>
          <li>อ่านไม่สำเร็จติดกัน: {state.failureStreak} รอบ</li>
          <li>เครื่องที่เปิดการแจ้งเตือน: {data.subscribers}</li>
          <li>
            การส่งแจ้งเตือน:{" "}
            {data.push.problems.length ? (
              <strong style={{ color: "var(--danger)" }}>{data.push.problems.map((p) => PUSH_PROBLEM[p]).join(" · ")}</strong>
            ) : (
              <>พร้อม (ติดต่อ {data.push.subject})</>
            )}
          </li>
        </ul>
        <p className="status-line" role="status" data-tone={msg?.tone}>
          {msg?.near ? null : msg?.text}
        </p>
      </section>

      <SuspectRounds suspects={data.suspects} password={password} />

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">เกณฑ์การเตือน</h2>
          {data.config.thresholdsArePlaceholders && <p className="section__sub">ยังเป็นค่าชั่วคราว</p>}
        </div>
        <p style={{ marginBottom: 12, fontSize: "0.875rem", color: "var(--ink-2)" }}>
          ค่าตามสเกลไม้วัดเดียวกับตารางจุดเทียบด้านล่าง หน้าเว็บและการแจ้งเตือนไม่แสดงค่านี้ แสดงแค่ระยะห่างจากเกณฑ์เป็น ซม.
        </p>
        {numInput("เฝ้าระวัง ตั้งแต่", "watch")}
        {numInput("อันตราย ตั้งแต่", "danger")}
        {numInput("ระยะกันแจ้งไปมา", "hysteresis")}
        {numInput("เตือนซ้ำทุกครั้งที่สูงขึ้นอีก", "repeatStep")}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => save({ thresholds })} disabled={busy}>
            บันทึกเกณฑ์
          </button>
        </div>
      </section>

      <section className="section" aria-labelledby="track-title">
        <div className="section__head">
          <h2 className="section__title" id="track-title">
            ตามตำแหน่งไม้วัดอัตโนมัติ
          </h2>
          <p className="section__sub">{TRACK_LABEL[data.config.autoTrack ? state.tracking.status : "manual"]}</p>
        </div>
        {data.config.autoTrack && (
          <ul className="facts num">
            {state.tracking.since > 0 && <li>สถานะนี้ตั้งแต่: {formatDateTime(state.tracking.since)}</li>}
            <li>
              เทียบกับเส้นที่ตั้งไว้: {describeMove(IDENTITY, state.tracking.transform) ?? "ตรงกับที่ตั้งไว้"}
            </li>
            <li>
              ภาพตรงกับภาพอ้างอิง: {state.tracking.score === null ? "ยังไม่ได้เทียบ" : state.tracking.score.toFixed(2)}{" "}
              <span className="quiet">(ต่ำกว่า 0.60 ถือว่าหาไม่เจอ)</span>
            </li>
            <li>
              ภาพอ้างอิง: {data.refs.length} จาก {MAX_REFS} ภาพ
              {data.refs.length > 0 && (
                <span className="quiet">
                  {" "}
                  (ความสว่าง {data.refs.map((r) => r.meanLuma).join(", ")} · เก็บล่าสุด {formatDateTime(Math.max(...data.refs.map((r) => r.t)))})
                </span>
              )}
            </li>
          </ul>
        )}
        <fieldset className="field" style={{ marginTop: 16 }}>
          <label className="choices choice">
            <input
              type="checkbox"
              checked={data.config.autoTrack}
              disabled={busy}
              onChange={(e) =>
                save(
                  { autoTrack: e.target.checked },
                  e.target.checked ? "เปิดการตามอัตโนมัติแล้ว มีผลรอบอ่านค่าถัดไป" : "ปิดแล้ว ระบบจะอ่านตามเส้นที่ตั้งไว้เท่านั้น",
                  "track",
                )
              }
            />
            <span>
              ปรับตำแหน่งตามกล้องอัตโนมัติ
              <small>ทุกรอบระบบหาว่ากล้องเลื่อนหรือซูมไปเท่าไร แล้วเลื่อนเส้นขีดตาม ถ้าหาไม่เจอจะหยุดใช้ค่าและแจ้งเครื่องผู้ดูแล</small>
            </span>
          </label>
        </fieldset>
        <p className="facts quiet" style={{ marginBottom: 12 }}>
          ภาพอ้างอิงช่วงกลางวันและกลางคืนระบบเก็บเพิ่มเองเมื่อแสงเปลี่ยน กดเก็บใหม่เมื่อมีของวางถาวรข้างไม้วัดหรือเทศบาลเปลี่ยนกล้อง
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={busy || !data.config.autoTrack}
            onClick={() => save({ resetRefs: true }, "ลบภาพอ้างอิงแล้ว ระบบจะเก็บใหม่จากรอบที่อ่านได้ชัดรอบถัดไป", "track")}
          >
            เก็บภาพอ้างอิงใหม่
          </button>
        </div>
        <p className="status-line" role="status" data-tone={msg?.tone}>
          {msg?.near === "track" ? msg.text : null}
        </p>
        <AdminDevice password={password} />
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">ตำแหน่งไม้วัดในภาพ</h2>
          <p className="section__sub num">ตำแหน่งเมาส์: แถว {pointerY ?? "-"}</p>
        </div>
        <div className="camera" onMouseMove={onImageMove} onMouseLeave={() => setPointerY(null)} style={{ maxWidth: 800 }}>
          {data.snapshot ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of our own snapshot */}
              <img src={`/api/snapshot?t=${data.snapshot.t}`} alt="ภาพล่าสุดที่ระบบอ่าน" width={800} height={600} />
              {gauge.marks.map((m) => (
                <div
                  key={m.y}
                  className="camera__line"
                  style={{ top: `${(m.y / 600) * 100}%`, borderTop: "1px solid rgb(0 255 200 / 0.8)" }}
                >
                  <span className="num" style={{ fontSize: 11, padding: "0 4px" }}>{m.level.toFixed(2)}</span>
                </div>
              ))}
              {data.snapshot.y !== null && (
                <div className="camera__line" style={{ top: `${(data.snapshot.y / 600) * 100}%` }}>
                  <span>
                    {data.snapshot.estimate === "below"
                      ? `ไม่พบน้ำถึงแถวสุดท้ายที่อ่าน (${data.snapshot.y})`
                      : data.snapshot.estimate === "covered"
                        ? `ไม้วัดถูกบังตั้งแต่แถว ${data.snapshot.y} น้ำอยู่ต่ำกว่านั้น`
                      : `ผิวน้ำที่ตรวจพบ แถว ${data.snapshot.y}${data.snapshot.estimate === "approx" ? " (ช่วงล่าง ค่าประมาณ)" : ""}`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="camera__empty">ยังไม่มีภาพ กดอ่านค่าตอนนี้</div>
          )}
        </div>
        <p className="facts quiet" style={{ marginTop: 12 }}>
          เส้นสีฟ้าคือขีดอ้างอิงแต่ละ 10 ซม. วาดตามตำแหน่งที่ระบบตามกล้องได้ล่าสุด ถ้าเลขหลักเมตรผิดทั้งไม้ ใช้ปุ่มเลื่อนสเกล
          ถ้าเส้นไม่ตรงขีดในภาพ แก้ค่าแถวด้านล่าง เมื่อบันทึก ระบบจะเริ่มตามกล้องใหม่จากเส้นชุดนี้
        </p>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => shiftMeters(1)}>
            เลื่อนสเกลขึ้น 1 ม.
          </button>
          <button type="button" className="btn" onClick={() => shiftMeters(-1)}>
            เลื่อนสเกลลง 1 ม.
          </button>
        </div>
        <details className="table-view">
          <summary>แก้ขีดอ้างอิงทีละจุด</summary>
          <table className="readings-table num">
            <thead>
              <tr>
                <th scope="col">แถวในภาพ (px)</th>
                <th scope="col">ระดับ (ม.)</th>
              </tr>
            </thead>
            <tbody>
              {gauge.marks.map((m, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      name={`mark-${i}-y`}
                      inputMode="numeric"
                      aria-label={`แถวของขีด ${m.level.toFixed(2)} ม.`}
                      value={m.y}
                      onChange={(e) =>
                        setGauge({ ...gauge, marks: gauge.marks.map((x, j) => (j === i ? { ...x, y: Number(e.target.value) } : x)) })
                      }
                      style={{ width: 90, minHeight: 36 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      name={`mark-${i}-level`}
                      inputMode="decimal"
                      step={0.01}
                      aria-label={`ระดับของขีดแถว ${m.y}`}
                      value={m.level}
                      onChange={(e) =>
                        setGauge({ ...gauge, marks: gauge.marks.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) } : x)) })
                      }
                      style={{ width: 90, minHeight: 36 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => save({ gauge })} disabled={busy}>
            บันทึกตำแหน่งไม้วัด
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setGauge(liveGauge(data))}>
            ยกเลิกการแก้
          </button>
        </div>
      </section>
    </div>
  );
}

type DevicePhase = "checking" | "unsupported" | "off" | "on" | "working";

/** Lets the admin's own phone receive camera and tracking notices. */
const metres = (s: { level: number; estimate?: Suspect["estimate"] }) =>
  `${s.estimate === "below" || s.estimate === "covered" ? "ต่ำกว่า " : s.estimate === "approx" ? "ประมาณ " : ""}${s.level.toFixed(2)} ม.`;

/** Rounds held back as jumps or read with low confidence, each with the picture the reader saw. */
function SuspectRounds({ suspects, password }: { suspects: Suspect[]; password: string }) {
  const [open, setOpen] = useState<{ t: number; url: string | null; error: string | null } | null>(null);

  // Revoke each picture's object URL once another replaces it or the list closes.
  useEffect(() => {
    const url = open?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [open?.url]);

  const show = async (s: Suspect, i: number) => {
    if (open?.t === s.t) return setOpen(null);
    setOpen({ t: s.t, url: null, error: null });
    try {
      const res = await fetch(`/api/admin/suspects?i=${i}&t=${s.t}`, { headers: { "x-admin-password": password } });
      if (res.status === 404) throw new Error("ภาพนี้ไม่อยู่ในรายการแล้ว มีรอบใหม่เข้ามาแทน โหลดหน้านี้ใหม่");
      if (!res.ok) throw new Error(`โหลดภาพไม่สำเร็จ (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      setOpen((o) => (o?.t === s.t ? { ...o, url } : (URL.revokeObjectURL(url), o)));
    } catch (e) {
      setOpen((o) => (o?.t === s.t ? { ...o, error: (e as Error).message } : o));
    }
  };

  return (
    <section className="section" aria-labelledby="suspects-title">
      <div className="section__head">
        <h2 className="section__title" id="suspects-title">
          รอบที่ค่าน่าสงสัย
        </h2>
        <p className="section__sub">เก็บภาพ {MAX_SUSPECTS} รอบล่าสุด</p>
      </div>
      <p className="facts quiet" style={{ marginBottom: 4 }}>
        รอบที่ค่าต่างจากรอบก่อนเกินกว่าน้ำจะขึ้นลงได้ (ระบบพักค่าไว้ ไม่บันทึกและไม่เตือน จนกว่ารอบถัดไปจะยืนยัน)
        หรือรอบที่อ่านได้ไม่มั่นใจ ดูภาพเพื่อหาว่าอะไรบังไม้วัด
      </p>
      {suspects.length === 0 ? (
        <p className="facts quiet">ยังไม่มีรอบที่น่าสงสัย</p>
      ) : (
        <ul className="log suspects">
          {suspects.map((s, i) => (
            <li key={s.t}>
              <span className="what num">
                {s.reason === "jump"
                  ? `พักไว้ · อ่านได้ ${metres(s)}${s.lastLevel !== null ? ` จากค่าก่อนหน้า ${s.lastLevel.toFixed(2)} ม.` : ""}`
                  : `ไม่มั่นใจ · อ่านได้ ${metres(s)}${s.reason ? ` · ${REASON_LABEL[s.reason] ?? s.reason}` : ""}`}
              </span>
              <span className="when num">
                {formatDateTime(s.t)}
                {s.y !== null && ` · แถว ${s.y}`}
              </span>
              <button type="button" className="btn btn--quiet" aria-expanded={open?.t === s.t} onClick={() => show(s, i)}>
                {open?.t === s.t ? "ซ่อนภาพ" : "ดูภาพ"}
              </button>
              {open?.t === s.t && (
                <div className="camera" style={{ maxWidth: 800 }}>
                  {open.url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- object URL of an admin-only picture */}
                      <img src={open.url} alt={`ภาพรอบ ${formatDateTime(s.t)}`} width={800} height={600} />
                      {s.y !== null && (
                        <div className="camera__line" style={{ top: `${(s.y / 600) * 100}%` }}>
                          <span>ระบบเห็นผิวน้ำที่แถว {s.y}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="camera__empty" role={open.error ? "alert" : "status"}>
                      {open.error ?? "กำลังโหลดภาพ…"}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AdminDevice({ password }: { password: string }) {
  const [phase, setPhase] = useState<DevicePhase>("checking");
  const [note, setNote] = useState<Msg>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPhase("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return void (cancelled || setPhase("off"));
        const res = await fetch("/api/push/me", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        const d = (await res.json()) as { admin?: boolean };
        if (!cancelled) setPhase(d.admin ? "on" : "off");
      } catch {
        if (!cancelled) setPhase("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async () => {
    const on = phase !== "on";
    setPhase("working");
    setNote(null);
    try {
      if (on && (await Notification.requestPermission()) !== "granted") {
        throw new Error("เบราว์เซอร์ยังไม่อนุญาตการแจ้งเตือนของเว็บนี้");
      }
      const { sub, replaced } = await pushSubscription();
      const res = await fetch("/api/admin/notify", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ subscription: sub.toJSON(), on, previousEndpoint: replaced ?? undefined }),
      });
      if (!res.ok) throw new Error(`บันทึกไม่สำเร็จ (${res.status})`);
      const { created } = (await res.json()) as { created?: boolean };
      setPhase(on ? "on" : "off");
      setNote({
        text: on
          ? `เครื่องนี้จะได้รับแจ้งเมื่อกล้องขยับ หาไม้วัดไม่เจอ หรืออ่านค่าไม่ได้ 1 ชั่วโมง${created ? " และได้ข่าวระดับน้ำ 07:00 น. กับการเตือนระดับอันตรายแบบค่าเริ่มต้น ปรับได้ที่หน้าแรก" : ""}`
          : "เครื่องนี้หยุดรับแจ้งเตือนผู้ดูแลแล้ว",
        tone: "ok",
      });
    } catch (e) {
      setPhase(on ? "off" : "on");
      setNote({ text: (e as Error).message, tone: "bad" });
    }
  };

  if (phase === "unsupported") {
    return (
      <p className="notice" style={{ marginTop: 16 }}>
        เบราว์เซอร์นี้รับการแจ้งเตือนไม่ได้ ถ้าเป็น iPhone ให้เพิ่มเว็บลงหน้าจอโฮมแล้วเปิดหน้านี้จากไอคอน
      </p>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="btn-row">
        <button type="button" className="btn" onClick={toggle} disabled={phase === "checking" || phase === "working"} aria-pressed={phase === "on"}>
          {phase === "on" ? "หยุดรับแจ้งเตือนผู้ดูแลบนเครื่องนี้" : "รับแจ้งเตือนผู้ดูแลบนเครื่องนี้"}
        </button>
      </div>
      <p className="status-line" role="status" data-tone={note?.tone}>
        {note?.text ?? (phase === "on" ? "เครื่องนี้รับแจ้งเตือนผู้ดูแลอยู่" : null)}
      </p>
    </div>
  );
}
