# Roadmap

## Now (v1.0)
Browser demo live on GitHub Pages: two layouts, five levers, clean vs dirty master data, governance checks, reproducible shareable runs.

## Next
| Item | Why | Trigger to start |
| --- | --- | --- |
| Layout editor (draw shelves in the browser, export JSON) | Lets people model their own store without editing JSON | First request from a viewer to try their own layout |
| More data defects (duplicate store record, wrong opening hours, mis-mapped segment) | Broadens the master data story | Feedback asking "what other defects?" |
| Time-of-day arrival curves (lunch peak, evening rush) | More realistic staffing questions | Use in a staffing conversation |
| Batch sweep: run every lever combination and chart the results | Turns the demo into a decision tool | Need to answer "what's the cheapest setup that keeps waits under X?" |

## Later
- **Calibration mode:** load real footfall-sensor and POS summaries to fit arrival and dwell parameters. *Prerequisite:* access to real, anonymised data and a data-sharing agreement.
- **Mesa port** for research-grade, testable Python with the same JSON masters. *Trigger:* a client or academic collaborator needs it.
- **LLM persona layer** (OASIS-style) for comms questions such as reaction to a loyalty change. *Trigger:* the question shifts from "can we cope?" to "how will people react?"

## Blocked / not planned
- Real store or brand data: deliberately out of scope for a public repo.
