---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/about/page.tsx","app/admin/page.tsx"]
---

# Surface brief: dashboard (app/page.tsx)

Scope: the single main screen of the PWA, plus /about and /admin inheriting its system. Visitor mode: Operate.
Audience and job: residents, families, and flood-watch volunteers at Nonthaburi pier read the current gauge level at a glance (often on a phone at night), see whether it is normal / watch / danger, and turn on push notifications in one tap. Volunteers read history and rate of rise.
Proof: live readings from the CCTV staff gauge, history chart, live camera, alert log. No invented data or thresholds; placeholders labeled.
Constraints: Thai-first copy, status never by colour alone, AA contrast light and dark, 390px phones, offline/stale states honest.

## Direction contract

THESIS: The level is read through the louvred wooden awnings of the 1910 Nonthaburi provincial hall that faces the river at the pier: one slat equals 10 cm, the same step as the gauge marks. Refuses the category default of stat cards, status chips and a blue line chart on white.

OWN-WORLD: Weathered whitewashed louvre grey ground (#E4E6E1), eave-shadow charcoal ink (#1E2B2A), Chao Phraya silt for water (#7A6235), veranda balustrade brick-orange for watch (#C8693F), deep danger red (#A3201A), signboard gilt (#C9A227) only on the dark header wordmark. Night mode is its own palette for 2 a.m. reading, not an inversion. Type: Anuphan for all UI and the giant tabular numeral; Taviraj only for the gilt wordmark, like the hall's signboard. Rails at thresholds wear the cross-in-square balustrade pattern. Hairline slat rules, square corners, no cards, no shadows, no gradients.

STORY: Visitor sees the number and the state before anything else, understands where the water sits against the watch and danger rails, trusts it because the read time and confidence sit right beside it, then taps once to get notified. Volunteers scroll to the chart, the camera, and the alert log where nothing is deleted, only struck through when the water falls.

FIRST VIEWPORT: Header band filled with the full-strength state colour (charcoal when normal, brick-orange at watch, red at danger), gilt wordmark left, state word plus shape icon right. Below, two columns even on a 390px phone: left 55% holds the label, the giant level numeral (about 96px mobile, 160px desktop) with unit, trend per hour, today's high, and read time with confidence; right 45% is the louvre panel, a column of slats from 0.80 m to 3.00 m, slats under the waterline filled with silt, watch and danger rails crossing it with labels. Primary action "เปิดการแจ้งเตือน" is a full-width charcoal button at the bottom of the viewport.

FORM: Old hall veranda louvres (candidate 7 of 7 on the ordered list: flood-mark walls, express-boat flags, staff gauge, tide-table booklet, broadcast tower, irrigation bulletin, old provincial hall). Seed key 8ecba84b. Signature move: the louvre gauge whose slats close stepwise as the water rises, with balustrade threshold rails. Raises: scale-only hierarchy (from variable-font-specimen); full-strength state field (from acetate manual); alert log struck through, never deleted (from ticket wallet); purpose-built night palette (from star atlas); one waterline geometry shared by louvre, chart fill and app icon (from zoo map).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
