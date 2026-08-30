# Evaluation

## Primary metric

**Tokens to answer a project-understanding question.** The user's bottleneck is the token cost of re-understanding their own project. Distil's promise is a large reduction in that cost, measured by comparing the tokens spent answering the same questions with and without Distil.

## Baseline vs Distil

The baseline is the manual process: recover project understanding by re-reading code, commits, and chat logs. Distil folds the harness event stream into `PROJECT.ctx` once and answers from it afterwards.

| Metric | Baseline (manual re-reading) | Distil |
| --- | --- | --- |
| Primary outcome — tokens to answer "what does this project do and how was it built?" | proportional to repo size, every time | one small `digest` LLM call, amortized |
| Human time per task | minutes to hours of re-reading | seconds (one `distil ask`) |
| Cost per task | scales with every question | fixed, stored context |

Fairness: both get the same project, the same questions, and the same harness sessions. Distil additionally persists the distilled context; the baseline regenerates it each time.

## Evaluation plan

Run both approaches on the same set of 10+ project-understanding questions across at least one non-trivial agent-built project, plus one challenging case: a project where a fix happened in a session the developer never summarized — the answer exists only in the event stream. Report every result, including where Distil declines ("no stored context matches") rather than hallucinating.

Every claim traces to evidence: a folded fact, a session id, or a digest section. The numbers for the table above are produced by running this plan, which the reproduction guide makes repeatable.
