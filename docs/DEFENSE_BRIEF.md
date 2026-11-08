# Defense Brief

*Short answers for "why did you choose X over Y?"*

## Why a browser demo instead of Python and Mesa, which the article recommends?
Reach. The article's audience will click a link; very few will clone a repo and install Python. A static browser demo is free to host, works on a phone and needs no server. Trade-off accepted: it is not literally Mesa. The modelling ideas are the same (agents, local rules, seeded runs), and a Mesa port is on the roadmap if a calibrated, research-grade version is needed.

**Alternatives considered:** Mesa + Solara (faithful, but needs a Python host, roughly $5–20/month or a free tier that sleeps); Pyodide running Mesa in the browser (heavy first load, around 10+ MB); both side by side (double the maintenance).

## Why no framework (React, Vite) or dependencies?
Nothing here needs one. Zero dependencies means no build step, no supply-chain updates and no breakage when a package changes. Anyone can read the source directly. Revisit if the UI grows past one screen.

## Why a grid with distance fields instead of continuous movement?
Grid plus breadth-first distance maps is simple, fast and deterministic. Every shopper gets a correct route for free, and congestion emerges from per-cell crowding. Continuous social-force models give smoother motion but cost more and add tuning parameters without changing the business questions answered here.

## Why are the masters JSON files rather than hard-coded?
That is the point of the demo. Store geometry, categories and segments are governed data with owners and versions. Keeping them as data makes the governance checks meaningful, and lets anyone fork the repo and model their own store without touching code.

## How do you know clean vs dirty is a fair comparison?
Common random numbers. Arrivals and shopper profiles come from their own seeded streams, so both scenarios face exactly the same customers. A test asserts equal arrival counts, and another asserts dirty data is worse on time and wait across several settings.

## Why should anyone trust the numbers?
They should trust the *direction*, not the decimals. The model is illustrative and uncalibrated, and the README says so. What is defensible: runs are reproducible, assumptions are visible in the JSON, behaviour is covered by tests, and a known bug (gridlock plus survivorship bias) was found and documented rather than hidden.

## Why MIT licence?
Maximum reuse for a demo meant to be forked. Apache-2.0 would add an explicit patent grant, which is not material for this project.

## Why GitHub Pages?
Free, tied to the repo, HTTPS by default and adequate for a static site. **Growth path:** Cloudflare Pages or Netlify if custom headers, previews per branch or analytics are needed (both have free tiers); a custom domain when the portfolio justifies roughly $10–15/year.
