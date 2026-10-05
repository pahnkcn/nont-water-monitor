---
name: ระดับน้ำท่าน้ำนนท์ (Nont Water)
description: The Chao Phraya level at Nonthaburi pier, read through the louvres of the old provincial hall.
colors:
  ground: "#e4e6e1"
  slat: "#eceee9"
  slat-edge: "#c3c8c1"
  ink: "#1e2b2a"
  ink-2: "#4a5755"
  on-ink: "#f1f2ee"
  river: "#7a6235"
  river-soft: "rgb(122 98 53 / 0.22)"
  watch: "#b65a2c"
  danger: "#a3201a"
  gilt: "#c9a227"
  stile: "#1e2b2a"
  interior: "#2c3836"
  blade-wet: "#7a6235"
  action-bg: "#1e2b2a"
  action-fg: "#f1f2ee"
  head-normal: "#22302f"
  head-watch: "#b65a2c"
  head-danger: "#a3201a"
  sign-alert: "#ffffff"
  night-ground: "#121a19"
  night-slat: "#5e6c68"
  night-slat-edge: "#2b3734"
  night-ink: "#e3e6e0"
  night-ink-2: "#a4aeaa"
  night-river: "#9c7f45"
  night-watch: "#e08a55"
  night-danger: "#f0645b"
  night-gilt: "#d9b649"
  night-stile: "#3c4a47"
  night-interior: "#070b0a"
  night-blade-wet: "#8a7140"
  night-action-bg: "#2a2416"
  night-action-fg: "#f0d98a"
  night-head-normal: "#0b1110"
  night-head-watch: "#8e3f17"
  night-head-danger: "#7e1913"
typography:
  numeral:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "clamp(4.5rem, 50cqi, 10rem)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\", \"lnum\""
  wordmark:
    fontFamily: "Taviraj, serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.6
  small:
    fontFamily: "Anuphan, Noto Sans Thai, Leelawadee UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  square: "2px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  "8": "64px"
  gutter: "16px"
  gutter-wide: "24px"
components:
  header-band-normal:
    backgroundColor: "{colors.head-normal}"
    textColor: "{colors.sign-alert}"
    height: "56px"
  header-band-watch:
    backgroundColor: "{colors.head-watch}"
    textColor: "{colors.sign-alert}"
    height: "56px"
  header-band-danger:
    backgroundColor: "{colors.head-danger}"
    textColor: "{colors.sign-alert}"
    height: "56px"
  button-primary:
    backgroundColor: "{colors.action-bg}"
    textColor: "{colors.action-fg}"
    rounded: "{rounded.square}"
    padding: "8px 24px"
    height: "56px"
    width: "100%"
  button-primary-night:
    backgroundColor: "{colors.night-action-bg}"
    textColor: "{colors.night-action-fg}"
    rounded: "{rounded.square}"
    padding: "8px 24px"
    height: "56px"
    width: "100%"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "8px 24px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.slat}"
    textColor: "{colors.ink}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "8px 8px"
    height: "48px"
  slats-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "44px"
  slats-option-selected:
    backgroundColor: "{colors.action-bg}"
    textColor: "{colors.action-fg}"
  choice-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "8px 12px"
    height: "48px"
  choice-row-selected:
    backgroundColor: "{colors.action-bg}"
    textColor: "{colors.action-fg}"
  select:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "44px"
  chart-tip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.square}"
    padding: "4px 8px"
---

# Design System: ระดับน้ำท่าน้ำนนท์ (Nont Water)

## Overview

**Creative North Star: "Old Hall Veranda"**

You read the river level through the louvred awnings of the 1910 Nonthaburi provincial hall, which faces the water at the pier. One blade equals 10 cm, the same step as the marks on the staff gauge. Above the water the blades stand open on a dark interior. Below it they are shut and silted. The watch and danger thresholds cross the shutter as brick-orange and red balustrade rails. Everything else on the surface comes from the same building: whitewashed ground, eave-shadow ink, Chao Phraya silt for water, the gilt of the signboard for the wordmark.

The system is flat and typographic. Hierarchy comes from scale: one very large tabular numeral, then plain Thai text at near-body sizes. Structure comes from 2px ink rules and hairline slat-edge rules, not from containers. The state of the river owns the whole header band. Night is a separate palette built for reading at 2 a.m., not an inversion of the day palette. It has its own deep-silt action colour, so no light slab ever appears in the dark.

The build has no cards, no drop shadows and no gradients. Status is never shown by colour alone.

**Key Characteristics:**
- A full-strength state colour fills the sticky header band. The wordmark sits left and the state word with its shape icon sits right.
- A giant tabular numeral is sized by its own column (container query).
- The louvre gauge is the signature instrument. Its geometry (rails, silt fill, waterline) repeats in the chart.
- Choices are built as slats: segmented tabs and stacked option rows where the chosen slat closes dark.
- Every corner is square (2px). Rules are 1px hairlines, 1.5px control strokes and 2px section rules.
- Light and night are two separate palettes. The night palette is applied by `[data-theme="dark"]` or by `prefers-color-scheme` unless the user has chosen light.

## Colors

The palette is architectural and muted: lime-wash greys, eave charcoal and river silt. The two saturated notes are kept for the river's state.

### Primary
- **Eave Shadow Ink** (ink): text, 2px section rules, control strokes, focus outlines, chart tooltip, the waterline and the reading flag. In light mode it is also the action fill (action-bg).
- **Chao Phraya Silt** (river): water. It fills the louvre below the waterline, draws the chart line and area (river-soft), marks chart dots and selection, and is the inset underline on primary-button hover. It also outlines focus inside slats and choice rows.

### Secondary
- **Balustrade Brick** (watch): watch state. It is the header band at watch (head-watch), the watch rail, the watch icon and the warning-notice border. On ground it measures 3.72:1, so in light mode it is used only for graphics and borders, never for body text.
- **Hall Red** (danger): danger state. It is the header band, the danger rail, the bad-notice border and error status lines.

### Tertiary
- **Signboard Gilt** (gilt, sign-normal): the wordmark only, and only on the dark normal header. At watch and danger the wordmark turns white (sign-alert).

### Neutral
- **Whitewashed Louvre** (ground): page background, and the cut colour inside the danger octagon in the alert log.
- **Lit Slat** (slat): open blade faces, and the hover fill on outline buttons, slats and choice rows.
- **Slat Shadow** (slat-edge): hairline rules for table rows, log rows, chart grid and choice separators. It also strokes the dashed empty-state border and the default notice border.
- **Secondary Ink** (ink-2): metadata, units, axis labels and quiet lines (6.0:1 on ground).
- **Shutter Frame / Dark Room / Wet Blade** (stile, interior, blade-wet): reserved for the louvre gauge.
- **Night set** (night-*): deep green-black ground, mid-grey slats and a nearly black interior. State colours are lifted (night-watch 6.7:1 and night-danger 5.6:1 on night ground). The header bands go darker (night-head-*) and the action is deep silt (night-action-bg) with pale gilt text, outlined in night-gilt.

### Named Rules
**The State Owns the Band Rule.** The sticky header is filled edge to edge with the current state colour: charcoal, then brick, then red. The background change takes 400ms ease-out-expo. The state word always carries its shape icon.

**The Gilt Is Signage Rule.** Gilt appears only as the wordmark on the dark normal header, plus the night action outline and text. It is never used as an accent elsewhere.

**The No Light Slab at Night Rule.** In night mode every selected or primary surface uses the night action tokens (deep silt fill, gilt text). Ink is never turned into a pale slab.

**The Shape Before Colour Rule.** Status always has a shape: a ringed circle for normal, a triangle for watch and a solid octagon for danger. These are drawn on a 20px grid with 1.75 to 2 strokes. Rails carry a text label and value as well as their colour.

## Typography

**Display Font:** Anuphan (with Noto Sans Thai, Leelawadee UI, sans-serif)
**Body Font:** Anuphan
**Wordmark Font:** Taviraj 600, used for the wordmark only

**Character:** Anuphan is a looped Thai face that stays readable for older residents at small sizes, and its Latin numerals hold up at display size. Taviraj is a traditional Thai serif, used once, like the hall's gilt signboard.

### Hierarchy
- **Numeral** (700, clamp(4.5rem, 50cqi, 10rem), 0.95, -0.03em, tabular lining figures): centimetres to the next threshold, flanked by อีก and ซม. at unit size, with the threshold name on the line below. Three-digit values drop to clamp(3.5rem, 34cqi, 8rem). It is sized from its own column through `container-type: inline-size`, so it is about 90px on a 390px phone and 160px on wide screens. One per screen.
- **Headline** (700, 1.75rem, 1.25): h1 on prose pages (about).
- **Title** (700, 1.25rem, 1.25): section titles, each sitting above a 2px ink rule.
- **Body** (400, 1rem, 1.6): running text. Prose caps at 68ch.
- **Label** (600, 0.9375rem): the reading label, facts list, slats, notices and section subtitles (the subtitles in ink-2 at 400).
- **Small** (0.875rem): log timestamps, legends, choice descriptions. Chart axis text is 11px and louvre ticks are 14px.

### Named Rules
**The One Big Number Rule.** Hierarchy comes from scale alone. The numeral is the only display-size text. Everything else stays between 0.8125rem and 1.75rem.

**The Tabular Figures Rule.** Every number (levels, times, axes, tables) uses `tabular-nums lining-nums` (the `.num` class).

## Layout

There is one 1200px column with a gutter of 16px, which widens to 24px from 600px and respects safe-area insets. Spacing follows a 4px base scale (4, 8, 12, 16, 24, 32, 48, 64).

- **Lead:** two columns even on a 390px phone (1.1fr / 1fr, a 16px gap). The reading is on the left and the louvre on the right. The full-width primary action sits below. From 640px the louvre column is fixed at 220px with a 32px gap.
- **Desktop (1024px+):** the page splits into two equal columns with a 64px gap. The lead becomes sticky under the header at 200px. The sections (chart, camera, notifications, alert log) stack on the right with 32px to 48px between them.
- The header is 56px tall and sticky. Scroll padding clears it.
- Density is calm. Sections are separated by space and a 2px rule, not by panels.

## Elevation & Depth

The system is flat. Nothing floats on a drop shadow. Order comes from rules, from the state band and from ink-filled selected surfaces. The only depth is inside the louvre, where it is part of the material: open blades sit over a dark interior with a 1.5px black-alpha shadow line under each blade, and shut blades show a 2px black-alpha overlap seam. The hover state of the primary button uses an inset 3px river underline (`inset 0 -3px 0 var(--river)`). That underline is a rule, not an elevation.

### Named Rules
**The Flat Veranda Rule.** No drop shadows, no gradients, no cards. Depth is allowed only inside the louvre gauge, where it describes the shutter.

## Shapes

Every control, the select and the tooltip have square 2px corners. Strokes form a ladder: 1px hairlines (slat-edge) for rows and grid, 1.5px ink for control outlines and notices, and 2px ink for section heads and the footer top rule. Empty states use a 1.5px dashed slat-edge border. The cross-in-square balustrade pattern belongs to threshold rails only: 10px tiles in the louvre, 8px tiles in the chart, each with a solid top line in the rail's colour. The reading flag is a pointed tag in ink.

## Components

### Buttons
Solid and unadorned.
- **Shape:** square (2px), 1.5px stroke, minimum height 48px, 600 weight.
- **Primary:** full width, 56px high, 1.0625rem, filled with the action tokens. The light fill is charcoal. The night fill is deep silt with gilt text and a gilt outline. On hover a 3px river underline appears inset.
- **Outline (default):** transparent with an ink stroke, filled with slat on hover, nudged down 1px on press. Disabled is 0.55 opacity.
- **Quiet:** no stroke, an underlined label that thickens to 2px on hover. Used for cancel and reset.
- **Focus:** a 3px ink outline at 3px offset, turning white inside the header.

### Slats (segmented control)
Range tabs read as slats. They sit in a 1.5px ink frame divided by 1.5px ink lines, each segment at least 44px high and 64px wide. Hover fills with slat. The pressed or selected slat closes dark (action tokens). Focus is a river outline inset 5px.

### Choice Rows
Radio and checkbox groups are a stack of slats inside a 1.5px ink frame, separated by hairlines. Each row is at least 48px with a 20px input. Hover fills with slat. The checked row fills with the action tokens, and its input accent switches to action-fg. Focus is a 3px river outline inset.

### Inputs / Fields
Selects and number fields are 44px high, sit on ground, and have a 1.5px ink stroke with square corners. A fieldset legend is 700 weight, and its hint is ink-2 at 0.9375rem.

### Notices
These are bordered statements, not cards. Padding is 12px, the border is 1.5px slat-edge, and the text is 0.9375rem. The warn tone takes a watch border and the bad tone a danger border. Status lines are 600 weight and turn danger red when bad.

### Navigation
The header band is the whole of navigation: the gilt Taviraj wordmark links home, with the state word and its icon (or a back link on plain pages) opposite. The footer is in ink-2 under a 2px ink rule, with source credit, the about link and the night-mode toggle (an outline button with a moon icon and `aria-pressed`).

### Louvre Gauge (signature)
This is an SVG shutter. One blade is a 14px pitch and equals 10 cm. The range runs from 30 cm below the lower of the level and 1.0 m, up to at least 3.0 m.
- **Above water:** open blades with a 6px lit face (slat) and a 1.5px shadow line, over a dark interior, all inside a stile frame.
- **Below water:** silt fills the interior. Each blade is shut (blade-wet) with a 2px overlap seam.
- **Motion:** each shut blade swings closed in two steps (180ms, `steps(2, end)`, scaleY 0.43 to 1). The bottom blade goes first, then the next 70ms later. Reduced motion turns this off.
- **Rails:** watch and danger cross the frame as 10px cross-in-square balustrade rails, each with a 2px top line in the rail colour. Each rail's name is set at 13px/700 to its left, level with the rail; no metre values. If the rails crowd within 20px, danger's label lifts above its rail and watch's label drops below. If they would overlap, the watch rail thins to a 3px line so danger stays whole. Provisional thresholds get an asterisk and a footnote.
- **Reading:** a 2px ink waterline runs out to a pointed ink flag that says ตอนนี้ in on-ink. There is no metre scale; a caption under the gauge says each blade is 10 cm.

### Level Chart
The chart repeats the gauge's geometry. A 2px river line runs over a river-soft area fill with 4px river dots ringed in ground. Threshold rails are drawn as 8px balustrade bands, the grid uses slat-edge hairlines, and the scrub tooltip is ink. Below the chart are a rail legend and a disclosure table of readings with hairline rows.

### Alert Log
Each row is a hairline-ruled grid of the state icon in its state colour, what happened, and when. Entries are never deleted. A cleared entry is struck through with a 2px ink-2 line, and a 600-weight "cleared" line is added beneath it.

## Do's and Don'ts

### Do:
- **Do** fill the whole header band with the current state colour and pair the state word with its circle, triangle or octagon icon.
- **Do** size the level numeral from its column with `clamp(4.5rem, 50cqi, 10rem)` and tabular lining figures.
- **Do** draw thresholds as cross-in-square balustrade rails with a text label and value, and add an asterisk while they are provisional.
- **Do** build choices as slats: a 1.5px ink frame, ink dividers, and the chosen slat filled with the action tokens.
- **Do** use the action tokens (not ink) for any selected or primary fill, so night mode stays deep silt with gilt.
- **Do** keep corners at 2px and separate sections with a 2px ink rule and white space.

### Don't:
- **Don't** use cards, drop shadows or gradients. Depth belongs only to the louvre's blades.
- **Don't** let colour carry status alone. Every state needs its shape or its word.
- **Don't** use gilt outside the wordmark and the night action, and don't set Taviraj anywhere but the wordmark.
- **Don't** delete alert-log entries. Strike them through when the water falls.
- **Don't** set body text in watch on the light ground (3.72:1). It is a graphic and border colour in light mode.
