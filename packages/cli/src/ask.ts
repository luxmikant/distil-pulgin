/**
 * Grounded answers: answer a question from the stored context document
 * without an LLM. Answers quote digest sections and folded evidence — a
 * retrieval, never a generation. The optional `--llm` path hands the same
 * grounding text to a harness agent and lets it compose.
 *
 * @module @distil/cli/ask
 */

import type { DistilContextV1, SessionEventItem, SessionSummary } from '../../engine/src/index.ts'
import { buildDigestRequest, renderMarkdown } from '../../engine/src/index.ts'
import type { TfClient, TurnInputItem } from './client.ts'

export interface AskResult {
  question: string
  answer: string
  /** The context lines the answer is grounded in. */
  grounding: string[]
  /** True when an LLM composed the answer over the grounding. */
  llmComposed: boolean
}

/**
 * Score-and-recall over the stored context. Deterministic: the same document
 * and question always produce the same grounding.
 */
export function askLocal(state: DistilContextV1, question: string): AskResult {
  const tokens = question.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2)
  const score = (text: string): number => {
    const lower = text.toLowerCase()
    let hits = 0
    for (const token of tokens) if (lower.includes(token)) hits += 1
    return hits
  }

  const lines: { text: string; score: number }[] = []
  for (const [name, bullets] of Object.entries(state.digest.sections)) {
    for (const bullet of bullets) {
      const s = score(`${name} ${bullet}`)
      if (s > 0) lines.push({ text: bullet, score: s })
    }
  }
  for (const [path, mention] of Object.entries(state.files)) {
    const s = score(path)
    if (s > 0) lines.push({ text: `${path} (first seen ${mention.firstSeenAt}, in ${mention.sessions.length} session(s))`, score: s + 1 })
  }
  for (const session of Object.values(state.sessions)) {
    for (const approval of session.approvals) {
      const s = score(`approval ${approval.kind}`)
      if (s > 0) lines.push({ text: `human checkpoint in ${session.sessionId}: ${approval.kind} at ${approval.at}`, score: s })
    }
  }

  lines.sort((a, b) => b.score - a.score)
  const grounding = lines.slice(0, 6).map(line => line.text)
  if (grounding.length === 0) {
    return {
      question,
      answer: 'No stored context matches this question yet. Sync more sessions (`distil sync`) or run a digest refresh.',
      grounding: [],
      llmComposed: false,
    }
  }
  return {
    question,
    answer: grounding.map((line, index) => `${index + 1}. ${line}`).join('\n'),
    grounding,
    llmComposed: false,
  }
}

/** Compose an answer with a harness agent, grounded in the same context. */
export async function askWithAgent(
  state: DistilContextV1,
  question: string,
  agentName: string,
  client: TfClient,
): Promise<AskResult> {
  const sessionId = await client.createSession(agentName)
  const ground = buildDigestRequest(state, Object.values(state.sessions), new Map<string, readonly SessionEventItem[]>())
  const input: TurnInputItem[] = [{
    type: 'user.message',
    content: `${ground.system}\n\n${renderMarkdown(state)}\n\nQuestion: ${question}\n\nAnswer using only the project context above. If the context does not establish an answer, say so.`,
  }]
  let answer = ''
  for await (const event of client.streamTurn(sessionId, input)) {
    if (event.type === 'model.message.delta' && typeof event.content === 'string') answer += event.content
  }
  if (answer.trim().length === 0) {
    return askLocal(state, question)
  }
  return {
    question,
    answer: answer.trim(),
    grounding: Object.values(state.digest.sections).flat().slice(0, 6),
    llmComposed: true,
  }
}

/** One-line session summary for `distil budget` and diagnostics. */
export function sessionLine(session: SessionSummary): string {
  return `${session.sessionId}: ${session.turns} turn(s), in ${session.usage.inputTokens} + out ${session.usage.outputTokens} tokens${session.usageEstimated ? ' (estimated)' : ''}, llm ${(session.time.llmMs / 1000).toFixed(1)}s, tools ${(session.time.toolMs / 1000).toFixed(1)}s`
}
