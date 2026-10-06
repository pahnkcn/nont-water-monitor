# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js (App Router, TypeScript) on Vercel Hobby (free), Upstash Redis (free tier via Vercel Marketplace), Web Push with VAPID + own service worker, ffmpeg-static inside a Vercel Function to grab frames from the HLS stream. Chosen because the product needs server routes (push, cron tick, history) plus an installable PWA on one free host. An external free scheduler (cron-job.org) triggers the 10-minute check, since Vercel Hobby cron runs at most once a day.

## Users

- Residents and shop owners around Nonthaburi pier (ท่าน้ำนนท์) who want to know whether the Chao Phraya will reach their house or shop. Mostly on phones, often checking at night or when it rains, sometimes anxious.
- The builder, their family, and small groups they share it with.
- Municipal staff and flood-watch volunteers who need history, rate of rise, and a trustworthy "last updated" time.

All users read Thai. The UI is Thai-first.

## Product Purpose

Turn the municipality's public CCTV view of the staff gauge at Nonthaburi pier into a number, a status, and a push notification. Success: a person taps "allow notifications" once and then reliably gets (1) a routine water-level update at the frequency they chose (hourly, every few hours, daily) and (2) an immediate alert when the reading crosses the watch or danger level, plus an all-clear when it falls back.

## Positioning

The only source is a live video of a physical staff gauge. This product reads that gauge every 10 minutes, keeps the history, and pushes alerts, so nobody has to keep watching the stream. It shows the reading against the same gauge marks a person would see on the camera.

## Operating Context

- Source: `https://cctv-nont.firsttech.co.th/` (Nonthaburi Municipality, supported by FirstTech Design). Stream: `https://stream.firsttech.co.th/live/nakornnont.stream/playlist.m3u8` (MediaMTX HLS, 800×600, 10 fps, lit at night).
- The gauge is marked every 10 cm; two plates join at a meter mark. The meter digit at the joint is not legible in the stream and must be confirmed during calibration. The gauge datum (e.g. MSL) is unknown, and only the top of the gauge is in view. The public site and pushes therefore never show metres: the reading is centimetres to the next threshold (or past danger), which is exact from the 10 cm marks. Gauge-scale metres appear only in /admin for calibration.
- The river is tidal; level moves within a day, so rate of rise and today's high matter.
- Check cadence: every 10 minutes. Times are Asia/Bangkok.
- iOS delivers web push only after "Add to Home Screen" (iOS 16.4+).

## Capabilities and Constraints

- Reading method: pixel analysis of the gauge face along a calibrated strip, median of several frames, confidence flag. No AI model.
- Three states: ปกติ (normal), เฝ้าระวัง (watch), อันตราย (danger). Thresholds are set by the site admin; each subscriber chooses from which state they receive instant alerts and receives an all-clear when the level falls back.
- Personal alert point: each device can move both thresholds by -50 to +30 cm (alert earlier for a low house, later for a raised one). Each device runs its own copy of the alert state machine; texts still measure distance against the site thresholds. The header status and the public alert log stay site-wide.
- Camera tracking: every round the reader matches a grey patch around the dry top of the gauge against stored references (ZNCC, coarse-to-fine, shift ±80 px, zoom 0.85-1.15) and moves the calibration with the camera. A jump is held back for one round; a scene that does not match is refused rather than read. References for new light are learned automatically. The admin can switch tracking off, and devices marked as admin get camera notices by push.
- Routine update frequencies: every 1 h, 3 h, 6 h, once a day at a chosen hour, or off (alerts only). Quiet hours apply to routine updates only, never to alerts.
- Admin page for calibration, thresholds, tracking status and admin notices (password). Needed rarely once tracking runs: real thresholds, the meter digit, and a camera that moved beyond tracking range.
- Must run on free tiers: Vercel Hobby (non-commercial), Upstash free, cron-job.org free.
- Open decisions: real watch/danger threshold values (placeholders 2.20 m / 2.50 m), the meter digit at the plate joint, the gauge datum.

## Brand Commitments

None established. The product is unofficial and must not imitate the municipality's or FirstTech's branding; it credits and links them as the source.

## Evidence on Hand

- Live stream and real frames captured 2026-10-03 22:38 (night, lamp-lit, gauge legible, water hyacinth near the gauge).
- No official water-level data, no thresholds from the municipality, no testimonials. None may be invented.

## Product Principles

1. The number must be honest: always show when it was read, how confident the reading is, and when the camera is offline.
2. Alerts are rare, loud, and trustworthy; routine updates are quiet and predictable.
3. One tap to subscribe; everything else is optional adjustment.
4. Readable at a glance on a phone at night, in Thai.
5. Free to run, cheap to keep alive, easy to recalibrate when the camera moves.

## Accessibility & Inclusion

Thai-first copy, large numerals, status never conveyed by color alone, works for older residents on small phones, WCAG AA contrast in light and dark.
