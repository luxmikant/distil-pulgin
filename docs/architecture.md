# Distil architecture — and the DeepSeek Harness inspiration catalog

Distil is a context engine over the TrueForge harness. This document states the design and, for every component, which DeepSeek Harness (DSH) component it draws from. DSH is open source (`github.com/deepseek-ai/deepseek-harness`); every reference below names the exact file in that repo.

## The core idea, restated

LLM inference ingests prompts in chunks and builds its KV cache from the queries themselves. Distil applies that shape to *project knowledge*: while agents work through a harness, a small engine ingests the harness's event stream in chunks, builds a stored understanding of the project, and answers questions **grounded in that stored understanding** — not in a re-generated, hallucinated one. The LLM is good at generating raw context; Distil is the layer that manages and transforms raw context into informative insight.

## Data plane

| Distil concept | TrueForge mechanism | DSH inspiration |
|---|---|---|
| Raw trajectory | Session/turn events (`GET /sessions/{id}/events` → `{turnId, event}`; live SSE `createTurn` stream with sequence numbers) | The event-sourced session log: `SessionEventMap` in `packages/core/session/src/types.ts` (turn/step boundaries, `assistant/chunk`, `tool/call`, `tool/result`, `request/header`) |
| The fold (the "intelligence engine") | `distil-engine` pure synchronous folds over event items, identity-gated | `ProjectionDefinition<K,S>` (`{ key, init, apply(state, event), stateVersion }`) in `packages/session/session-projection/src/index.ts`; exemplar folds: `session-stats/src/projection.ts`, `llm/token-meter/src/usage-projection.ts` |
| The digest | `PROJECT.ctx` `digest` section, LLM-generated from folded evidence | Compaction summarizer: `COMPACTION_INSTRUCTION` in `packages/compaction/compaction-basic/src/summarizer.ts` — the 8-section structure Distil adapts (Primary Request and Intent, Key Technical Concepts, Files and Code, Errors and Fixes, Pending Jobs, Current Work, Next Step, Critical Context) |
| Token + time wallet | Fold over `model.message.usage` + event timestamps | `packages/llm/token-meter/` (`measure()`, `deriveTurnTokenUsage`, `usage`/`contextPressure` projections) and `packages/session/session-stats/` (`ttftMs`, `decodeMs`, `toolMs`) |
| Structured context vocabulary | `.ctx` sections consumed natively by LLMs and rendered for humans | `ContextForm` (`instructions | catalog | snapshot | notice | relay | recall`) in `packages/llm/llm/src/message.ts`; `.ctx` `digest` is a `snapshot`-form context with named sections |
| Session lineage / subagent tree | `thread.created`/`thread.done` with `parent.threadId` + `parent.toolCallId` | `packages/session-query/` lineage traces (`traceSession`, `traceEvent` with `sourceEventSeqs`/`derivedEventSeqs`) |
| Persisted, versioned artifact | `PROJECT.ctx` atomic writes, `formatVersion` | `packages/storage/storage-json/` (atomic rewrite per document) + projection cache `(sessionId, key, ver, seq, val)` invalidation semantics |
| Approvals as first-class log facts | `tool.approval_required` events recorded in the fold | DSH approval events + the rule "model-visible ⟺ logged" — Distil folds approval pauses into the trajectory so the record of human control is durable |

## What DSH does that Distil deliberately inherits as *rules*

1. **Derived facts fold from an authoritative event stream; never store-forever a mutable summary as the only copy.** DSH deleted its mutable `SessionSummary` row for exactly this reason (`drop-mutable-session-summary` Agent Note). In Distil, `PROJECT.ctx` is rebuildable by re-folding the recorded events; the digest records its evidence window.
2. **Identity rule.** A fold event that changes nothing returns the same state reference — zero downstream work, cheap change detection.
3. **Versioned state.** A format or fold-semantics change bumps a version; stale persisted state is discarded, never forward-applied.
4. **Exact tokens only from provider reports.** Estimation is explicit and labeled (DSH `token-meter` uses chars/4 and documents it as non-billing-grade).
5. **Whole-value writes, no silent deltas.** Every `.ctx` write carries the complete post-change document.

## What Distil adds that DSH does not have

- **Project scope:** DSH is per-session; Distil keys context by project, summing across all sessions/subagents.
- **A durable context file as a deliverable:** `PROJECT.ctx` is a committed repo artifact, not an in-process read model.
- **Dollar cost math** (DSH has tokens only).
- **A rendering surface** for the bird's-eye view: `distil render` + the digest Markdown projection.

## Component map

```
TrueForge turn stream                distil-engine
─────────────────────                ─────────────
turn.created            ──▶  session/turn index
model.message (+usage)  ──▶  digest evidence + token wallet + llm time
model.message.delta     ──▶  ttft / decode timing
tool.response           ──▶  tool ledger + tool time + file-change evidence
thread.created/done     ──▶  subagent tree (graph input)
sandbox.created         ──▶  sandbox usage record
tool.approval_required  ──▶  human-checkpoint record
turn.done               ──▶  terminal turn metrics
```

## Demo domain

The demo hands a TrueForge coding agent one narrow job on `examples/demo-project`. Distil watches, folds, and answers. One job done end to end beats a platform with three half-finished features (hackathon best practice #2).
