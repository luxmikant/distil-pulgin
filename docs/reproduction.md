# Reproduction guide

Run Distil from a clean environment and reproduce the main result: a grounded project digest and token budget, generated from real agent sessions.

## Prerequisites

- Node.js >= 22.14
- pnpm (11.x)
- A TrueForge harness (via `npx @truefoundry/trueforge`)
- An OpenAI-compatible model endpoint and API key (for `distil digest`)

## Setup

```bash
git clone https://github.com/luxmikant/distil-plugin
cd distil-plugin
pnpm install
```

## Run the solution

1. Start the harness: `npx @truefoundry/trueforge` (serves on `http://localhost:8790`).
2. Configure a model provider in the harness Settings.
3. `pnpm distil init --root /path/to/project`
4. Do work with a coding agent on that project (chat UI or SDK).
5. `pnpm distil sync --root /path/to/project` (or `--watch`)
6. `DISTIL_LLM_BASE_URL=<url> DISTIL_LLM_API_KEY=<key> DISTIL_LLM_MODEL=<model> pnpm distil digest --root /path/to/project`
7. `pnpm distil ask "what does this project do?" --root /path/to/project`
8. `pnpm distil budget --root /path/to/project`
9. `pnpm distil serve --root /path/to/project` → `http://127.0.0.1:4173`

Expected output: a `PROJECT.ctx` in the project root with populated `sessions` and `budget`, a non-empty `digest`, and grounded `ask` answers.

## Run the baseline

The baseline is the manual process: answer the same questions by re-reading the project's code, commits, and chat logs *without* `PROJECT.ctx`. Use the same questions and record the tokens and time spent.

## Versions, runtime, cost

- Node 22.14+, pnpm 11.7.0, TypeScript 5.7, vitest 3.
- `distil sync` runs in seconds per session and makes no LLM calls.
- `distil digest` costs one small LLM call per refresh; the folded evidence is bounded in size.

## Verify the build

```bash
pnpm run typecheck
pnpm run test      # 29 tests
```
