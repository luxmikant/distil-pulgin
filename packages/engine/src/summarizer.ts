/**
 * The digest summarizer: Distil's "manage and transform" layer.
 *
 * The LLM is good at generating raw context; this module frames the call
 * that turns folded session evidence into the project digest. The
 * instruction is adapted from the DeepSeek Harness compaction engine
 * (`COMPACTION_INSTRUCTION` in dsh-compaction-basic/summarizer.ts), retargeted
 * from "resume a conversation" to "maintain a project's understanding".
 *
 * @module @distil/engine/summarizer
 */

import type { Digest, DigestSections, DistilContextV1, SessionEventItem, SessionSummary } from './types.ts'
import { DIGEST_SECTIONS } from './types.ts'

/**
 * The summarization directive, delivered as the final user message after the
 * evidence transcript (mirrors the DeepSeek Harness's prefix-cache-reusing
 * pattern). Model-visible text: pinned by tests — any change updates the
 * pinned-output test.
 */
export const DISTIL_INSTRUCTION = [
  'You are now acting as the context engine for an AI-built project. The evidence below is a condensed transcript of what a coding agent did in this project (session records, tool calls, and outcomes). Produce a structured project digest that lets a developer — and a future agent — understand the project without re-reading anything else.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the project's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at the last evidence]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Only state facts grounded in the evidence provided. If the evidence does not establish something, leave it out rather than guessing.',
  '- Do NOT mention this summarization request or that the context was distilled.',
  '- Output only the digest text: do not call any tool or take any other action.',
  '- If a PRIOR DIGEST is provided below, it is the existing project digest. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated digest under the same structure.',
].join('\n')

/** Evidence excerpt limits keep the summarization call small (X-token budget). */
const EVIDENCE_LIMITS = {
  turns: 40,
  tools: 12,
  files: 12,
  chars: 600,
} as const

/**
 * Build the summarization prompt for one digest refresh.
 * @param state - current context document (provides the prior digest to merge).
 * @param sessions - folded session summaries supplying the evidence window.
 * @param itemsBySession - raw events per session, for grounding detail beyond the summaries.
 * @returns messages to send after any system prompt of the consumer's choosing.
 */
export function buildDigestRequest(
  state: DistilContextV1,
  sessions: readonly SessionSummary[],
  itemsBySession: ReadonlyMap<string, readonly SessionEventItem[]>,
): { system: string; user: string } {
  const evidence = sessions.map(session => {
    const lines: string[] = [`## Session ${session.sessionId}`, `- turns: ${session.turns}`, `- started: ${session.startedAt}`, `- ended: ${session.endedAt}`]
    for (const approval of session.approvals) lines.push(`- human checkpoint: ${approval.kind} at ${approval.at} (tool calls: ${approval.toolCallIds.join(', ')})`)
    for (const error of session.errors.slice(0, EVIDENCE_LIMITS.turns)) lines.push(`- error: ${error}`)
    const filePaths = Object.keys(session.fileMentions).slice(0, EVIDENCE_LIMITS.files)
    if (filePaths.length > 0) {
      lines.push('- files:')
      for (const path of filePaths) lines.push(`  - ${path}`)
    }
    const toolLines = Object.entries(session.toolUsage).map(([name, record]) => `  - ${name}: ${record.calls} calls${record.approvals > 0 ? `, ${record.approvals} approval-gated` : ''}`)
    if (toolLines.length > 0) {
      lines.push('- tools:')
      lines.push(...toolLines.slice(0, EVIDENCE_LIMITS.tools))
    }
    for (const event of (itemsBySession.get(session.sessionId) ?? []).slice(-EVIDENCE_LIMITS.turns * 6)) {
      const line = evidenceLine(event)
      if (line !== undefined) lines.push(line)
    }
    return lines.join('\n')
  }).join('\n\n')

  const prior = state.digest.sections
  const hasPrior = DIGEST_SECTIONS.some(name => prior[name].length > 0)
  const priorBlock = hasPrior ? `\n\n## PRIOR DIGEST (merge, do not copy verbatim)\n${renderSections(prior)}` : ''

  return {
    system: 'You distill evidence from an agent harness into accurate, structured project context.',
    user: `## EVIDENCE\n${truncate(evidence, 24000)}\n${priorBlock}\n\n${DISTIL_INSTRUCTION}`,
  }
}

function evidenceLine(item: SessionEventItem): string | undefined {
  const event = item.event
  switch (event.type) {
    case 'turn.created':
      return `- turn started (${item.turnId})`
    case 'model.message': {
      const content = typeof event.content === 'string' ? event.content : ''
      const tools = Array.isArray(event.toolCalls) ? (event.toolCalls as { function?: { name?: string } }[]).map(c => c.function?.name).filter((n): n is string => n !== undefined).join(', ') : ''
      const head = truncate(content.trim(), EVIDENCE_LIMITS.chars)
      return `- agent: ${head}${tools.length > 0 ? `\n  - tool calls: ${tools}` : ''}`
    }
    case 'tool.response': {
      const content = typeof event.content === 'string' ? event.content : ''
      return `- tool result (${event.toolCallId}): ${truncate(content.trim(), EVIDENCE_LIMITS.chars)}`
    }
    case 'tool.approval_required':
    case 'tool.response_required':
      return `- HARNESS PAUSED for ${event.type} (${(event as { id?: string }).id ?? '?'})`
    case 'thread.created':
      return `- subagent started: ${(event as { title?: string }).title ?? ''}`
    case 'thread.done':
      return `- subagent finished: ${(event as { threadId?: string }).threadId ?? ''}`
    case 'turn.done': {
      const state = (event as { state?: { status?: string; message?: string } }).state
      const status = state?.status ?? '?'
      const message = state?.message !== undefined && status === 'error' ? ` — ${state.message}` : ''
      return `- turn done (status: ${status})${message}`
    }
    default:
      return undefined
  }
}

function renderSections(sections: DigestSections): string {
  const names: Record<string, string> = {
    primaryRequestAndIntent: 'Primary Request and Intent',
    keyTechnicalConcepts: 'Key Technical Concepts',
    filesAndCode: 'Files and Code',
    errorsAndFixes: 'Errors and Fixes',
    pendingJobs: 'Pending Jobs',
    currentWork: 'Current Work',
    nextStep: 'Next Step',
    criticalContext: 'Critical Context',
  }
  return DIGEST_SECTIONS.map(name => {
    const bullets = sections[name].map(line => `- ${line}`).join('\n')
    return `## ${names[name]}\n${bullets.length > 0 ? bullets : '- (none)'}`
  }).join('\n')
}

/** Parse an LLM digest output back into sections. Unknown headings are ignored. */
export function parseDigestSections(text: string): DigestSections {
  const sections = {} as DigestSections
  for (const name of DIGEST_SECTIONS) sections[name] = []
  const names: Record<string, (typeof DIGEST_SECTIONS)[number]> = {
    'Primary Request and Intent': 'primaryRequestAndIntent',
    'Key Technical Concepts': 'keyTechnicalConcepts',
    'Files and Code': 'filesAndCode',
    'Errors and Fixes': 'errorsAndFixes',
    'Pending Jobs': 'pendingJobs',
    'Current Work': 'currentWork',
    'Next Step': 'nextStep',
    'Critical Context': 'criticalContext',
  }
  let current: (typeof DIGEST_SECTIONS)[number] | undefined
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading !== null) {
      const name = names[heading[1]?.trim() ?? '']
      if (name !== undefined) current = name
      else current = undefined
      continue
    }
    if (current === undefined) continue
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      const text = bullet[1]?.trim() ?? ''
      if (text.length > 0 && text !== '(none)') sections[current].push(text)
    }
  }
  return sections
}

/** Build a digest value from parsed sections plus its evidence window. */
export function digestFrom(
  sections: DigestSections,
  fromSessions: readonly string[],
  generatedAt = new Date(),
): Digest {
  return { generatedAt: generatedAt.toISOString(), fromSessions: [...fromSessions], sections }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
