"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STATUS_LABEL, formatGap, formatTime, formatTrend, thresholdGap } from "@/lib/format";
import type { PublicState } from "@/lib/public-state";
import { AlertLog } from "./AlertLog";
import { CameraPanel } from "./CameraPanel";
import { StateIcon } from "./icons";
import { LevelChart } from "./LevelChart";
import { Louvre } from "./Louvre";
import { NotifyCta, NotifySettings } from "./Notify";
import { SiteFooter } from "./SiteFooter";
import { usePush } from "./usePush";

const POLL_MS = 60_000;

function minutesAgo(t: number, now: number) {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "เมื่อครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  return `${h} ชั่วโมง ${m % 60} นาทีที่แล้ว`;
}

export function Dashboard({ initial }: { initial: PublicState }) {
  const [state, setState] = useState(initial);
  const [clock, setClock] = useState<number | null>(null);
  const push = usePush();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const res = await fetch("/api/latest", { cache: "no-store" });
        if (res.ok) setState((await res.json()) as PublicState);
      } catch {
        // keep showing the last good state; the read time tells the visitor how old it is
      }
      setClock(Date.now());
    };
    const loop = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        loop();
      }, POLL_MS);
    };
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const first = setTimeout(() => setClock(Date.now()), 0);
    loop();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const { latest, status, thresholds } = state;
  const trend = formatTrend(state.trendCmPerHour);
  const gap = latest ? thresholdGap(latest.level, thresholds) : null;

  return (
    <>
      <a className="skip" href="#main">
        ข้ามไปที่ระดับน้ำ
      </a>
      <header className="site-head" data-status={status}>
        <div className="site-head__bar">
          <Link className="wordmark" href="/">
            ระดับน้ำท่าน้ำนนท์
          </Link>
          <p className="state-word" aria-live="polite">
            <StateIcon status={status} />
            <span>{STATUS_LABEL[status]}</span>
          </p>
        </div>
      </header>

      <main className="page" id="main">
        <div className="lead">
          <div className="lead__reading">
            <h1 className="label">ระดับน้ำตอนนี้</h1>
            {gap ? (
              <div>
                <p className="level num">
                  {!gap.over && <span className="level__unit">อีก</span>}
                  <span className="level__value" data-long={gap.cm >= 100 || undefined}>
                    {gap.cm}
                  </span>
                  <span className="level__unit">ซม.</span>
                </p>
                <p className="level__to">{gap.over ? "สูงกว่าระดับอันตราย" : `ถึงระดับ${STATUS_LABEL[gap.target]}`}</p>
              </div>
            ) : (
              <p className="level">
                <span className="level__unit">ยังไม่มีค่า</span>
              </p>
            )}

            {latest && (
              <ul className="facts">
                {status !== "normal" && state.statusSince > 0 && (
                  <li>
                    อยู่ในระดับ{STATUS_LABEL[status]}ตั้งแต่ <span className="nowrap">{formatTime(state.statusSince)}</span>
                  </li>
                )}
                <li>{trend ?? "อัตราขึ้นลง: รอข้อมูลครบ 1 ชั่วโมง"}</li>
                {state.todayHigh && (
                  <li className="num">
                    สูงสุดวันนี้ {formatGap(state.todayHigh.level, thresholds)}{" "}
                    <span className="nowrap">({formatTime(state.todayHigh.t)})</span>
                  </li>
                )}
                <li className="quiet num">
                  อ่านจากกล้องเมื่อ <span className="nowrap">{formatTime(latest.t)}</span>
                  {clock !== null && <span className="nowrap"> ({minutesAgo(latest.t, clock)})</span>} ·{" "}
                  <span className="nowrap">{latest.confidence === "high" ? "ภาพชัด" : "ภาพไม่ชัด"}</span>
                </li>
              </ul>
            )}

            {state.camera === "waiting" && (
              <p className="notice">ระบบอ่านค่าจากกล้องทุก 10 นาที ค่าแรกจะขึ้นที่นี่หลังการอ่านครั้งแรก</p>
            )}
            {state.tracking === "lost" ? (
              <p className="notice" data-tone="bad" role="status">
                หาไม้วัดในภาพไม่เจอ กล้องอาจหันไปทางอื่นหรือมีของบัง ระบบหยุดใช้ค่าจากกล้องจนกว่าจะเห็นไม้วัดอีกครั้ง
                ตัวเลขด้านบนคือค่าล่าสุดที่เชื่อถือได้
              </p>
            ) : (
              state.camera === "stale" && (
                <p className="notice" data-tone="bad" role="status">
                  อ่านค่าจากกล้องไม่ได้
                  {state.failingSince ? `ตั้งแต่ ${formatTime(state.failingSince)}` : ""} ตัวเลขด้านบนคือค่าล่าสุดที่อ่านได้
                </p>
              )
            )}
            {state.tracking === "moved" && state.camera === "ok" ? (
              <p className="notice" data-tone="warn">
                กล้องเพิ่งขยับ ระบบปรับตำแหน่งไม้วัดตามแล้ว ค่ารอบนี้จะใช้เตือนเมื่อรอบถัดไปยืนยันตรงกัน
              </p>
            ) : (
              latest?.confidence === "low" &&
              state.camera === "ok" && (
                <p className="notice" data-tone="warn">
                  ภาพรอบนี้ไม่ชัด ค่านี้อาจคลาดเคลื่อน ระบบจะยืนยันอีกครั้งในรอบถัดไป
                </p>
              )
            )}
          </div>

          <div className="lead__louvre">
            <Louvre
              level={latest?.level ?? null}
              watch={thresholds.watch}
              danger={thresholds.danger}
              provisional={state.thresholdsArePlaceholders}
            />
            <p style={{ fontSize: "0.8125rem", marginTop: 6, color: "var(--ink-2)" }}>
              ช่องละ 10 ซม.
              {state.thresholdsArePlaceholders && (
                <>
                  <br />* เกณฑ์ชั่วคราว รอผู้ดูแลยืนยัน
                </>
              )}
            </p>
          </div>

          <div className="lead__action">
            <NotifyCta push={push} />
          </div>
        </div>

        <div className="sections">
          <LevelChart
            day={state.day}
            watch={thresholds.watch}
            danger={thresholds.danger}
            provisional={state.thresholdsArePlaceholders}
            now={state.now}
          />
          <CameraPanel snapshotAt={state.snapshot?.t ?? null} lineY={state.snapshot?.y ?? null} />
          <section className="section" id="notify" aria-labelledby="notify-title">
            <div className="section__head">
              <h2 className="section__title" id="notify-title">
                การแจ้งเตือน
              </h2>
            </div>
            <NotifySettings
              push={push}
              watch={thresholds.watch}
              danger={thresholds.danger}
              latestLevel={latest?.level ?? null}
              provisional={state.thresholdsArePlaceholders}
            />
          </section>
          <AlertLog events={state.events} />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
