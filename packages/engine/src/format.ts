/**
 * The `.ctx` document format: validation, atomic persistence, and the
 * Markdown projection for human readers.
 *
 * `PROJECT.ctx` is versioned JSON (`formatVersion: 1` — see
 * docs/context-file-format.md). Writes are whole-document and atomic
 * (temp file + rename); unknown versions are rejected, never guessed at.
 *
 * @module @distil/engine/format
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import type { DigestSections, DistilContextV1 } from './types.ts'
import { DIGEST_SECTIONS, emptyDigest } from './types.ts'

export const CTX_FILE_NAME = 'PROJECT.ctx'

/** Type guard: is this a version-1 Distil context document? */
export function isDistilContextV1(value: unknown): value is DistilContextV1 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { formatVersion?: unknown; project?: unknown; digest?: unknown; sessions?: unknown; budget?: unknown; tools?: unknown; files?: unknown }
  return v.formatVersion === 1 && typeof v.project === 'object' && v.project !== null && typeof v.digest === 'object' && v.digest !== null && typeof v.sessions === 'object' && v.sessions !== null && typeof v.budget === 'object' && v.budget !== null && typeof v.tools === 'object' && v.tools !== null && typeof v.files === 'object' && v.files !== null
}

/** Parse a `.ctx` document, failing loud on malformed input or an unknown version. */
export function parseContext(json: string): DistilContextV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`invalid ${CTX_FILE_NAME}: not valid JSON: ${(error as Error).message}`)
  }
  if (!isDistilContextV1(parsed)) {
    throw new Error(`invalid ${CTX_FILE_NAME}: expected formatVersion 1 with project/digest/sessions/budget/tools/files`)
  }
  return parsed
}

/** Read and parse a `.ctx` file. Throws when the file is missing or invalid. */
export async function readContext(filePath: string): Promise<DistilContextV1> {
  const json = await readFile(filePath, 'utf8')
  return parseContext(json)
}

/** Atomically write the whole document (temp file in the same directory + rename). */
export async function writeContext(filePath: string, context: DistilContextV1): Promise<void> {
  const json = `${JSON.stringify(context, null, 2)}\n`
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, json, 'utf8')
  await rename(temp, filePath)
}

const SECTION_HEADINGS: Record<keyof DigestSections, string> = {
  primaryRequestAndIntent: 'Primary Request and Intent',
  keyTechnicalConcepts: 'Key Technical Concepts',
  filesAndCode: 'Files and Code',
  errorsAndFixes: 'Errors and Fixes',
  pendingJobs: 'Pending Jobs',
  currentWork: 'Current Work',
  nextStep: 'Next Step',
  criticalContext: 'Critical Context',
}

/**
 * Project the context document into readable Markdown. A projection, not a
 * second source: every line derives from the document's fields.
 */
export function renderMarkdown(context: DistilContextV1): string {
  const lines: string[] = []
  lines.push(`# ${context.project.name} — project context`, '')
  lines.push(`Generated ${context.digest.generatedAt} · updated ${context.project.updatedAt}`)
  lines.push(`Evidence: ${context.digest.fromSessions.length} session(s) — ${Object.keys(context.sessions).length} folded`)
  lines.push('')

  lines.push('## Digest', '')
  for (const name of DIGEST_SECTIONS) {
    lines.push(`### ${SECTION_HEADINGS[name]}`)
    const bullets = context.digest.sections[name]
    lines.push(...(bullets.length > 0 ? bullets.map(line => `- ${line}`) : ['- (none)']), '')
  }

  lines.push('## Budget', '')
  const { usage, time } = context.budget
  lines.push(`| | Tokens |`, '| --- | --- |')
  lines.push(`| Input | ${usage.inputTokens.toLocaleString('en-US')} |`)
  lines.push(`| Output | ${usage.outputTokens.toLocaleString('en-US')} |`)
  if (usage.cacheReadTokens !== undefined) lines.push(`| Cache read | ${usage.cacheReadTokens.toLocaleString('en-US')} |`)
  if (usage.cacheWriteTokens !== undefined) lines.push(`| Cache write | ${usage.cacheWriteTokens.toLocaleString('en-US')} |`)
  lines.push(`| **Total** | ${((usage.totalTokens ?? usage.inputTokens + usage.outputTokens)).toLocaleString('en-US')} |`, '')
  if (context.budget.usageEstimated) lines.push('> Token figures are partial: at least one turn had no provider-reported usage.', '')
  lines.push(`LLM time ${(time.llmMs / 1000).toFixed(1)}s · tool time ${(time.toolMs / 1000).toFixed(1)}s · avg TTFT ${time.ttftSamples > 0 ? (time.ttftMs / time.ttftSamples / 1000).toFixed(1) : '—'}s (${time.ttftSamples} samples) · decode ${(time.decodeMs / 1000).toFixed(1)}s`, '')

  lines.push('## Sessions', '')
  for (const session of Object.values(context.sessions)) {
    lines.push(`- \`${session.sessionId}\` — ${session.turns} turn(s), ${session.startedAt} → ${session.endedAt}`)
    if (session.threads.length > 0) {
      for (const thread of session.threads) {
        lines.push(`  - thread \`${thread.threadId}\`${thread.title !== null ? ` (${thread.title})` : ''}${thread.parent !== null ? ` ← spawned by ${thread.parent.threadId}` : ''}`)
      }
    }
    if (session.approvals.length > 0) {
      for (const approval of session.approvals) lines.push(`  - human checkpoint: ${approval.kind} at ${approval.at}`)
    }
    if (session.errors.length > 0) {
      for (const error of session.errors) lines.push(`  - error: ${error}`)
    }
  }
  lines.push('')

  if (Object.keys(context.tools).length > 0) {
    lines.push('## Tools', '')
    for (const [name, record] of Object.entries(context.tools)) {
      lines.push(`- ${name}: ${record.calls} call(s)${record.approvals > 0 ? `, ${record.approvals} approval-gated` : ''}`)
    }
    lines.push('')
  }

  if (Object.keys(context.files).length > 0) {
    lines.push('## Files touched', '')
    for (const [path, mention] of Object.entries(context.files)) {
      lines.push(`- \`${path}\` (first seen ${mention.firstSeenAt})`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** A digest with empty sections, for contexts created before the first digest run. */
export function emptyDigestSections(): DigestSections {
  const sections = {} as DigestSections
  for (const name of DIGEST_SECTIONS) sections[name] = []
  return sections
}

export { emptyDigest }
