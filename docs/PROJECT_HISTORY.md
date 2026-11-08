# Project History

*A plain-language account of what was built and why, for non-technical readers.*

## November 2026 — From article to working demo

**Why it exists.** The article *The Swarm in the Store* argued two things: swarm-style simulation lets retailers rehearse decisions safely, and any such simulation is only as believable as the master data underneath it. An argument is easy to nod along to. A working demo is harder to dismiss, so this project turns the article's first use case, store footfall, into something anyone can open in a browser and try.

**What was built.** A top-down store where simulated shoppers, each on a different mission (a quick top-up, a browse, a family shop, a click-and-collect pickup), walk the aisles, queue and leave. Visitors can change the layout, move a promotional stand, open or close checkouts and make the store busier. Hotspots and queues appear on their own; nobody programs them in.

**The key feature: bad data, made visible.** One switch introduces two everyday data defects: a product category still recorded in its old aisle after a refit, and a checkout lane still listed as open after it was removed. One button runs the same customers through the store with clean and dirty data side by side. The difference shows up as longer visits, longer queues and items customers gave up on.

**Governance before results.** The demo checks its own data before it runs: every category has a shelf, every aisle can be reached, customer groups add up to 100%. If a check fails, the simulation will not start. That is the article's point in practice.

**A problem found and fixed during the build.** The first version showed dirty data *improving* queue times. Investigation found shoppers gridlocked behind people standing at the closed lane, and the averages only counted those who escaped. Shoppers can now step around blockages, and every average includes people still in the store. An automated test now guards against this returning.

**Where it lives.** Free hosting on GitHub Pages, open source under the MIT licence, with no build tools or paid services involved.

## November 2026 — Hardening after an external review

The demo was put through a deliberately harsh review by another AI model. It made five points; most were fair and were acted on:

- **"Your governance gate stays green while running on bad data."** The checks were split into two tiers. Structural checks confirm the files are well-formed; operational checks compare what the systems believe with what is on the floor. With a defect switched on, the first tier stays green and the second turns amber. That is the lesson many data teams learn the hard way.
- **"Shoppers don't read databases."** True. The demo now says how the data reaches them: aisle signs and the store app come from the product record, and the "next customer, lane 3" board comes from the store record.
- **"It's a rigged demo."** The simulation itself no longer knows what a defect is. Defects are edits to the data files, and their cost shows up only because shoppers act on wrong information.
- **"Nobody cares about seconds; show money."** Walkouts and revenue at risk per hour were added. Annual figures were deliberately not, because the model is not calibrated to a real store.
- **One seed is an anecdote.** Every comparison now runs ten times with different random shoppers and shows the range.

The changes also surfaced findings nobody designed in. A wrong aisle record cut the reach of a promotional stand by about 40%, because the shoppers it misdirected used to walk past it. And the two defects partly hide each other, so fixing one can make the other look worse.
