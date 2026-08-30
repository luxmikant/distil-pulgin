# The `.ctx` context-file format

`PROJECT.ctx` is Distil's deliverable: a versioned, structured, locally stored description of a project that an LLM can consume natively and a developer can read cheaply. It is deliberately **not** Markdown — it is typed JSON with a Markdown *projection* for humans.

## Design rules

1. **Evidence over prose.** Every fact that can be traced to a recorded session event carries that trace. Folded facts are rebuilt from events; the digest records which session ids it was generated from.
2. **Fold wins over digest.** `sessions`, `budget`, `tools`, and `files` are folded mechanically from TrueForge events. The `digest` is LLM-generated and can be wrong; a mismatch is a bug in the digest, never a reason to edit folded facts.
3. **Versioned.** `formatVersion` gates the whole document. Version 1 is described below. A breaking change requires a new version and an upgrade path in the same PR.
4. **Append-friendly.** Session summaries are rebuilt deterministically from their events; re-folding never double-counts.

## Schema (formatVersion 1)

```jsonc
{
  "formatVersion": 1,
  "project": {
    "name": "demo-project",
    "root": "/path/to/project",
    "updatedAt": "2026-08-29T12:00:00Z"
  },
  "digest": {
    "generatedAt": "2026-08-29T12:00:00Z",
    "fromSessions": ["sess-01..."],
    "sections": {
      "primaryRequestAndIntent": ["..."],
      "keyTechnicalConcepts": ["..."],
      "filesAndCode": ["path: why it matters"],
      "errorsAndFixes": ["error: how it was resolved"],
      "pendingJobs": ["..."],
      "currentWork": ["..."],
      "nextStep": ["..."],
      "criticalContext": ["..."]
    }
  },
  "sessions": {
    "sess-01...": {
      "sessionId": "sess-01...",
      "turns": 12,
      "startedAt": "...",
      "endedAt": "...",
      "usage": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
      "usageEstimated": false,
      "time": { "llmMs": 0, "toolMs": 0, "ttftMs": 0, "ttftSamples": 0, "decodeMs": 0, "decodeTokens": 0 },
      "approvals": [{ "eventId": "...", "kind": "approval", "toolCallIds": ["..."], "at": "..." }],
      "threads": [{ "threadId": "main", "title": null, "parent": null }],
      "sandboxes": 0,
      "errors": ["Request failed (402): Insufficient Balance"],
      "toolUsage": { "<tool>": { "calls": 0, "approvals": 0 } },
      "fileMentions": { "<path>": { "firstSeenAt": "...", "lastSeenAt": "..." } }
    }
  },
  "budget": {
    "usage": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
    "usageEstimated": false,
    "time": { "llmMs": 0, "toolMs": 0, "ttftMs": 0, "ttftSamples": 0, "decodeMs": 0, "decodeTokens": 0 }
  },
  "tools": { "<tool>": { "calls": 0, "approvals": 0 } },
  "files": { "<path>": { "firstSeenAt": "...", "lastSeenAt": "...", "sessions": ["..."] } }
}
```

## Named sections

`digest.sections` uses fixed names (never drop one, "(none)" when empty). This is the structure a compaction-class LLM summarizes into, adapted from a standard compaction checkpoint:

- `primaryRequestAndIntent` — the original and evolving goals (quote verbatim where exact wording matters)
- `keyTechnicalConcepts` — technologies, frameworks, patterns, conventions
- `filesAndCode` — exact path: why it matters, key changes
- `errorsAndFixes` — error: how it was resolved
- `pendingJobs` — explicitly requested work not yet completed
- `currentWork` — what was in progress at the last digest
- `nextStep` — the single next action, or "(none)"
- `criticalContext` — decisions and their rationale, constraints, preferences, open questions

## Token accounting

`budget.usage` folds only provider-reported `usage` payloads. TrueForge event shapes vary by provider (`input_tokens`/`output_tokens` or `prompt_tokens`/`completion_tokens`); the fold normalizes both. When no provider reported usage for a turn, the wallet contributes nothing and `usageEstimated` is set. Estimation is never presented as exact.

## Updating the file

Writers: (1) the `distil-cli` engine on `sync`/`watch` (folded facts), and (2) the `distil-maintainer` TrueForge agent (digest section), whose writes to `PROJECT.ctx` are approval-gated. Both write the whole document atomically (temp file + rename).
