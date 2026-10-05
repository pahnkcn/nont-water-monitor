"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { PlayIcon, StopIcon } from "./icons";

const STREAM = "https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8";
const SOURCE = "https://cctv-nont.firsttech.co.th/";
const FRAME_H = 600;

type Props = {
  /** Time of the stored snapshot, or null when none exists yet. */
  snapshotAt: number | null;
  /** Row where the reader found the waterline in that snapshot. */
  lineY: number | null;
};

export function CameraPanel({ snapshotAt, lineY }: Props) {
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

      <div className="camera">
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
            {linePct !== null && (
              <div className="camera__line" style={{ top: `${linePct}%` }}>
                <span>ผิวน้ำที่ระบบอ่านได้</span>
              </div>
            )}
          </>
        ) : (
          <div className="camera__empty">
            {imgError ? "โหลดภาพไม่สำเร็จ กดดูภาพสดแทนได้" : "ยังไม่มีภาพจากกล้อง ภาพแรกจะขึ้นหลังระบบอ่านค่าครั้งแรก"}
          </div>
        )}
      </div>

      <div className="camera-meta">
        <button type="button" className="btn" onClick={() => setLive((v) => !v)} aria-pressed={live}>
          {live ? <StopIcon /> : <PlayIcon />}
          {live ? "หยุดภาพสด" : "ดูภาพสด"}
        </button>
        <p>
          {live ? "ใช้อินเทอร์เน็ตราว 2 MB ต่อนาที" : "เส้นประสีเหลืองคือผิวน้ำที่ระบบตรวจพบบนไม้วัด"} ·{" "}
          <a href={SOURCE} target="_blank" rel="noopener noreferrer">
            เว็บกล้องของเทศบาล
          </a>
        </p>
      </div>
    </section>
  );
}
