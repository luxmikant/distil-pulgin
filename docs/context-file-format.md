# The `.ctx` context-file format

`PROJECT.ctx` is Distil's deliverable: a versioned, structured, locally stored description of a project that an LLM can consume natively and a developer can read cheaply. It is deliberately **not** Markdown — it is typed JSON with a Markdown *projection* for humans.

## Design rules

1. **Evidence over prose.** Every claim that can be traced to a recorded session event carries that trace (`sessionId`, `turnId`, `eventId`). The digest records which session ids it was generated from.
2. **Fold wins over digest.** `trajectory`, `budget`, and `sessions` are folded mechanically from TrueForge events. The `digest` is LLM-generated and can be wrong; a mismatch is a bug in the digest, never a reason to edit folded facts.
3. **Versioned.** `formatVersion` gates the whole document. Version 1 is frozen below. A breaking change requires a new version and an upgrade path in the same PR.
4. **Append-friendly.** Session summaries are append-only history; the engine never rewrites a closed session's folded facts.

## Schema (formatVersion 1)

```jsonc
{
  "formatVersion": 1,
  "project": {
    "name": "demo-project",
    "root": "E:/dsh/trueforge-distil/examples/demo-project",
    "updatedAt": "2026-08-29T12:00:00Z"
  },
  "digest": {
    "generatedAt": "2026-08-29T12:00:00Z",
    "fromSessions": ["sess-01..."],
    "sections": {
      "primaryRequestAndIntent": ["..."],
      "keyTechnicalConcepts": ["..."],
      "filesAndCode": ["path: why it matters, key changes"],
      "errorsAndFixes": ["error: how it was resolved"],
      "pendingJobs": ["..."],
      "currentWork": ["..."],
      "nextStep": ["..."],
      "criticalContext": ["decisions, rationale, constraints"]
    }
  },
  "trajectory": {
    "sessions": [
      {
        "sessionId": "sess-01...",
        "title": "build checkout retry",
        "turns": 12,
        "startedAt": "...",
        "endedAt": "...",
        "threads": [
          { "threadId": "main", "title": null, "parent": null },
          { "threadId": "thr-02...", "title": "analyze retry logic", "parent": { "threadId": "main", "toolCallId": "call-01..." } }
        ],
        "approvals": [{ "eventId": "evt-...", "toolCallId": "call-...", "at": "..." }]
      }
    ]
  },
  "budget": {
    "total": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0 },
    "estimated": false,
    "time": { "llmMs": 0, "toolMs": 0, "ttftMs": 0, "ttftSamples": 0, "decodeMs": 0, "decodeTokens": 0 }
  },
  "tools": {
    "usage": { "<toolName>": { "calls": 0, "approvals": 0 } }
  },
  "files": {
    "mentions": { "<relativePath>": { "firstSeenAt": "...", "lastSeenAt": "...", "sessions": ["..."] } }
  }
}
```

## Named sections

`digest.sections` uses fixed names (never drop one, "(none)" when empty). This is the structure a compaction-class LLM summarizes into, adapted from the DeepSeek Harness compaction checkpoint:

- `primaryRequestAndIntent` — the original and evolving goals (quote verbatim where exact wording matters)
- `keyTechnicalConcepts` — technologies, frameworks, patterns, conventions
- `filesAndCode` — exact path: why it matters, key changes
- `errorsAndFixes` — error: how it was resolved
- `pendingJobs` — explicitly requested work not yet completed
- `currentWork` — what was in progress at the last digest
- `nextStep` — the single next action, or "(none)"
- `criticalContext` — decisions and their rationale, constraints, preferences, open questions

## Token accounting

`budget` folds only provider-reported `usage` payloads. TrueForge event shapes vary by provider (`input_tokens`/`output_tokens` or `prompt_tokens`/`completion_tokens`); the fold normalizes both. When no provider reported usage for a turn, the wallet contributes nothing and `estimated` stays `false`. The chars/4 estimator is available as an explicit, separately labeled figure (`estimated: true`) and is never presented as exact.

## Updating the file

Writers: (1) the `distil-cli` engine on `sync`/`watch` (folded facts), and (2) the `distil-maintainer` TrueForge agent (digest section), whose writes to `PROJECT.ctx` are approval-gated. Both write the whole document atomically (temp file + rename).
