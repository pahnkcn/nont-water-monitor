"use client";

import { useCallback, useEffect, useState, type FormEvent, type MouseEvent } from "react";
import type { Thresholds } from "@/lib/alerts";
import type { SiteConfig } from "@/lib/config";
import { STATUS_LABEL, formatDateTime } from "@/lib/format";
import type { GaugeConfig } from "@/lib/gauge-config";
import type { SiteState, SnapshotMeta } from "@/lib/store";

type AdminData = { config: SiteConfig; state: SiteState; snapshot: SnapshotMeta | null; subscribers: number };
type Msg = { text: string; tone: "ok" | "bad" } | null;

const KEY = "nont-admin";

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
      setGauge(d.config.gauge);
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

  const save = async (body: { thresholds?: Thresholds; gauge?: GaugeConfig }) => {
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
      setMsg({ text: "บันทึกแล้ว มีผลตั้งแต่รอบอ่านค่าถัดไป", tone: "ok" });
      await load(password);
    } catch (e) {
      setMsg({ text: (e as Error).message, tone: "bad" });
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
      setMsg({
        text: `อ่านได้ ${d.reading?.level?.toFixed(2) ?? "-"} ม. (ความมั่นใจ ${d.reading?.confidence}) ส่งเตือน ${d.sent.alerts} ข่าวตามรอบ ${d.sent.digests}`,
        tone: "ok",
      });
      await load(password);
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
              ? `${formatDateTime(state.lastRead.t)} ${state.lastRead.ok ? `${state.lastRead.level?.toFixed(2)} ม. (${state.lastRead.confidence})` : `ไม่สำเร็จ: ${state.lastRead.reason}`}`
              : "ยังไม่เคยอ่าน"}
          </li>
          <li>อ่านไม่สำเร็จติดกัน: {state.failureStreak} รอบ</li>
          <li>เครื่องที่เปิดการแจ้งเตือน: {data.subscribers}</li>
        </ul>
        <p className="status-line" role="status" data-tone={msg?.tone}>
          {msg?.text}
        </p>
      </section>

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
                  <span>ผิวน้ำที่ตรวจพบ แถว {data.snapshot.y}</span>
                </div>
              )}
            </>
          ) : (
            <div className="camera__empty">ยังไม่มีภาพ กดอ่านค่าตอนนี้</div>
          )}
        </div>
        <p className="facts quiet" style={{ marginTop: 12 }}>
          เส้นสีฟ้าคือขีดอ้างอิงแต่ละ 10 ซม. ถ้าเลขหลักเมตรผิดทั้งไม้ ใช้ปุ่มเลื่อนสเกล ถ้าเส้นไม่ตรงขีดในภาพ แก้ค่าแถวด้านล่าง
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
          <button type="button" className="btn btn--quiet" onClick={() => setGauge(data.config.gauge)}>
            ยกเลิกการแก้
          </button>
        </div>
      </section>
    </div>
  );
}
