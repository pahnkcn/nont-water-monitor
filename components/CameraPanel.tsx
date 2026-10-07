"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { formatTime } from "@/lib/format";
import type { ThresholdRows } from "@/lib/public-state";
import type { Estimate } from "@/lib/summary";
import { PlayIcon, StateIcon, StopIcon } from "./icons";

const STREAM = "https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8";
const SOURCE = "https://cctv-nont.firsttech.co.th/";
const FRAME_H = 600;
const RAILS = [
  { key: "watch", label: "เฝ้าระวัง", colour: "ส้ม" },
  { key: "danger", label: "อันตราย", colour: "แดง" },
] as const;

type Props = {
  /** Time of the stored snapshot, or null when none exists yet. */
  snapshotAt: number | null;
  /** Row where the reader found the waterline in that snapshot. */
  lineY: number | null;
  /**
   * "below": no water on any row scanned, so lineY is the last of them and the water is under it.
   * "covered": plants or something afloat hide the gauge from lineY down, and the water is under it.
   */
  estimate?: Estimate;
  /** Rows of the watch and danger levels in that snapshot; null while the gauge is lost. */
  thresholdRows?: ThresholdRows | null;
  /** The thresholds are still placeholders. */
  provisional?: boolean;
};

export function CameraPanel({ snapshotAt, lineY, estimate, thresholdRows, provisional }: Props) {
  const below = estimate === "below";
  const covered = estimate === "covered";
  const approx = estimate === "approx";
  const [live, setLive] = useState(false);
  const [liveState, setLiveState] = useState<"loading" | "playing" | "error">("loading");
  const [imgError, setImgError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!live) return;
    const video = videoRef.current;
    if (!video) return;
    setLiveState("loading");
    let destroy: (() => void) | undefined;
    const onPlaying = () => setLiveState("playing");
    const onError = () => setLiveState("error");
    video.addEventListener("playing", onPlaying);
    // Autoplay can be refused (power saving, iOS Low Power Mode); once frames exist, show the native controls.
    video.addEventListener("loadeddata", onPlaying);
    video.addEventListener("error", onError);

    (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = STREAM;
      } else {
        const { default: Hls } = await import("hls.js");
        if (!Hls.isSupported()) return setLiveState("error");
        const hls = new Hls({ liveSyncDurationCount: 2, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && setLiveState("error"));
        hls.loadSource(STREAM);
        hls.attachMedia(video);
        destroy = () => hls.destroy();
      }
      video.play().catch(() => undefined);
    })();

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("loadeddata", onPlaying);
      video.removeEventListener("error", onError);
      destroy?.();
      video.removeAttribute("src");
      video.load();
    };
  }, [live]);

  const linePct = lineY !== null ? (lineY / FRAME_H) * 100 : null;
  const showSnapshot = !live && !!snapshotAt && !imgError;
  const rails = showSnapshot && thresholdRows ? RAILS.map((r) => ({ ...r, y: thresholdRows[r.key] })) : [];
  const inFrame = rails.filter((r) => r.y >= 0 && r.y <= FRAME_H);
  const railNote = [
    ...inFrame.map((r) => `เส้น${r.colour}คือระดับ${r.label}`),
    ...rails.filter((r) => !inFrame.includes(r)).map((r) => `ระดับ${r.label}อยู่${r.y < 0 ? "เหนือ" : "ใต้"}ขอบภาพ`),
  ].join(" ");
  const pct = (y: number) => `${(y / FRAME_H) * 100}%`;
  // The rail tags are placed against the frame (see .camera__tag), so it carries the rail rows.
  const railRows = Object.fromEntries(inFrame.map((r) => [`--${r.key}-y`, pct(r.y)])) as CSSProperties;

  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__head">
        <h2 className="section__title" id={titleId}>
          ภาพจากกล้องท่าน้ำนนท์
        </h2>
        <p className="section__sub">
          {live ? "ภาพสด ล่าช้าราว 15 วินาที" : snapshotAt ? `ภาพที่ระบบอ่านเมื่อ ${formatTime(snapshotAt)}` : "ยังไม่มีภาพ"}
        </p>
      </div>

      <div className="camera" style={railRows}>
        {live ? (
          <>
            <video ref={videoRef} muted playsInline controls aria-label="ภาพสดจากกล้องท่าน้ำนนท์" />
            {liveState === "error" && (
              <div className="camera__empty" style={{ position: "absolute", inset: 0, background: "rgb(0 0 0 / 0.75)" }} role="alert">
                <p>
                  เปิดภาพสดไม่ได้ตอนนี้ ลองดูที่{" "}
                  <a href={SOURCE} target="_blank" rel="noopener noreferrer">
                    เว็บของเทศบาล
                  </a>
                </p>
              </div>
            )}
            {liveState === "loading" && (
              <div className="camera__empty" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} role="status">
                กำลังต่อภาพสด อาจใช้เวลาราว 20 วินาที…
              </div>
            )}
          </>
        ) : snapshotAt && !imgError ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API with CDN caching */}
            <img
              src={`/api/snapshot?t=${snapshotAt}`}
              alt={`ภาพไม้วัดระดับน้ำจากกล้อง เวลา ${formatTime(snapshotAt)}`}
              width={800}
              height={600}
              loading="lazy"
              decoding="async"
              onError={() => setImgError(true)}
            />
            {inFrame.map((r) => (
              <div key={r.key} className="camera__line" data-level={r.key} style={{ top: pct(r.y) }} />
            ))}
            {linePct !== null && (
              <div className="camera__line" style={{ top: `${linePct}%` }}>
                <span>
                  {below
                    ? "ผิวน้ำต่ำกว่าเส้นนี้"
                    : covered
                      ? "มีสิ่งบังไม้วัด · ผิวน้ำต่ำกว่าเส้นนี้"
                      : approx
                        ? "ผิวน้ำโดยประมาณ · อาจคลาดเคลื่อน"
                        : "ผิวน้ำที่ระบบอ่านได้"}
                </span>
              </div>
            )}
            {/* After the waterline, so its dashes never run through a tag. */}
            {inFrame.map((r) => (
              <span key={r.key} className="camera__tag" data-level={r.key}>
                <StateIcon status={r.key} size={14} cut="#000" />
                {r.label}
                {provisional && "*"}
              </span>
            ))}
          </>
        ) : (
          <div className="camera__empty">
            {imgError ? "โหลดภาพไม่สำเร็จ กดดูภาพสดแทนได้" : "ยังไม่มีภาพจากกล้อง ภาพแรกจะขึ้นหลังระบบอ่านค่าครั้งแรก"}
          </div>
        )}
      </div>

      {showSnapshot && linePct !== null && estimate && (
        <p className="notice" data-tone="warn">
          {approx ? (
            <>
              <strong>เส้นนี้เป็นค่าประมาณ</strong> ช่วงล่างของไม้วัดอยู่ในเงาและมีตัวเลขบัง ตำแหน่งเส้นอาจคลาดจากผิวน้ำจริงเล็กน้อย
              กดดูภาพสดเพื่อเทียบได้
            </>
          ) : covered ? (
            <>
              <strong>เส้นนี้ไม่ใช่ผิวน้ำ</strong> ผักตบชวาหรือของลอยน้ำบังไม้วัดตั้งแต่เส้นนี้ลงไป น้ำอยู่ต่ำกว่าเส้นนี้
              แต่บอกไม่ได้ว่าต่ำกว่าเท่าไร
            </>
          ) : (
            <>
              <strong>เส้นนี้ไม่ใช่ผิวน้ำ</strong> ระบบไม่พบผิวน้ำจนถึงแถวล่างสุดที่อ่าน น้ำอยู่ต่ำกว่าเส้นนี้
            </>
          )}
        </p>
      )}

      <div className="camera-meta">
        <button type="button" className="btn" onClick={() => setLive((v) => !v)} aria-pressed={live}>
          {live ? <StopIcon /> : <PlayIcon />}
          {live ? "หยุดภาพสด" : "ดูภาพสด"}
        </button>
        <p>
          {live
            ? "ใช้อินเทอร์เน็ตราว 2 MB ต่อนาที"
            : below
              ? "เส้นประสีเหลืองคือแถวล่างสุดที่ระบบอ่านบนไม้วัด ผิวน้ำอยู่ต่ำกว่านั้น"
              : covered
                ? "เส้นประสีเหลืองคือจุดที่ไม้วัดเริ่มถูกบัง ผิวน้ำอยู่ต่ำกว่านั้น"
                : approx
                ? "เส้นประสีเหลืองคือผิวน้ำโดยประมาณที่ระบบตรวจพบบนไม้วัด"
                : "เส้นประสีเหลืองคือผิวน้ำที่ระบบตรวจพบบนไม้วัด"}
          {railNote && ` ${railNote}${provisional ? " (*เกณฑ์ชั่วคราว)" : ""}`}{" "}
          ·{" "}
          <a href={SOURCE} target="_blank" rel="noopener noreferrer">
            เว็บกล้องของเทศบาล
          </a>
        </p>
      </div>
    </section>
  );
}
