# Improvement changelog

How Distil evolved, from the simplest baseline to the final result. Each entry records what was tried, why, and what the evidence showed.

| Stage | What was tried and why | Evidence | Decision / learning |
| --- | --- | --- | --- |
| Baseline | The manual process: a developer re-reads code, commits, and chat logs to answer "what does this project do and how was it built?". | Re-reading a mid-sized repo costs thousands of tokens and real human time per question. | Established the starting point: understanding is regenerated every time, never stored. |
| Iteration 1 | A pure fold engine that reduces harness session events into typed facts (usage, time, tools, files, approvals, threads) with the identity rule. | `packages/engine` folds; unit tests cover idempotency and no-double-count. | Kept. The fold is the core: deterministic, rebuildable, cheap. |
| Iteration 2 | An LLM digest in eight fixed sections, generated from folded evidence, plus a maintainer agent + skill with approval-gated writes. | `summarizer.ts` instruction pinned by tests; digest writes gated. | Kept. Splitting "folded facts" from "LLM interpretation" removed the risk of a mutable summary drifting. |
| Iteration 3 | `distil digest` + `distil serve` to close the loop (events → fold → digest → read) and give it a visual surface. | `distil digest` verified against a live model; `distil serve` serves the dashboard with zero runtime dependencies. | Kept. First end-to-end run surfaced the empty-digest failure mode below. |
| Iteration 4 | Folded error messages into session summaries and enriched digest evidence with raw events. | `errors` field + evidence lines covered by tests. | Kept. The digest is only as grounded as its evidence; folding richer facts fixed it. |
| Final | The full loop: fold → digest → ask/budget/render/serve, with the fold authoritative over the digest. | 29 unit tests, typecheck clean, live loop verified. | Identified the main contribution: understanding as a durable, evidence-traced artifact. |

## Main failure mode and hot take

**Failure mode:** the first end-to-end digest came back with every section `(none)` — not a parse bug, but the model correctly refusing to invent content for trivial sessions. The digest is only as good as the facts folded into it.

**Hot take:** derived facts must fold from an authoritative event stream, never from a mutable summary. Distil stores the *distillate* (typed facts) and regenerates prose from it; it never trusts a summary it has to edit in place. Build the durable record first, then let the LLM interpret it — not the other way around.
