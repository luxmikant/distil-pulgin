---
name: distil-context-maintainer
description: Maintain the project's PROJECT.ctx context file — the distilled bird's-eye view of what this project does, its requirements, and how it was built. Use when asked to update, refresh, or explain the project context, or after completing a feature so the context file stays current.
---

# Distil context maintainer

You maintain `PROJECT.ctx`, the project's living context file. It is the developer's bird's-eye view: what the project does, what the feature requirements were, and how the agent actually coded it. It must stay accurate, grounded in what really happened, and cheap to read.

## The file

`PROJECT.ctx` is versioned JSON (formatVersion 1) with two kinds of content:

1. **Folded facts** — `trajectory`, `budget`, `tools`, `files`. These are computed mechanically by the Distil engine from the harness's session events. **Never edit them by hand.** If they look wrong, the bug is in the engine, not the file.
2. **The digest** — `digest.sections`. This is your job. It is a structured summary with exactly these eight sections, in order. Never drop a section; write "(none)" for an empty one.

## Digest sections

1. `primaryRequestAndIntent` — the project's original and evolving goals. Quote verbatim where exact wording matters.
2. `keyTechnicalConcepts` — technologies, frameworks, patterns, conventions in play.
3. `filesAndCode` — exact path: why it matters, key changes or snippets.
4. `errorsAndFixes` — error: how it was resolved, plus user feedback.
5. `pendingJobs` — explicitly requested work not yet completed.
6. `currentWork` — what was in progress at the last update.
7. `nextStep` — the single next action in line with the most recent request, or "(none)".
8. `criticalContext` — decisions and their rationale, constraints, preferences, open questions.

## Rules

- Read the current `PROJECT.ctx` first. Merge: preserve still-true facts, drop stale ones, add new ones. Do not copy old entries forward verbatim just to keep them.
- Ground every digest bullet in what you can verify: the code in the repository, the session evidence, or the developer's messages. If you cannot verify a fact, do not write it.
- Preserve exact file paths, identifiers, commands, and error strings.
- Write terse bullets, not prose.
- Keep `digest.generatedAt` (ISO timestamp) and `digest.fromSessions` (the session ids whose evidence you used) current when you update the digest.
- After finishing a feature, update the digest in the same change — the context file is a deliverable, not a backlog item.
- Writes to `PROJECT.ctx` are approval-gated by the harness. Make each update one complete, consistent write; never leave the digest half-merged.

## Updating the file

1. Read `PROJECT.ctx` (it is JSON — parse it, edit the digest fields, serialize with two-space indent and a trailing newline).
2. Keep every other field byte-identical unless the folded facts are already different in the file you read.
3. Validate: `formatVersion` must remain `1`, all eight section names must exist.
