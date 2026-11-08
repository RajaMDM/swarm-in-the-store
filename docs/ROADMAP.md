# Roadmap

## Now (v1.1)
Browser demo on GitHub Pages: two layouts, independent master data defects as data patches, two-tier governance, walkouts and revenue at risk, a 10-seed defect matrix with interaction readout, reproducible shareable runs.

## Next
| Item | Why | Trigger to start |
| --- | --- | --- |
| Layout editor (draw shelves in the browser, export JSON) | Lets people model their own store without editing JSON | First request from a viewer to try their own layout |
| More defects as data (ghost promo slot, duplicate category record, wrong opening hours) | Broadens the master data story; each is a JSON patch plus, where needed, a Tier 2 check | Feedback asking "what other defects?" |
| In-store picker segment (handheld device driven directly by the product master) | The most direct path from master data to feet | Omnichannel conversations |
| Time-of-day arrival curves (lunch peak, evening rush) | More realistic staffing questions | Use in a staffing conversation |
| Batch sweep: run every lever combination and chart the results | Turns the demo into a decision tool | Need to answer "what's the cheapest setup that keeps waits under X?" |

## Later
- **Calibration mode:** load real footfall-sensor and POS summaries to fit arrival and dwell parameters. *Prerequisite:* access to real, anonymised data and a data-sharing agreement.
- **Mesa port** for research-grade, testable Python with the same JSON masters. *Trigger:* a client or academic collaborator needs it.
- **LLM persona layer** (OASIS-style) for comms questions such as reaction to a loyalty change. *Trigger:* the question shifts from "can we cope?" to "how will people react?"

## Blocked / not planned
- Real store or brand data: deliberately out of scope for a public repo.
