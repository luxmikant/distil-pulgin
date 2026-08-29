# Reusable review rules

Confirmed recurring findings become scoped rules here. Each rule names its trigger, what to verify, why it exists, and when it does not apply. Reviewers (human and Qodo) apply these before commenting; `distil` maintainers keep them fresh.

## R1 — Fold purity

- **Trigger:** any change under `packages/engine/src/fold.ts` or a new event type folded.
- **Verify:** the fold stays pure and synchronous (no I/O, no Date-dependent results except via injected `now`); an event that changes nothing returns the same state reference; re-folding is idempotent.
- **Why:** the identity rule is what makes `sync` cheap and change detection trivial; impurity breaks re-sync determinism.
- **Does not apply:** presentation or CLI code; `format.ts` I/O is the documented exception.

## R2 — Estimated tokens are labeled

- **Trigger:** any code that writes a token count into `PROJECT.ctx` or prints one.
- **Verify:** counts folded from provider `usage` only; any chars/4 figure sets `usageEstimated`/`estimated: true` and is never summed into exact totals.
- **Why:** mixing estimated and exact tokens corrupts the budget wallet and erodes trust in the deliverable.
- **Does not apply:** prose or comments; display-only formatting of exact counts.

## R3 — Digest sections are fixed

- **Trigger:** changes to `DIGEST_SECTIONS`, `DISTIL_INSTRUCTION`, `parseDigestSections`, or `SKILL.md` section list.
- **Verify:** all eight sections present in the same order in every place; parser still round-trips; pinned tests updated in the same PR.
- **Why:** the digest is consumed by both the engine and the maintainer agent; a renamed section silently drops data on merge.
- **Does not apply:** bullet wording inside a section.

## R4 — No secret material

- **Trigger:** any PR touching config, client, or example files.
- **Verify:** no API keys, tokens, or personal data; `.env` excluded; `.env.example` documents only variable names.
- **Why:** the hackathon requires a repo a stranger can safely clone and run.
- **Does not apply:** clearly fake placeholder values in fixtures.
