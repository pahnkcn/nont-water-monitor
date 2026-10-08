"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { ReaderSettings } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import type { Label, LabelKind } from "@/lib/labels";
import { DEFAULT_READER_PARAMS, type ReaderParams } from "@/lib/reader-params";
import { MIN_SAMPLES, isScored, type Evaluation, type TuneResult } from "@/lib/tune";
import type { TuneReply, TuneRequest } from "./tune.worker";

// Labelling rounds in /admin, and tuning the reader's numbers on them.

/** A label as the page lists it, without the calibration it was read at. */
export type LabelMeta = Omit<Label, "gauge">;

const FRAME_H = 600;

/** The colour of a line the admin put down, apart from the reader's dashed yellow. */
const ADMIN_LINE = "#ff7ad9";

const KIND_TEXT: Record<LabelKind, (y: number | null) => string> = {
  waterline: (y) => `ผิวน้ำแถว ${y}`,
  covered: (y) => `มีสิ่งบังตั้งแต่แถว ${y} น้ำอยู่ต่ำกว่านั้น`,
  below: () => "น้ำต่ำกว่าช่วงที่ระบบอ่าน",
  unreadable: () => "ภาพใช้ไม่ได้",
};

export const describeLabel = (l: Pick<LabelMeta, "kind" | "y" | "verdict">) =>
  `${KIND_TEXT[l.kind](l.y)}${l.verdict === "correct" ? " (ระบบอ่านถูก)" : " (แก้ให้)"}`;

/** What each tuned number does, for the table of what a tuning changed. */
const PARAM_TEXT: Record<keyof ReaderParams, string> = {
  whiteOfFace: "ความสว่างขั้นต่ำของหน้าไม้ เทียบกับช่วงเหนือขึ้นไป",
  whiteTint: "สีต่างจากหน้าไม้ได้ไม่เกิน",
  faceMin: "สัดส่วนสีขาวเหนือผิวน้ำอย่างน้อย",
  waterMax: "สัดส่วนสีขาวใต้ผิวน้ำไม่เกิน",
  waterSoft: "สัดส่วนสีขาวใต้ผิวน้ำไม่เกิน เมื่อขอบไม่คม",
  dropMin: "ความต่างเหนือและใต้ผิวน้ำอย่างน้อย เมื่อขอบไม่คม",
  refineRows: "ช่วงหาขอบที่คมที่สุดใต้จุดแรกที่เจอ (แถว)",
  hiddenRow: "สัดส่วนสิ่งบังที่ถือว่าทั้งแถวถูกบัง",
  plantRun: "แถวที่ถูกบังติดกันที่ถือว่ามีสิ่งบังผิวน้ำ",
  plantsUnder: "จำนวนแถวใต้หน้าไม้ที่ใช้ดูผักตบ",
  plantsCover: "สัดส่วนผักตบที่ถือว่าบังผิวน้ำ",
  busyUnder: "ความลายใต้หน้าไม้ที่ถือว่าเป็นกอผักตบ",
};

type Target = { source: "suspect"; i: number; t: number } | { source: "snapshot"; t: number };

type Note = { text: string; tone: "ok" | "bad" } | null;

function postError(status: number, target: Target) {
  if (status === 404) return "ภาพนี้ไม่อยู่ในรายการแล้ว มีรอบใหม่เข้ามาแทน โหลดหน้านี้ใหม่";
  if (status === 409 && target.source === "snapshot") return "มีรอบใหม่เข้ามาแทนภาพนี้แล้ว โหลดหน้านี้ใหม่";
  if (status === 507) return `เก็บ label ได้เต็มแล้ว ลบ label เก่าในส่วนความแม่นยำของตัวอ่านก่อน`;
  return `บันทึก label ไม่สำเร็จ (${status})`;
}

/**
 * Buttons under a round's picture to say whether the reader got it right, and if not, where the
 * water really is. `children` draws the picture: it gets the admin's line to lay over it, and a
 * click handler while a row is being picked.
 */
export function Labeller({
  target,
  readerY,
  label,
  password,
  onSaved,
  children,
}: {
  target: Target;
  /** The row the reader drew; null when it drew none (a held round on the snapshot). */
  readerY: number | null;
  label: LabelMeta | undefined;
  password: string;
  onSaved: (label: LabelMeta) => void;
  children: (overlay: ReactNode, onPick: ((e: MouseEvent<HTMLElement>) => void) | undefined) => ReactNode;
}) {
  const [draft, setDraft] = useState<{ kind: "waterline" | "covered" | "below"; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const send = async (body: { verdict: "correct" } | { verdict: "corrected"; kind: LabelKind; y?: number }) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/labels", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ ...target, ...body }),
      });
      if (!res.ok) throw new Error(postError(res.status, target));
      const { label: saved } = (await res.json()) as { label: LabelMeta };
      onSaved(saved);
      setDraft(null);
      setNote({ text: "บันทึกแล้ว", tone: "ok" });
    } catch (e) {
      setNote({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const pick = (e: MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.round(((e.clientY - rect.top) / rect.height) * FRAME_H);
    setDraft((d) => d && { ...d, y: Math.max(0, Math.min(FRAME_H - 1, y)) });
  };
  const nudge = (dy: number) => setDraft((d) => d && { ...d, y: Math.max(0, Math.min(FRAME_H - 1, d.y + dy)) });

  const shown = draft ? (draft.kind === "below" ? null : draft.y) : label && label.y;
  const overlay =
    shown != null ? (
      <div className="camera__line" style={{ top: `${(shown / FRAME_H) * 100}%`, borderTop: `2px solid ${ADMIN_LINE}` }}>
        {/* Under its line and to the right: the reader's tag sits above its own line on the left, often the same row. */}
        <span style={{ left: "auto", right: 8, bottom: "auto", top: 4 }}>{draft ? `วางไว้ที่แถว ${shown}` : `label: แถว ${shown}`}</span>
      </div>
    ) : null;

  return (
    <>
      {children(overlay, draft && draft.kind !== "below" ? pick : undefined)}
      <div style={{ gridColumn: "1 / -1", marginTop: 12 }}>
        {!draft && (
          <p className="facts num" style={{ marginBottom: 8 }}>
            {label ? `label แล้ว: ${describeLabel(label)}` : "ระบบอ่านภาพนี้ถูกไหม"}
          </p>
        )}
        {draft ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="slats" role="group" aria-label="ภาพนี้เป็นแบบไหน" style={{ width: "fit-content", flexWrap: "wrap" }}>
              {(
                [
                  ["waterline", "ผิวน้ำ"],
                  ["covered", "มีสิ่งบัง"],
                  ["below", "น้ำต่ำกว่าช่วงที่อ่าน"],
                ] as const
              ).map(([kind, text]) => (
                <button key={kind} type="button" aria-pressed={draft.kind === kind} onClick={() => setDraft({ ...draft, kind })}>
                  {text}
                </button>
              ))}
            </div>
            {draft.kind === "below" ? (
              <p className="facts quiet">หน้าไม้วัดยังเห็นเป็นสีขาวถึงโคน ไม่เห็นผิวน้ำในช่วงที่ระบบอ่าน</p>
            ) : (
              <>
                <p className="facts quiet">
                  {draft.kind === "waterline"
                    ? "แตะภาพตรงแถวที่หน้าไม้สีขาวจมน้ำ แล้วขยับทีละแถวด้วยปุ่มลูกศร"
                    : "แตะภาพตรงแถวที่ผักตบหรือของลอยน้ำเริ่มบังหน้าไม้ แล้วขยับทีละแถวด้วยปุ่มลูกศร"}
                </p>
                <div className="btn-row" style={{ alignItems: "center" }}>
                  <button type="button" className="btn" onClick={() => nudge(-1)} aria-label="ขึ้น 1 แถว">
                    ▲
                  </button>
                  <button type="button" className="btn" onClick={() => nudge(1)} aria-label="ลง 1 แถว">
                    ▼
                  </button>
                  <span className="num" aria-live="polite">
                    แถว {draft.y}
                  </span>
                </div>
              </>
            )}
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => send({ verdict: "corrected", kind: draft.kind, ...(draft.kind !== "below" && { y: draft.y }) })}
              >
                {busy ? "กำลังบันทึก…" : "บันทึก"}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setDraft(null)}>
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || readerY === null} onClick={() => send({ verdict: "correct" })}>
              อ่านถูก
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDraft({ kind: "waterline", y: label?.y ?? readerY ?? 300 })}>
              อ่านผิด
            </button>
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => send({ verdict: "corrected", kind: "unreadable" })}>
              ภาพใช้ไม่ได้
            </button>
          </div>
        )}
        <p className="status-line" role="status" data-tone={note?.tone}>
          {note?.text}
        </p>
      </div>
    </>
  );
}

type Run =
  | { phase: "idle" }
  | { phase: "loading"; done: number; total: number }
  | { phase: "reading"; done: number; total: number }
  | { phase: "evaluated"; labels: Label[]; evaluation: Evaluation }
  | { phase: "tuned"; labels: Label[]; result: TuneResult };

const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

/** How the reader does on the labelled rounds, and a search for numbers that do better. */
export function ReaderTuning({
  reader,
  labels,
  password,
  status,
  onDeleted,
  onApplied,
}: {
  reader: ReaderSettings;
  labels: LabelMeta[];
  password: string;
  /** How saving new numbers went, from the page. */
  status: Note;
  onDeleted: (t: number) => void;
  /** Saves new numbers, or goes back to the shipped ones, and reloads the page's data. */
  onApplied: (body: { reader: { params: ReaderParams; labels: number } } | { resetReader: true }, done: string) => Promise<boolean>;
}) {
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const [note, setNote] = useState<Note>(null);
  const worker = useRef<Worker | null>(null);
  const images = useRef(new Map<number, Blob>());

  useEffect(() => () => worker.current?.terminate(), []);

  const scored = labels.filter(isScored);
  const count = (kind: LabelKind) => labels.filter((l) => l.kind === kind).length;
  const running = run.phase === "loading" || run.phase === "reading";

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRun({ phase: "idle" });
  };

  const start = async (job: TuneRequest["job"]) => {
    setNote(null);
    try {
      const res = await fetch("/api/admin/labels", { headers: { "x-admin-password": password }, cache: "no-store" });
      if (!res.ok) throw new Error(`โหลด label ไม่สำเร็จ (${res.status})`);
      const all = ((await res.json()) as { labels: Label[] }).labels.filter(isScored);
      if (!all.length) throw new Error("ยังไม่มี label ที่ใช้ตรวจได้");
      const blobs: Blob[] = [];
      for (const l of all) {
        setRun({ phase: "loading", done: blobs.length, total: all.length });
        let blob = images.current.get(l.t);
        if (!blob) {
          const img = await fetch(`/api/admin/labels?t=${l.t}`, { headers: { "x-admin-password": password } });
          if (!img.ok) throw new Error(`โหลดภาพ ${formatDateTime(l.t)} ไม่สำเร็จ (${img.status})`);
          images.current.set(l.t, (blob = await img.blob()));
        }
        blobs.push(blob);
      }
      setRun({ phase: "reading", done: 0, total: 0 });
      worker.current?.terminate();
      const w = new Worker(new URL("./tune.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (e: MessageEvent<TuneReply>) => {
        const msg = e.data;
        if (msg.type === "progress") return setRun({ phase: "reading", done: msg.done, total: msg.total });
        w.terminate();
        worker.current = null;
        if (msg.type === "error") {
          setRun({ phase: "idle" });
          setNote({ text: `อ่านภาพไม่สำเร็จ: ${msg.message}`, tone: "bad" });
        } else if (msg.type === "evaluated") setRun({ phase: "evaluated", labels: all, evaluation: msg.evaluation });
        else setRun({ phase: "tuned", labels: all, result: msg.result });
      };
      w.postMessage({ job, labels: all, images: blobs, params: reader.params } satisfies TuneRequest);
    } catch (e) {
      setRun({ phase: "idle" });
      setNote({ text: (e as Error).message, tone: "bad" });
    }
  };

  const remove = async (t: number) => {
    setNote(null);
    const res = await fetch(`/api/admin/labels?t=${t}`, { method: "DELETE", headers: { "x-admin-password": password } });
    if (!res.ok) return setNote({ text: `ลบไม่สำเร็จ (${res.status})`, tone: "bad" });
    images.current.delete(t);
    onDeleted(t);
  };

  const wrongList = (rounds: Label[], pass: boolean[]) => {
    const wrong = rounds.filter((_, i) => !pass[i]);
    return wrong.length ? (
      <ul className="facts num" style={{ marginTop: 4 }}>
        {wrong.map((l) => (
          <li key={l.t}>
            {formatDateTime(l.t)} · {describeLabel(l)}
          </li>
        ))}
      </ul>
    ) : null;
  };

  return (
    <section className="section" aria-labelledby="reader-title">
      <div className="section__head">
        <h2 className="section__title" id="reader-title">
          ความแม่นยำของตัวอ่าน
        </h2>
        <p className="section__sub">
          {reader.savedAt === null
            ? "ใช้ค่าเริ่มต้น"
            : `ใช้ค่าที่ปรับเมื่อ ${formatDateTime(reader.savedAt)} จาก ${reader.labels} label`}
        </p>
      </div>
      <p className="facts quiet" style={{ marginBottom: 12 }}>
        กดอ่านถูกหรืออ่านผิดใต้ภาพของรอบที่ค่าน่าสงสัยหรือภาพล่าสุด ภาพที่ label แล้วเก็บไว้ถาวร
        ระบบใช้ภาพพวกนี้หาค่าตัวเลขของตัวอ่านชุดที่อ่านถูกมากขึ้น โดยไม่ยอมให้ภาพที่เคยอ่านถูกกลับมาผิด
        ค่าชุดใหม่มีผลเมื่อกดใช้เท่านั้น ปรับได้แค่ตัวเลขของวิธีอ่านเดิม ถ้าเจอสิ่งบังแบบใหม่ที่ระบบไม่รู้จัก ยังต้องแก้โค้ด
      </p>
      <ul className="facts num">
        <li>
          label ทั้งหมด {labels.length} ภาพ: ผิวน้ำ {count("waterline")} · มีสิ่งบัง {count("covered")} · น้ำต่ำกว่าช่วง{" "}
          {count("below")} · ใช้ไม่ได้ {count("unreadable")}
        </li>
      </ul>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" disabled={running || !scored.length} onClick={() => start("evaluate")}>
          ตรวจกับค่าที่ใช้อยู่
        </button>
        <button type="button" className="btn" disabled={running || scored.length < MIN_SAMPLES} onClick={() => start("tune")}>
          หาค่าที่แม่นขึ้น
        </button>
        {running && (
          <button type="button" className="btn btn--quiet" onClick={stop}>
            หยุด
          </button>
        )}
        {reader.savedAt !== null && !running && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => onApplied({ resetReader: true }, "กลับไปใช้ค่าเริ่มต้นแล้ว มีผลตั้งแต่รอบอ่านค่าถัดไป")}
          >
            กลับไปใช้ค่าเริ่มต้น
          </button>
        )}
      </div>
      {scored.length < MIN_SAMPLES && (
        <p className="facts quiet" style={{ marginTop: 8 }}>
          หาค่าใหม่ได้เมื่อมี label ที่ไม่ใช่ภาพใช้ไม่ได้อย่างน้อย {MIN_SAMPLES} ภาพ ตอนนี้มี {scored.length}
        </p>
      )}

      <div role="status" style={{ marginTop: 12 }}>
        {run.phase === "loading" && (
          <p className="facts num">
            กำลังโหลดภาพ {run.done} จาก {run.total}
          </p>
        )}
        {run.phase === "reading" && (
          <>
            <p className="facts num">
              {run.total ? `กำลังลองค่าชุดต่างๆ ${pct(run.done, run.total)}%` : "กำลังอ่านภาพ…"}
            </p>
            {run.total > 0 && <progress value={run.done} max={run.total} style={{ width: "100%", maxWidth: 420 }} />}
          </>
        )}
        {run.phase === "evaluated" && (
          <>
            <p className="facts num">
              ค่าที่ใช้อยู่อ่านถูก {run.evaluation.passCount} จาก {run.labels.length} ภาพ
              {run.evaluation.passCount < run.labels.length && " · ภาพที่ยังอ่านผิด:"}
            </p>
            {wrongList(run.labels, run.evaluation.pass)}
          </>
        )}
        {run.phase === "tuned" && (
          <TuneOutcome
            labels={run.labels}
            result={run.result}
            wrongList={wrongList}
            onApply={() =>
              onApplied(
                { reader: { params: run.result.params, labels: run.labels.length } },
                "ใช้ค่าชุดใหม่แล้ว มีผลตั้งแต่รอบอ่านค่าถัดไป",
              ).then((saved) => saved && setRun({ phase: "idle" }))
            }
          />
        )}
      </div>
      <p className="status-line" role="status" data-tone={(note ?? status)?.tone}>
        {(note ?? status)?.text}
      </p>

      {labels.length > 0 && (
        <details className="table-view">
          <summary>รายการ label ({labels.length})</summary>
          <ul className="log suspects">
            {labels.map((l) => (
              <li key={l.t}>
                <span className="what num">{describeLabel(l)}</span>
                <span className="when num">
                  {formatDateTime(l.t)} · {l.source === "suspect" ? "จากรอบที่ค่าน่าสงสัย" : "จากภาพล่าสุด"}
                </span>
                <button type="button" className="btn btn--quiet" disabled={running} onClick={() => remove(l.t)}>
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TuneOutcome({
  labels,
  result,
  wrongList,
  onApply,
}: {
  labels: Label[];
  result: TuneResult;
  wrongList: (rounds: Label[], pass: boolean[]) => ReactNode;
  onApply: () => void;
}) {
  const { before, after, changed } = result;
  const fixed = labels.filter((_, i) => after.pass[i] && !before.pass[i]);
  if (!changed.length) {
    return (
      <>
        <p className="facts num">
          ไม่พบค่าชุดที่อ่านได้ดีกว่าค่าที่ใช้อยู่ (อ่านถูก {before.passCount} จาก {labels.length} ภาพ)
          {before.passCount < labels.length && " ภาพที่ยังอ่านผิดอาจต้องแก้วิธีอ่านในโค้ด:"}
        </p>
        {wrongList(labels, before.pass)}
      </>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="facts num">
        ค่าชุดใหม่อ่านถูก <strong>{after.passCount}</strong> จาก {labels.length} ภาพ (ค่าที่ใช้อยู่ {before.passCount})
        {fixed.length > 0 && ` · แก้ได้ ${fixed.length} ภาพ`} · ภาพที่เคยอ่านถูกยังถูกทั้งหมด
      </p>
      {after.passCount < labels.length && (
        <>
          <p className="facts num">ภาพที่ยังอ่านผิด:</p>
          {wrongList(labels, after.pass)}
        </>
      )}
      <table className="readings-table num">
        <thead>
          <tr>
            <th scope="col">ค่าที่เปลี่ยน</th>
            <th scope="col">เดิม</th>
            <th scope="col">ใหม่</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((c) => (
            <tr key={c.key}>
              <td>
                {PARAM_TEXT[c.key]} <span className="quiet">({c.key}, ค่าเริ่มต้น {DEFAULT_READER_PARAMS[c.key]})</span>
              </td>
              <td>{c.from}</td>
              <td>{c.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onApply}>
          ใช้ค่าชุดนี้
        </button>
      </div>
    </div>
  );
}
