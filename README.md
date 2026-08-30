# Distil

Capture the project knowledge your coding agents create — and reuse it for a few tokens, not a fortune.

Distil is a project-context engine for agent coding harnesses. It watches the event stream a coding agent produces, distills it into a versioned `PROJECT.ctx` file, and answers questions about your project from that file — grounded in what actually happened, not in a re-generation.

## The problem

When a coding agent builds your project, you pay two token bills: the tokens spent *generating* code, and the tokens spent *understanding* the project later. The second bill is hidden inside session transcripts. Every architectural decision, trade-off, and fix lives only in conversation logs — come back in a week and recovering that context means re-reading code, commits, and logs, thousands of tokens at a time.

Distil removes the second bill. It folds the harness's event stream into a durable, evidence-traced context file *while the agent works*, and answers grounded questions from it afterwards.

## Quickstart

Requirements: Node.js >= 22.14 and pnpm.

```bash
# 1. Start an agent harness (TrueForge — one command, no clone)
npx @truefoundry/trueforge            # -> http://localhost:8790

# 2. Clone and install Distil
git clone https://github.com/luxmikant/distil-plugin && cd distil-plugin
pnpm install

# 3. Point Distil at your project and start watching the harness
pnpm distil init --root /path/to/your/project
pnpm distil sync --watch --root /path/to/your/project

# 4. Do work with any agent on that project, then generate the digest
DISTIL_LLM_BASE_URL=... DISTIL_LLM_API_KEY=... DISTIL_LLM_MODEL=... \
  pnpm distil digest --root /path/to/your/project

# 5. Ask grounded questions, inspect the budget, open the dashboard
pnpm distil ask "what does this project do and how was it built?" --root /path/to/your/project
pnpm distil budget --root /path/to/your/project
pnpm distil serve --root /path/to/your/project   # -> http://127.0.0.1:4173
```

## Commands

| Command | What it does |
| --- | --- |
| `distil init` | Create a `PROJECT.ctx` for a project. |
| `distil sync [--watch]` | Fold harness session events into `PROJECT.ctx`. |
| `distil digest` | Generate the LLM digest from folded evidence. |
| `distil ask <q> [--llm]` | Answer a question from stored context. |
| `distil budget` | Print the token + time wallet across sessions. |
| `distil render` | Project `PROJECT.ctx` to Markdown. |
| `distil serve` | Open the web dashboard. |

## How it works

The harness emits a stream of session events (`turn.created`, `model.message`, `tool.response`, …). Distil's engine reduces that stream with pure, synchronous *folds* into typed facts — token usage, wall-clock time, tool calls, file mentions, approvals, subagent threads, and error messages — and writes them to `PROJECT.ctx`. A second, LLM-generated *digest* summarizes the project in eight fixed sections.

Two writers update the file, and they never collide: folded facts are mechanical and rebuilt deterministically from events; the digest is an interpretation. **The fold wins** — a disagreement is a bug in the digest, never a reason to edit a folded fact.

## Documentation

- [Architecture](docs/architecture.md) — design and component map
- [Context file format](docs/context-file-format.md) — the `PROJECT.ctx` schema
- [Reproduction guide](docs/reproduction.md) — run it from a clean environment
- [Evaluation](docs/evaluation.md) — baseline vs Distil

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
