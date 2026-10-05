import { useId } from "react";
import { rank, type Status } from "@/lib/alerts";
import { STATUS_LABEL, cmBetween, formatDateTime } from "@/lib/format";
import type { LoggedEvent } from "@/lib/store";
import { StateIcon } from "./icons";

const COLOR: Record<Status, string> = { normal: "var(--ink)", watch: "var(--watch)", danger: "var(--danger)" };

/** Alerts are never removed from the log; once the water falls below them they are struck through. */
export function AlertLog({ events }: { events: LoggedEvent[] }) {
  const titleId = useId();
  // events arrive newest first
  const rows = events
    .map((e, i) => {
      if (e.kind === "clear") return null;
      const level: Status = e.kind === "escalate" ? e.to : "danger";
      const clearedBy = events
        .slice(0, i)
        .reverse()
        .find((c) => c.kind === "clear" && rank(c.to) < rank(level));
      return { e, level, clearedBy: clearedBy?.kind === "clear" ? clearedBy : null };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__head">
        <h2 className="section__title" id={titleId}>
          บันทึกการเตือน
        </h2>
        <p className="section__sub">ไม่ลบ แค่ขีดทับเมื่อพ้นระดับ</p>
      </div>
      {rows.length === 0 ? (
        <p className="facts quiet">ยังไม่มีการเตือน ตั้งแต่เริ่มบันทึกน้ำยังไม่ถึงเกณฑ์เฝ้าระวัง</p>
      ) : (
        <ul className="log">
          {rows.map(({ e, level, clearedBy }) => (
            <li key={e.id} data-cleared={clearedBy ? "true" : "false"}>
              <span style={{ color: COLOR[level] }}>
                <StateIcon status={level} cut="var(--ground)" />
              </span>
              <span className="what">
                {e.kind === "rising"
                  ? `น้ำสูงขึ้นอีก ${cmBetween(e.level, e.previous)} ซม.`
                  : `น้ำถึงระดับ${STATUS_LABEL[level]}`}
              </span>
              <span className="when num">{formatDateTime(e.t)}</span>
              {clearedBy && (
                <span className="cleared-by num">
                  พ้นระดับ{STATUS_LABEL[level]} {formatDateTime(clearedBy.t)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
