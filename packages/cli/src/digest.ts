/**
 * Digest refresh: turn the folded context document into an LLM-generated
 * project digest and write it back. Completes the Distil loop:
 *
 *   harness events ──sync──▶ fold ──▶ PROJECT.ctx ──digest──▶ LLM ──▶ digest section
 *
 * The call targets any OpenAI-compatible chat-completions endpoint configured
 * through `DISTIL_LLM_BASE_URL` / `DISTIL_LLM_API_KEY` / `DISTIL_LLM_MODEL`.
 * Only the folded summaries are sent as evidence, so a digest run needs the
 * `.ctx` file plus a model key — never the harness.
 *
 * @module @distil/cli/digest
 */

import type { Digest, DistilContextV1, SessionEventItem, SessionSummary } from '../../engine/src/index.ts'
import { buildDigestRequest, digestFrom, parseDigestSections, withDigest } from '../../engine/src/index.ts'

/** An OpenAI-compatible endpoint Distil can call to generate the digest. */
export interface DigestLlmOptions {
  baseUrl: string
  apiKey: string
  model: string
}

/** The minimum a harness client must expose to enrich digest evidence with raw events. */
export interface EvidenceClient {
  listSessionEvents(sessionId: string): Promise<SessionEventItem[]>
}

/** A composed answer, injectable for tests. */
export type Compose = (llm: DigestLlmOptions, system: string, user: string) => Promise<string>

/** Result of one digest run: the updated document plus the digest that was written. */
export interface DigestResult {
  state: DistilContextV1
  digest: Digest
  model: string
}

/** Read the digest LLM configuration from the environment, failing loud when incomplete. */
export function digestLlmFromEnv(env: NodeJS.ProcessEnv): DigestLlmOptions {
  const baseUrl = env.DISTIL_LLM_BASE_URL
  const apiKey = env.DISTIL_LLM_API_KEY
  const model = env.DISTIL_LLM_MODEL
  if (baseUrl === undefined || apiKey === undefined || model === undefined) {
    throw new Error(
      'distil digest requires DISTIL_LLM_BASE_URL, DISTIL_LLM_API_KEY, and DISTIL_LLM_MODEL (an OpenAI-compatible endpoint)',
    )
  }
  return { baseUrl, apiKey, model }
}

/**
 * Generate the digest from the folded context and merge it into the document.
 * The default composer posts to an OpenAI-compatible endpoint; tests inject a
 * composer to exercise the parse/merge path without a network call. When a
 * harness client is provided, raw session events enrich the evidence sent to
 * the model; otherwise the digest is built from the folded summaries alone.
 *
 * @param state - the current context document (provides folded evidence and the prior digest).
 * @param llm - the endpoint to generate the digest with.
 * @param options.now - timestamp for the digest; defaults to the current time.
 * @param options.compose - the composition function; defaults to a chat-completions call.
 * @param options.client - optional harness client used to fetch raw-event evidence.
 * @returns the updated document and the digest written.
 */
export interface DigestOptions {
  now?: Date
  compose?: Compose
  client?: EvidenceClient
}

export async function runDigest(
  state: DistilContextV1,
  llm: DigestLlmOptions,
  options: DigestOptions = {},
): Promise<DigestResult> {
  const now = options.now ?? new Date()
  const compose = options.compose ?? chatCompletion
  const sessions = Object.values(state.sessions)
  let itemsBySession: Map<string, readonly SessionEventItem[]> = new Map()
  if (options.client !== undefined) itemsBySession = await collectEvidence(options.client, sessions)
  const { system, user } = buildDigestRequest(state, sessions, itemsBySession)
  const content = await compose(llm, system, user)
  const sections = parseDigestSections(content)
  const digest = digestFrom(sections, sessions.map(session => session.sessionId), now)
  return { state: withDigest(state, digest, now), digest, model: llm.model }
}

/** Fetch raw events per session; a session that cannot be fetched is skipped silently. */
async function collectEvidence(client: EvidenceClient, sessions: readonly SessionSummary[]): Promise<Map<string, readonly SessionEventItem[]>> {
  const map = new Map<string, readonly SessionEventItem[]>()
  for (const session of sessions) {
    try {
      const items = await client.listSessionEvents(session.sessionId)
      if (items.length > 0) map.set(session.sessionId, items)
    } catch {
      // Harness unavailable for this session — the digest falls back to folded summaries.
    }
  }
  return map
}

/** Minimal OpenAI-compatible chat-completions call; no SDK dependency. */
async function chatCompletion(llm: DigestLlmOptions, system: string, user: string): Promise<string> {
  const url = `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`digest LLM call failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`)
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) throw new Error('digest LLM call returned no content')
  return content
}
