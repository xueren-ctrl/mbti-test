# DESIGN.md

## World: The Personality Archive

An editorial, print-derived system for the MBTI test. It should read like a well-made
independent magazine or a psychological archive folder — quiet, confident, typeset — not like
a SaaS landing page. The old purple-and-glow dark look is the anti-reference.

Light is the default. Dark is the same archive at night: warm black paper, bone ink, muted
vermilion.

## Material & color

- Paper: `#f5f1e8`; raised paper: `#fbf8f2`; recessed: `#ece5d7`.
- Ink: `#1b1813`; secondary ink: `#4b453b`; muted: `#837a6b`.
- Rule: `#d9d1c2`; strong rule: `#b9ae9b`.
- Accent (oxblood / 朱砂): `#a33a2a`; use sparingly: one headline word, links, active marks.
- No gradients, no glows, no colored card tops, no glassmorphism.
- Dark: paper `#12110e`, surface `#181612`, ink `#f2ecdf`, rule `#2f2b24`, accent `#d06a58`.

## Type

- Display: Chinese serif stack (`STZhongsong`, `Songti SC`, `Source Han Serif SC`, `SimSun`).
  Large sizes, weight 400, tight leading, slight negative tracking. Never synthesize bold.
- Body: system sans (`PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei`), 15–16px, 1.75.
- Labels / data: monospace or small caps with wide tracking (`.14em–.2em`).
- Headings are sentence-like, with a numbered kicker and a hairline rule above sections.

## Layout

- Home uses a wide editorial grid (max 1160px); reading pages stay near 760–820px.
- Asymmetric hero: type on the left, a ruled statistics block on the right; not centered.
- Hairline rules (`1px`) do the dividing work; cards are flat paper with a single rule.
- Sharp corners (2px), no floating shadows. Hover = ink border + accent rule, not lift/glow.
- Generous whitespace: 72–112px between major sections; 24–32px inside blocks.

## Components

- Buttons: solid ink primary with paper text, square-ish; secondary is underlined text.
- Inputs: paper fill, 1px rule, focus = 1px ink + accent caret; no rounded pills.
- Stats: large serif numerals over small tracked labels, separated by hairlines.
- Type cards: like specimen cards — code in large serif, name, group label, short copy.
- Tags/chips: small tracked text with a leading rule, not filled pills.
- No emoji as icons. Icons are inline SVG strokes or typographic marks.

## Motion

- Restrained: 180–360ms ease-out fades and 8px rises on page entry; no bounces, parallax,
  glow pulses, or infinite ambient animation. Respect `prefers-reduced-motion`.

## Accessibility

- Body text ≥ 4.5:1 on paper; muted text only for labels ≥ 12px.
- Visible focus: 1px ink outline with 2px offset (accent on dark).
- Tap targets ≥ 44px on mobile; dark/light both checked.
