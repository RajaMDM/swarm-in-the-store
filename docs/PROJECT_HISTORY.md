# Project History

*A plain-language account of what was built and why, for non-technical readers.*

## November 2026 — From article to working demo

**Why it exists.** The article *The Swarm in the Store* argued two things: swarm-style simulation lets retailers rehearse decisions safely, and any such simulation is only as believable as the master data underneath it. An argument is easy to nod along to. A working demo is harder to dismiss, so this project turns the article's first use case, store footfall, into something anyone can open in a browser and try.

**What was built.** A top-down store where simulated shoppers, each on a different mission (a quick top-up, a browse, a family shop, a click-and-collect pickup), walk the aisles, queue and leave. Visitors can change the layout, move a promotional stand, open or close checkouts and make the store busier. Hotspots and queues appear on their own; nobody programs them in.

**The key feature: bad data, made visible.** One switch introduces two everyday data defects: a product category still recorded in its old aisle after a refit, and a checkout lane still listed as open after it was removed. One button runs the same customers through the store with clean and dirty data side by side. The difference shows up as longer visits, longer queues and items customers gave up on.

**Governance before results.** The demo checks its own data before it runs: every category has a shelf, every aisle can be reached, customer groups add up to 100%. If a check fails, the simulation will not start. That is the article's point in practice.

**A problem found and fixed during the build.** The first version showed dirty data *improving* queue times. Investigation found shoppers gridlocked behind people standing at the closed lane, and the averages only counted those who escaped. Shoppers can now step around blockages, and every average includes people still in the store. An automated test now guards against this returning.

**Where it lives.** Free hosting on GitHub Pages, open source under the MIT licence, with no build tools or paid services involved.
