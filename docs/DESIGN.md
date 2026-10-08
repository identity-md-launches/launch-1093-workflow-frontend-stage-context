# Swarm brain design

## Overview

The site introduces the Swarm brain experiment and provides a focused Brain/IMD trading panel, wallet state, and direct ERC-20 utilities. It uses an editorial headline, a quiet cream canvas, forest-green text and actions, and a small diagram of connected nodes. The illustration is explicitly conceptual; the interface does not turn it into fabricated agent telemetry.

The source of truth is `web/src/styles.css`, with markup/components in `web/src/App.tsx`. This document lives under `docs/` because the assignment's overriding path budget excludes a root `DESIGN.md`. Light-only styling is intentional; there is no theme switch or implied dark variant.

## Colors

CSS uses hex primitives mapped to semantic custom properties. Components reference roles rather than duplicating palette values.

| Role token | Value / primitive | Use |
| --- | --- | --- |
| `--bg` | `--cream-100`, `#f4f3ed` | Page and amount input backgrounds |
| `--surface` | `--cream-50`, `#fbfbf6` | Trading card and selected direction |
| `--subtle` | `--cream-200`, `#e9e9df` | Segmented-control track, neutral hover, help panels |
| `--text` | `--forest-950`, `#172e28` | Primary text and headings |
| `--muted` | `--gray-600`, `#53645c` | Secondary text, captions, labels |
| `--border` | `--gray-400`, `#a0aaa2` | Structural separators and field boundaries |
| `--accent` | `--forest-800`, `#204f42` | Primary action background |
| `--accent-hover`, `--focus` | `--forest-700`, `#285849` | Primary hover, 3px keyboard outline |
| `--on-accent` | `--cream-50`, `#fbfbf6` | Primary action label |
| `--highlight` | `--lime-200`, `#dfeb9e` | Brain coin identity, favicon detail |
| `--error` | `--red-800`, `#8e332b` | Error text |
| `--error-bg` | `--red-50`, `#fff0eb` | Persistent inline error surface |

One filled forest action leads the trade panel; other controls are outlined or neutral. Status text accompanies colors. The favicon and token identity use lime as decoration, not a success indicator. Rendered contrast measurements and accessibility limitations are in `VALIDATION.md` and `evidence/`.

## Typography

The body requests `Helvetica Neue, Arial, sans-serif`, at 1rem and unitless line-height 1.5. There are no network fonts or downloadable font files. Actual platform fonts may differ. Body copy is regular; controls use 600, brand 700. `font-synthesis: none` prevents synthetic variants. Headline emphasis uses `Georgia, Times New Roman, serif` at 400 italic; labels and full addresses use platform monospace fonts.

- Hero: `clamp(3.6rem, 6.9vw, 6.5rem)`, line-height 1.1, weight 500, tracking −.065em. Serif emphasis has −.075em tracking.
- Section/card title: `--text-title: 1.625rem`, weight 500, tracking −.045em.
- Small heading: 1.05rem, line-height 1.4.
- Intro: 1.2rem, line-height 1.6; 1.0625rem on narrow layouts.
- Body: `--text-body: 1rem`; general small controls `--text-small: .875rem`; captions .75rem. The decorative diagram caption alone uses .6875rem.
- Amount input/output: 2rem. All editable inputs stay at least 1rem. Changing amounts and statistics use tabular numerals.

Headings balance their lines; prose uses `text-wrap: pretty`. Descriptions cap at 32rem or 65ch. Addresses and IDs wrap anywhere; full addresses remain available even where shortened in the header. Financial minimum output and transaction reviews use exact unit formatting; compact balance displays are summaries.

## Layout

`.shell` caps content at 1280px with inline padding `clamp(1rem, 4.5vw, 4rem)`. The desktop header is a horizontal brand/navigation row with 104px minimum height. The hero places editorial content and the trade panel in two columns (1.12fr / .88fr); the latter has a 340px minimum in the expanded layout. Spacing uses rem values: related labels sit around .45–.65rem apart, forms use 1rem gaps, and sections separate by roughly 2.5–4.6rem.

At 58rem, navigation text links hide, the hero becomes equal columns, its gap reduces to 2rem, and the headline becomes 4.5rem. At 46rem, the hero and token tools stack, the decorative diagram hides, stats become labeled rows, contract metadata stacks, and the header minimum becomes 84px. The headline becomes `clamp(3.5rem, 12vw, 5rem)`. The trading panel remains inset and caps at 36rem. Content stays in document flow; there are no fixed overlays or sticky controls.

Browser validation covers 1440, 768, 390 and 320 CSS pixel widths plus separate 200% text enlargement. See validation evidence for tested states and limits; narrow viewport checks do not claim native browser zoom or physical-device coverage.

## Elevation & Depth

The trading card uses `0 3px 18px #172e280b, 0 0 0 1px #172e2812`. A selected direction uses a small `0 1px 4px #172e2815` shadow. Structural borders distinguish input surfaces, utility disclosures, header, stats and footer. No modals, glass effects, gradients or full-page animation are used.

## Shapes

`--radius: 1.5rem` shapes the trading card. Amount panels and help surfaces use 1rem; segmented controls .9rem; buttons .75rem; ordinary fields and feedback .7rem. Coin markers are circular. The favicon is a rounded square. SVG artwork is decorative and ignores assistive reading order.

## Components

- `BrainArt` (`App.tsx`): deterministic local SVG nodes/edges with a concept caption, no data or live-state API. Hidden on compact layouts and from assistive technologies.
- `AddressLink`: accepts `address`, `explorer`, optional `label`; provides explorer link, full checksummed address, and a copy button with persistent copied/failure feedback.
- `Site` trade panel: paired direction buttons use `aria-pressed`; fields have real labels. One primary action advances through connect → switch → quote → token approval → router approval → swap. Explicit text explains each allowance and minimum output. Signing locks relevant controls through the receipt/refetch; quote and transaction states have separate labels.
- `.amount-box`, `.field-top`, `.field-value`, `.token-pill`: paired amount layout. Input width may shrink; exact quote constraints appear below the compact output.
- `.feedback` / `.error`: stable status/alert containers close to the action. Wallet rejection, live-read failures and revert explanations persist; no timed toast hides an error.
- Native `details`/`summary`: “Token tools” and “Onchain details” use keyboard-operable disclosure controls and visible plus/minus affordances. Token tools use an explicit review before confirmation; no modal focus trap is needed.
- Buttons use 44px minimum height, primary actions 52px, segmented controls 42px, copy buttons 40px and secondary quote refresh 34px. Keyboard focus is a 3px outline with 4px offset. Forced-color mode restores system `Highlight` focus and button boundaries.

Hover styles are limited to hover-capable devices. Button background/press transitions take 120ms, and press scale is .96; these run only with `prefers-reduced-motion: no-preference`. Reduced-motion users see immediate state changes. There are no automatic entrance animations.

## Do's and Don'ts

Reuse the shell, semantic palette, labeled fields, native disclosure pattern, and stable feedback containers for additional in-scope sections. Keep a single primary filled action in the trading flow. Preserve exact contract review amounts and access to full addresses. For a new section, add an appropriate heading, use the existing layout gaps, and check it at 320px with realistic long values.

Do not represent decorative node art as live agent activity, use token units as invented USD prices, or create another address/ABI configuration in a component. Do not hide transaction errors automatically or re-enable signing while a receipt is pending. Additional themes, routes, fonts or visualizations need a concrete product purpose rather than a checklist slot.
