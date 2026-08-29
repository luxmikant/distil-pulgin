# demo-project

The project the demo agent builds. Intentionally tiny: the hackathon rule is one narrow job done end to end, not a platform.

## The demo task (given to the TrueForge coding agent)

> Build a small HTTP service that stores a counter and exposes two endpoints:
> `POST /increment` (increments the counter, returns the new value) and
> `GET /value` (returns the current value). Persist the counter to a JSON
> file so it survives a restart. Add a `README` explaining how to run it.
> Use only the standard library — no dependencies.

The coding agent builds this through TrueForge (sandbox execution, tool calls, and one approval-gated step). Distil watches the session events, folds them into `PROJECT.ctx`, and afterwards answers:

- What does this project do?
- What were the feature requirements?
- How did the agent actually code it?
- What did it cost in tokens and time?

## Demo flow

1. `npx @truefoundry/trueforge` → http://localhost:8790, configure a model (DeepSeek works).
2. Register the skill: Settings → Skills → add this repo → `packages/skill` (or the repo root with path).
3. Create the coding agent in the chat UI (sandbox enabled), attach nothing else.
4. `pnpm distil init --root examples/demo-project --name demo-project`
5. `pnpm distil sync --watch`
6. Ask the agent to build the task above. Approve its `PROJECT.ctx` write when asked.
7. `pnpm distil ask "what does this project do and how was it built?"`, `pnpm distil budget`, `pnpm distil render`.
