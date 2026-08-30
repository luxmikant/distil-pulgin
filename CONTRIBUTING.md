# Contributing

Thanks for considering contributing to Distil.

## Getting started

```bash
git clone https://github.com/luxmikant/distil-plugin
cd distil-plugin
pnpm install
pnpm run typecheck
pnpm run test
```

## Development workflow

1. Branch per change; no direct pushes to `main`.
2. One narrow change per pull request.
3. Write tests for non-trivial changes. A change to model-visible text updates its pinned test.
4. Before opening a PR, run `pnpm run test && pnpm run typecheck`.
5. Follow the pull request template in `.github/PULL_REQUEST_TEMPLATE.md`.

## Code review

Every pull request is reviewed by Qodo before merge. Findings are ranked by severity:

- Fix every valid **High** finding.
- If a High finding is wrong, deferred, or intentional, dismiss it in the Qodo thread with a recorded reason.
- Medium and Low findings are the author's engineering call.

Push updates to re-run the review so the PR records what was resolved or dismissed. A human merges.

## Conventions

- ESM everywhere, strict TypeScript.
- `packages/engine` is a pure library — no network, no LLM calls, no filesystem writes outside `format.ts`.
- `packages/cli` owns all network and file I/O.
- Facts in `.ctx` fold from recorded events; the fold wins over the digest.
- Never commit secrets or model keys. `.env` is gitignored; `.env.example` documents what is needed.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
