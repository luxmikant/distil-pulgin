# Distil

**An intelligent project-context engine for the [TrueForge](https://github.com/truefoundry/trueforge) agent harness.**

When a coding agent builds your project, two token bills exist: the tokens spent *generating* code, and the tokens spent *understanding* the project later. Distil removes the second bill: it watches every event the TrueForge harness emits while agents work on your project, distills the raw trajectory into a local, versioned context file — **`PROJECT.ctx`** — and gives you a bird's-eye view of your own project for **X tokens instead of a fortune**.

Built for the [Agent Harness Hackathon](https://www.wemakedevs.org/hackathons/trueforge) (Aug 24–30, 2026). Architectural inspiration: the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (see [docs/architecture.md](docs/architecture.md)).

---

## The problem

A chatbot answers questions. An agent acts on them — and while it acts, it *decides*: how the system is organized, which trade-offs were made, why each choice exists. That knowledge accumulates invisibly inside session transcripts. When you (the developer) come back a week later, the only way to recover it is to spend a huge number of tokens re-reading code, commits, and conversation logs.

**Distil's answer:** spend a fixed, small budget *while the agent builds*, and get an engine that maintains your understanding as a first-class artifact — the `.ctx` file.

## What Distil gives you

- **What does our project do?** A structured digest, maintained continuously.
- **What are the feature requirements?** The agent's original goals and how they evolved.
- **How did the agent actually code it?** Files, decisions, errors, fixes — traced to real session events.
- **What did it cost?** A token + time wallet across every session (input/output tokens, time-to-first-token, tool time).
- **Grounded answers.** `distil ask "why does checkout retry 4 times?"` answers from the stored `.ctx` + recorded session evidence, never from a hallucination.

## Quickstart

```bash
# 1. Run TrueForge locally (one command, no clone)
npx @truefoundry/trueforge@latest
# -> http://localhost:8790 (configure a model provider in Settings, e.g. DeepSeek)

# 2. Install Distil
git clone <this-repo> && cd trueforge-distil
pnpm install && pnpm build

# 3. Point Distil at the harness, initialize the project context
pnpm distil init --base-url http://localhost:8790

# 4. Do work with any TrueForge agent on this project (chat UI, SDK, whatever).
#    Then fold the harness's event stream into the context file:
pnpm distil sync

# 5. Ask grounded questions
pnpm distil ask "what does this project do and how was it built?"

# 6. Inspect the budget
pnpm distil budget
```

The `.ctx` file is plain versioned JSON (see [docs/context-file-format.md](docs/context-file-format.md)) with a Markdown projection. Commit it like any other artifact.

## The 3-minute demo

1. Start TrueForge + Distil (`distil sync --watch`).
2. Ask a TrueForge coding agent to build `examples/demo-project` (a small feature).
3. Show the chat UI: tool calls, **sandbox** execution, and the **approval pause** before the agent overwrites `PROJECT.ctx`.
4. Approve. `distil ask` the questions above — answers are grounded in recorded session events.
5. Show `distil budget` — the token/time wallet across all sessions.

## How TrueForge does the real work

| Harness capability | Where Distil uses it |
|---|---|
| **Session events API** (`GET /sessions/{id}/events`, SSE turn streams) | The raw trajectory Distil folds — `turn.created`, `model.message` (+ `usage`), `tool.response`, `thread.created`/`thread.done` for subagents |
| **Skills** (git-backed `SKILL.md`, progressive disclosure) | `packages/skill` — teaches the agent to maintain `PROJECT.ctx` |
| **Sandbox-as-tool** | The agent reads repo files and runs Distil's scripts inside the sandbox |
| **Human checkpoints** (`tool.approval_required`) | Rewriting `PROJECT.ctx` is approval-gated — the control-and-safety moment in the demo |
| **Compaction** | Harness-side context management; Distil's digest survives compaction because it lives *outside* the agent's working context |
| **Subagents** | Parallel per-file analysis threads, merged into the digest |

## Architecture

```
TrueForge harness ──events──▶ distil-cli ──fold──▶ distil-engine ──▶ PROJECT.ctx
   (agent loop)      (SDK/SSE)   (watch/sync)      (pure folds)      (versioned JSON)
                                                                         │
   ┌─────────────────────────────────────────────────────────────────────┤
   ▼                                                                     ▼
distil ask / budget ──────────────▶ grounded answers              distil-maintainer agent
                                                                   (TrueForge skill, sandbox)
```

See [docs/architecture.md](docs/architecture.md) for the full design and the DeepSeek Harness inspiration catalog.

## Repo layout

```
packages/engine/   Pure folds: trajectory, digest sections, token/time wallet, .ctx format
packages/cli/      TrueForge SDK client, sync/watch daemon, ask/budget commands
packages/skill/    SKILL.md pack for the distil-maintainer agent
agents/            TrueForge AgentSpec for the distil-maintainer agent
docs/              architecture, context-file format
examples/          demo project the demo agent builds
tests/             unit tests for the folds
```

## Qodo Code Review Evidence

> Required by the hackathon. Every substantive change in this repo merges through a pull request reviewed by Qodo.

- Representative PR: **\<link to a merged PR containing meaningful hackathon code\>**
- What Qodo surfaced and what we did: **\<1–2 sentences: the material findings, which were fixed, which were intentionally dismissed and why\>**
- Review history: **\<link showing the completed review, our replies/dismissals, and a follow-up review against final code\>**

## License

MIT. This project is not affiliated with TrueFoundry or DeepSeek.
