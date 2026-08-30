/**
 * Minimal TrueForge HTTP client for Distil. Uses the same REST + SSE
 * surface the `@truefoundry/trueforge-sdk` wraps: the SDK is the documented
 * programmatic interface; this client keeps the dependency surface tiny and
 * pins the endpoints Distil folds from.
 *
 * @module @distil/cli/client
 */

import type { SessionEventItem, TfEvent } from '../../engine/src/index.ts'

export interface TfSession {
  id: string
  title?: string
  created_at?: string
}

export interface TurnInputItem {
  type: 'user.message' | 'user.tool_approval' | 'user.tool_response'
  content: string
  toolCallId?: string
}

export interface TfClientOptions {
  baseUrl: string
  /** API prefix; the local harness serves under /api/v1. */
  apiPrefix?: string
  timeoutMs?: number
}

export class TfClient {
  readonly baseUrl: string
  private readonly api: string
  private readonly timeoutMs: number

  constructor(options: TfClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.api = `${this.baseUrl}${options.apiPrefix ?? '/api/v1'}`
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** List sessions (newest first by default on the server). */
  async listSessions(): Promise<TfSession[]> {
    const json = await this.fetchJson('/sessions')
    return Array.isArray(json) ? (json as TfSession[]) : []
  }

  /**
   * Persisted events for one session: `{ turnId, event }` items. The server
   * returns newest-first; the fold re-orders chronologically.
   */
  async listSessionEvents(sessionId: string): Promise<SessionEventItem[]> {
    const json = await this.fetchJson(`/sessions/${sessionId}/events`)
    if (!Array.isArray(json)) return []
    return json.map((entry) => {
      const record = entry as Record<string, unknown>
      return {
        turnId: String(record.turnId ?? record.turn_id ?? ''),
        event: normalizeEvent(record.event ?? {}),
      }
    })
  }

  /** Create a session bound to a saved agent by name. */
  async createSession(agentName: string): Promise<string> {
    const json = await this.fetchJson('/sessions', {
      method: 'POST',
      body: JSON.stringify({ agent: { name: agentName } }),
    })
    const id = (json as Record<string, unknown>).id
    if (typeof id !== 'string') throw new Error('createSession: no session id in response')
    return id
  }

  /**
   * Stream one turn's live events (SSE). Yields raw events; deltas carry the
   * base message id so consumers can merge.
   */
  async *streamTurn(sessionId: string, input: TurnInputItem[]): AsyncGenerator<TfEvent> {
    const response = await fetch(`${this.api}/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ input, stream: true }),
    })
    if (!response.ok || response.body === null) {
      throw new Error(`streamTurn failed: ${response.status} ${response.statusText}`)
    }
    for await (const event of readSse(response.body)) yield event
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.api}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', ...init?.headers },
      })
      if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText}`)
      const json: unknown = await response.json()
      return unwrapData(json)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The raw HTTP API wraps responses in `{ data: ... }`; the fold works on the inner value. */
function unwrapData(json: unknown): unknown {
  if (typeof json !== 'object' || json === null) return json
  const record = json as Record<string, unknown>
  if ('data' in record) {
    if (Array.isArray(record.data)) return record.data
    if (Object.keys(record).length === 1) return record.data
  }
  return json
}

/**
 * The raw HTTP API emits snake_case payload keys (`created_at`, `turn_id`,
 * `total_input_tokens`); the engine folds camelCase. Normalize top-level
 * event keys so the fold has one shape to consume. Nested objects are left
 * as-is — `normalizeUsage` accepts both spellings.
 */
export function normalizeEvent(raw: unknown): TfEvent {
  if (typeof raw !== 'object' || raw === null) return { type: 'unknown', id: '' }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out as unknown as TfEvent
}

/** Parse a Server-Sent Events body into JSON events (unwraps `{data: ...}` envelopes). */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<TfEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload.length === 0 || payload === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        const event = unwrap(parsed)
        if (event !== undefined) yield normalizeEvent(event)
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}

function unwrap(parsed: unknown): TfEvent | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const candidate = typeof record.data === 'object' && record.data !== null ? record.data : record
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const event = candidate as Record<string, unknown>
  return typeof event.type === 'string' ? (event as unknown as TfEvent) : undefined
}
