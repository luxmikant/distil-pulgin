# AGENTS.md — trueforge-distil

Distil: a project-context engine over the TrueForge agent harness. The engine folds the harness's session-event stream into a versioned local context file (`PROJECT.ctx`) and answers developer questions from it.

## Repository conventions

- Node >= 22.14 (TrueForge requirement), pnpm workspaces, ESM everywhere (`"type": "module"`), strict TypeScript.
- `packages/engine` is a pure library: no network, no LLM calls, no filesystem writes outside `format.ts` (explicit). Folds are synchronous pure functions over event items; an event that does not change state MUST return the same state reference (identity rule, inherited from DeepSeek Harness projection semantics).
- `packages/cli` owns all TrueForge SDK/HTTP access, file I/O, and user interaction.
- The `.ctx` file is versioned (`formatVersion`); `format.ts` rejects unknown versions. Backwards-incompatible changes bump the version in the same PR.
- Facts in `.ctx` are derived from recorded session events. When the LLM digest disagrees with folded evidence, the fold wins; the digest records which sessions it was generated from.
- Model-visible prompts are pinned as constants in `engine/src/summarizer.ts`; any change updates the pinned-output test.

## TrueForge contract

- Event shapes follow the TrueForge turn-events reference (`turn.created`, `turn.done`, `model.message`, `model.message.delta`, `tool.response`, `thread.created`, `thread.done`, `sandbox.created`, `tool.approval_required`, `tool.response_required`, `mcp.initialize`). Unknown event types are ignored, never thrown away silently in tests.
- Token counts are folded only from provider-reported `usage`; the chars/4 heuristic fallback is always labeled `estimated: true`. Never present estimated tokens as exact.
- The distil-maintainer agent must never overwrite `PROJECT.ctx` without `tool.approval_required` gating (control & safety judging criterion).

## Code review workflow (Qodo)

This repo targets the hackathon's Best Code Quality track. Qodo is the independent reviewer harness: it reviews every PR from a context separate from any coding agent's.

1. **Pre-PR review.** Before opening a PR: `pnpm run test && pnpm run typecheck`, self-review against the PR template, check for scope drift, missing tests, and review-readiness.
2. **Task-level context.** Every PR description follows `.github/PULL_REQUEST_TEMPLATE.md`: goal, acceptance criteria, non-goals, design rationale, affected systems, risks, test evidence, rollout plan, open questions.
3. **Layered engineering context.** Summarize the change, show before/after behavior, map dependencies and blast radius, and link assertions to code or tests in the PR description.
4. **Findings by risk.** Engage with Qodo findings ranked by impact, likelihood, confidence, exposure, reversibility. Fix every valid High. Dismiss only with a recorded reason in the Qodo thread.
5. **Comment budget.** When responding or reviewing, lead with the 3–5 most material findings; group the minor ones.
6. **Verify with tools.** Diff analysis plus targeted tests, typecheck, and repository search; never claim a fix without running the check.
7. **Dialogue.** Challenge findings, ask for proof, state missing context; update confidence when new evidence invalidates an assumption.
8. **Reusable rules.** Confirmed recurring issues become scoped rules in `docs/review-rules.md` with trigger, what to verify, why, and exceptions.
9. **Qodo accelerates, humans decide.** The reviewer reduces comprehension effort; merge decisions stay with the developer.

## Commit and PR hygiene

- Branch per change; no direct pushes to main. Commit messages that a stranger can follow.
- One narrow job per PR. Split independent changes.
- Never commit secrets or model keys. `.env` is gitignored; `.env.example` documents what is needed.
- Every PR that changes model-visible text updates its pinned test.

## Files

- Files end with exactly one trailing newline.
- No dead code, no commented-out blocks; comments state contract, not narration.
