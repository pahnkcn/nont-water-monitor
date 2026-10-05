# antislop Delivery Gate: ระดับน้ำท่าน้ำนนท์ (2026-10-04)

Mode: during (session choice). Design Read: Thai public-service water monitor (Operate) for pier residents, families and flood volunteers, in the "Old Hall Veranda" louvre language. Dials: ENERGY 2 / RHYTHM 2 / MOTION 2.

## Block 1: Hard Gate (all must be "no")

- R-02 PASS: grep for em/en dashes over app, components, lib, sw.js, README, PRODUCT, DESIGN returns 0.
- R-03 PASS: CDP captures at 390, 768, 1440 report scrollWidth == innerWidth; buttons and choice rows 44 to 56px tall.
- R-17 PASS: every number shown is a live reading from the camera or a labelled placeholder threshold (asterisk + caption).
- R-18 PASS: no testimonials.
- R-23 PASS: app icon is labelled provisional in README and its PNG metadata; no avatars, no invented stats.
- R-24 PASS: links go to /, /about, #notify, #main and the municipality camera site; all exist.
- R-25 PASS: pairs checked with contrast-check.py (ink 11.65:1, ink-2 6.0:1, white on watch 4.68:1, white on danger 7.56:1, night action 11.01:1).
- R-26 PASS: every control has behaviour (range tabs fetch, table toggles, live video starts/stops, theme toggles, subscribe/test/unsubscribe hit APIs, admin save/tick).
- R-27 PASS: waiting, loading, error, empty, stale camera, low confidence, push unsupported/denied/iOS-install states all render text.
- R-28 PASS: no FAQ.
- R-32 PASS: :focus-visible 3px outline on everything; chart has arrow-key navigation; skip link present.
- R-33 PASS: no patch scripts; all styling in source.
- R-34 PASS: light and night both captured (desktop-dark, mobile-dark, subscribed-dark, danger-dark) with no broken styles.
- R-35 PASS: click-through recorded below.
- R-36 PASS: no security, compliance or performance claims; disclaimer says unofficial estimate.
- R-37 PASS: direction chosen by the user on the decision round ("ระเบียงศาลากลางเก่า"), DESIGN.md written from the build.
- R-38 PASS: placeholders labelled (thresholds *, meter digit noted on /about, icon provisional).

Click-through (R-35), dev server, 2026-10-03/04:
- 24 ชม. / 7 วัน / 30 วัน tabs: aria-pressed moves, title changes, /api/readings fetched.
- ดูเป็นตาราง: details opens, table rows render.
- ดูภาพสด: video attaches the HLS stream (48 s buffered), button becomes หยุดภาพสด; stop releases it.
- โหมดกลางคืน: data-theme toggles and persists.
- เปิดการแจ้งเตือน (headless Chrome with permission): subscribed via FCM, settings form appears, "เปิดการแจ้งเตือนแล้ว".
- Settings radios/select/checkbox: POST /api/push/subscribe returns the saved prefs.
- Danger staged via /admin: escalate event, alerts sent 3 / failed 0 through FCM; all-clear after two reads, sent 3 / failed 0.
- Admin: wrong password 401, invalid thresholds rejected with Thai message, อ่านค่าตอนนี้ returns a reading.
- Console: no errors during the session.

## Block 2: Purpose-Gate

- R-01 PASS: no gradients; colours from the hall (whitewash, eave shadow, silt, balustrade, gilt).
- R-04 PASS: authored SVG icons; state shapes circle/triangle/octagon carry status without colour.
- R-06 PASS: Anuphan (looped Thai, readable for older residents), Taviraj only for the signboard wordmark; no mono.
- R-07 PASS: no background pattern; the cross-in-square only appears on threshold rails (balustrade).
- R-08 PASS: no arrow decorations.
- R-09 PASS: no badges.
- R-10 PASS: no glass.
- R-12 PASS: no drop shadows (one inset rule on primary hover).
- R-13 PASS: no glow.
- R-14 PASS: no feature cards.
- R-19 PASS: one authored moment (blades shut bottom-first), header colour transition; both off under reduced motion.
- R-22 PASS: no illustrations; the louvre is a data graphic.

## Block 3: Liveliness

- Dials declared: yes (ENERGY 2 / RHYTHM 2 / MOTION 2).
- Output matches dials: yes (sections vary: chart, photo, form, log; one motion moment).
- Focal point per screen: yes (the numeral and louvre).
- Structural whitespace: yes (48px between sections, 2px section rules).
- One deliberate accent: yes (gilt wordmark; state colour owns the band).
- Identity motif: yes (louvre blades and balustrade rails, repeated in chart and icon).
- Design Read declared: yes (above).

## Block 4: Craftsmanship & Quality Locks (all must be "no")

- C-1 no; C-2 no; C-3 no; C-4 no; C-5 no.
- R-05 no template layout; R-11 square 2px radius, no pills; R-15 CTAs name the action (เปิดการแจ้งเตือน, ดูภาพสด, ส่งการแจ้งเตือนทดสอบ).
- R-16 no buzzwords; R-20 identity holds with the name removed (louvre gauge); R-21 night mode is a working toggle plus system preference.
- R-29 core: silt + eave ink, accent gilt, state colours semantic only; R-30 not a clone; R-31 reasons recorded in globals.css comments, DESIGN.md and the surface brief.

Result: PASS.
