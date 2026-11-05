# PRODUCT.md

## What this is

A free, Chinese-language MBTI personality and career test that runs as a single static page.
Visitors answer 12 / 28 / 60 situational questions and get a four-letter type, dimension
breakdown, career matches, growth advice, sharing tools, and an optional AI deep reading.

## Primary user

Chinese students and early-career workers (roughly 18–35), often on a phone, who are curious
about their personality and want a practical career direction. Many arrive from a shared link
or social post; most will not create an account.

## Job to be done

"Help me understand how I think and what work fits me, in a few minutes, without signing up —
and give me something worth sharing."

## Product truth to preserve

- Three modes: quick (12), detailed (28), full (60); no login required to test.
- Result: type code, four dimension bars, career suggestions, strengths/weaknesses, growth advice.
- Share poster + QR, social sharing, local history, optional account sync.
- Extra features: compatibility, growth tracking, career paths, team map, daily insight, type gallery.
- AI deep reading via a server-side proxy; the API key never reaches the browser.
- Single-file static site on GitHub Pages, no build step, Chinese only, mobile-first.

## Constraints

- Vanilla HTML/CSS/JS in `index.html`; do not introduce a framework or build pipeline.
- Keep all existing IDs, handlers, routes, and localStorage behavior working.
- AI proxy: Tencent SCF function URL, configured in `AI_PROXY_URL`.

## Stack

Delegated: plain static HTML/CSS/JS, GitHub Pages. No framework.
