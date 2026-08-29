/**
 * The fold: Distil's intelligence engine.
 *
 * TrueForge session events are raw context; the fold transforms them into the
 * structured project context (`DistilContextV1`). It inherits the DeepSeek
 * Harness projection contract:
 *
 * - pure and synchronous — same inputs, same state;
 * - identity rule — a fold that changes nothing returns the same state
 *   reference, so change detection is `Object.is`;
 * - append-only evidence — a session's folded summary is rebuilt
 *   deterministically from its events; re-syncing never double-counts;
 * - fold wins over digest — folded facts are mechanical, the LLM digest is
 *   not, and the digest records its evidence window.
 *
 * @module @distil/engine/fold
 */

import type {
  ApprovalRecord,
  DistilContextV1,
  FileMention,
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  SandboxCreatedEvent,
  SessionEventItem,
  SessionSummary,
  ThreadCreatedEvent,
  ThreadDoneEvent,
  TimeMetricsV1,
  ToolApprovalRequiredEvent,
  ToolCall,
  ToolResponseEvent,
  ToolUsageRecord,
  TurnCreatedEvent,
  TurnDoneEvent,
} from './types.ts'
import { DIGEST_SECTIONS, emptyDigest, emptySession, emptyTime, emptyUsage } from './types.ts'
import { addUsage, normalizeUsage, usageOf } from './wallet.ts'

/** Working state for one session while its events are folded. */
interface OpenTurn {
  startedAt?: number
  endedAt?: number
  /** messageId -> issue time and first/last output times (ms). */
  messages: Map<string, { issuedAt: number; firstAt?: number; lastAt?: number }>
  /** callId -> issuing message time and tool name. */
  calls: Map<string, { issuedAt?: number; name: string }>
  approvals: Map<string, ApprovalRecord>
  /** A model message with content but no provider usage appeared. */
  unprovenUsage: boolean
  ttftMs: number
  ttftSamples: number
  decodeMs: number
  decodeTokens: number
}

interface OpenSession {
  startedAt?: number
  endedAt?: number
  turns: number
  usage: SessionSummary['usage']
  time: Omit<TimeMetricsV1, 'ttftMs' | 'ttftSamples' | 'decodeMs' | 'decodeTokens'> & {
    ttftMs: number
    ttftSamples: number
    decodeMs: number
    decodeTokens: number
  }
  approvals: ApprovalRecord[]
  threads: ThreadRecordLike[]
  sandboxes: number
  toolUsage: Record<string, ToolUsageRecord>
  fileMentions: Record<string, FileMention>
  usageEstimated: boolean
  current: OpenTurn | null
}

interface ThreadRecordLike {
  threadId: string
  title: string | null
  parent: { threadId: string; toolCallId: string } | null
}

const FILE_TOOL = /file|edit|write|read|patch|fs/i
const PATH_KEYS = ['path', 'file_path', 'filePath', 'filepath', 'filename', 'file_name', 'destination']

/** Create the empty context document for a project. */
export function initContext(project: { name: string; root: string }, now = new Date()): DistilContextV1 {
  const updatedAt = now.toISOString()
  return {
    formatVersion: 1,
    project: { name: project.name, root: project.root, updatedAt },
    digest: emptyDigest(updatedAt),
    sessions: {},
    budget: { usage: emptyUsage(), usageEstimated: false, time: emptyTime() },
    tools: {},
    files: {},
  }
}

/**
 * Rebuild one session's summary from its settled event items and merge it
 * into the context document. Re-folding the same items is idempotent: the
 * summary is rebuilt, not accumulated. Returns the same reference when
 * nothing changed (identity rule).
 */
export function foldSessionItems(
  state: DistilContextV1,
  sessionId: string,
  items: readonly SessionEventItem[],
): DistilContextV1 {
  const rebuilt = rebuildSession(sessionId, items)
  const previous = state.sessions[sessionId]
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(rebuilt)) return state

  const sessions = { ...state.sessions, [sessionId]: rebuilt }
  return finalize({ ...state, sessions }, rebuilt)
}

/** Replace the digest (CLI writes the LLM's digest output back through this). */
export function withDigest(state: DistilContextV1, digest: DistilContextV1['digest'], now = new Date()): DistilContextV1 {
  const next = { ...state, digest, project: { ...state.project, updatedAt: now.toISOString() } }
  if (JSON.stringify(next.digest) === JSON.stringify(state.digest)) return state
  return next
}

function rebuildSession(sessionId: string, items: readonly SessionEventItem[]): SessionSummary {
  const open: OpenSession = {
    turns: 0,
    usage: emptyUsage(),
    time: { llmMs: 0, toolMs: 0, ttftMs: 0, ttftSamples: 0, decodeMs: 0, decodeTokens: 0 },
    approvals: [],
    threads: [],
    sandboxes: 0,
    toolUsage: {},
    fileMentions: {},
    usageEstimated: false,
    current: null,
  }

  for (const item of orderItems(items)) applyEvent(open, item.event)

  if (open.current !== null) closeTurn(open, open.current)

  const summary = emptySession(sessionId)
  summary.turns = open.turns
  summary.startedAt = open.startedAt === undefined ? '' : new Date(open.startedAt).toISOString()
  summary.endedAt = open.endedAt === undefined ? '' : new Date(open.endedAt).toISOString()
  summary.usage = open.usage
  summary.usageEstimated = open.usageEstimated
  summary.time = open.time
  summary.approvals = open.approvals
  summary.threads = open.threads
  summary.sandboxes = open.sandboxes
  summary.toolUsage = open.toolUsage
  summary.fileMentions = open.fileMentions
  return summary
}

function applyEvent(open: OpenSession, event: SessionEventItem['event']): void {
  switch (event.type) {
    case 'turn.created': {
      const created = event as TurnCreatedEvent
      const at = epoch(created.createdAt)
      open.current = {
        messages: new Map(),
        calls: new Map(),
        approvals: new Map(),
        unprovenUsage: false,
        ...(at === undefined ? {} : { startedAt: at }),
        ttftMs: 0,
        ttftSamples: 0,
        decodeMs: 0,
        decodeTokens: 0,
      }
      if (at !== undefined) open.startedAt = open.startedAt === undefined ? at : Math.min(open.startedAt, at)
      return
    }
    case 'turn.done': {
      const done = event as TurnDoneEvent
      const at = epoch(done.createdAt)
      const turn = open.current
      if (turn !== null) {
        if (at !== undefined) turn.endedAt = at
        const metrics = done.state.metrics
        if (metrics !== undefined && usageIsEmpty(open.usage)) {
          const reported = normalizeUsage(metrics)
          if (reported !== undefined && (reported.inputTokens > 0 || reported.outputTokens > 0)) {
            addUsage(open.usage, reported)
            turn.unprovenUsage = false
          }
        }
        closeTurn(open, turn)
      }
      if (at !== undefined) open.endedAt = open.endedAt === undefined ? at : Math.max(open.endedAt, at)
      return
    }
    case 'model.message': {
      const message = event as ModelMessageEvent
      const at = epoch(message.createdAt)
      const turn = open.current
      if (turn === null) return
      if (at !== undefined) turn.messages.set(message.id, { issuedAt: at })
      if (message.usage !== undefined) {
        const usage = usageOf(message)
        if (usage !== undefined) addUsage(open.usage, usage)
        else if (message.content !== undefined && message.content !== null && message.content !== '') turn.unprovenUsage = true
      } else if (message.content !== undefined && message.content !== null && message.content !== '') {
        turn.unprovenUsage = true
      }
      for (const call of message.toolCalls ?? []) {
        turn.calls.set(call.id, { ...(at === undefined ? {} : { issuedAt: at }), name: toolName(call) })
        bumpTool(open, toolName(call), false)
      }
      const text = textOf(message.content)
      if (text.length > 0 && at !== undefined) {
        const entry = turn.messages.get(message.id)
        if (entry !== undefined) {
          if (entry.firstAt === undefined) entry.firstAt = at
          entry.lastAt = at
        }
      }
      if (at !== undefined) recordFiles(open, message.toolCalls ?? [], at)
      return
    }
    case 'model.message.delta': {
      const delta = event as ModelMessageDeltaEvent
      const turn = open.current
      if (turn === null) return
      const entry = turn.messages.get(delta.id)
      const content = delta.content ?? ''
      if (entry === undefined || content.length === 0) return
      const at = epoch(delta.createdAt) ?? entry.issuedAt
      if (entry.firstAt === undefined) {
        entry.firstAt = at
        if (turn.startedAt !== undefined) {
          turn.ttftMs += at - turn.startedAt
          turn.ttftSamples += 1
        }
      }
      entry.lastAt = at
      return
    }
    case 'tool.response': {
      const response = event as ToolResponseEvent
      const turn = open.current
      if (turn === null) return
      const at = epoch(response.createdAt)
      if (at === undefined) return
      const call = turn.calls.get(response.toolCallId)
      if (call === undefined || call.issuedAt === undefined) return
      const duration = at - call.issuedAt
      if (duration >= 0) open.time.toolMs += duration
      return
    }
    case 'tool.approval_required':
    case 'tool.response_required': {
      const approval = event as ToolApprovalRequiredEvent
      const turn = open.current
      if (turn === null) return
      const at = epoch(approval.createdAt)
      if (at === undefined) return
      const ids = (approval.toolCalls ?? []).map(ref => ref.id)
      const record: ApprovalRecord = {
        eventId: approval.id,
        kind: approval.type === 'tool.approval_required' ? 'approval' : 'response',
        toolCallIds: ids,
        at: new Date(at).toISOString(),
      }
      turn.approvals.set(approval.id, record)
      for (const id of ids) {
        const call = turn.calls.get(id)
        if (call !== undefined) bumpTool(open, call.name, true)
      }
      return
    }
    case 'thread.created': {
      const thread = event as ThreadCreatedEvent
      open.threads.push({
        threadId: thread.threadId,
        title: thread.title ?? null,
        parent: thread.parent ?? null,
      })
      return
    }
    case 'thread.done': {
      const thread = event as ThreadDoneEvent
      const record = open.threads.find(t => t.threadId === thread.threadId)
      if (record !== undefined && thread.title !== undefined) record.title = thread.title
      return
    }
    case 'sandbox.created': {
      void (event as SandboxCreatedEvent)
      open.sandboxes += 1
      return
    }
    default:
      return
  }
}

function closeTurn(open: OpenSession, turn: OpenTurn): void {
  open.turns += 1
  if (turn.unprovenUsage) open.usageEstimated = true
  open.time.ttftMs += turn.ttftMs
  open.time.ttftSamples += turn.ttftSamples
  for (const approval of turn.approvals.values()) open.approvals.push(approval)
  let first: number | undefined
  let last: number | undefined
  for (const entry of turn.messages.values()) {
    if (entry.firstAt !== undefined) {
      first = first === undefined ? entry.firstAt : Math.min(first, entry.firstAt)
      last = last === undefined ? entry.lastAt : Math.max(last, entry.lastAt ?? entry.firstAt)
    }
    if (entry.firstAt !== undefined && entry.lastAt !== undefined && entry.lastAt >= entry.firstAt) {
      turn.decodeMs += entry.lastAt - entry.firstAt
    }
  }
  open.time.decodeMs += turn.decodeMs
  if (first !== undefined && last !== undefined && last >= first) open.time.llmMs += last - first
  open.current = null
}

function bumpTool(open: OpenSession, name: string, approval: boolean): void {
  const record = open.toolUsage[name] ?? { calls: 0, approvals: 0 }
  if (!approval) record.calls += 1
  else record.approvals += 1
  open.toolUsage[name] = record
}

function recordFiles(open: OpenSession, calls: readonly ToolCall[], at: number): void {
  for (const call of calls) {
    const name = toolName(call)
    if (!FILE_TOOL.test(name)) continue
    for (const path of pathsOf(call.function.arguments)) {
      const existing = open.fileMentions[path]
      const iso = new Date(at).toISOString()
      if (existing === undefined) {
        open.fileMentions[path] = { firstSeenAt: iso, lastSeenAt: iso }
      } else if (iso > existing.lastSeenAt) {
        existing.lastSeenAt = iso
      }
    }
  }
}

/** Merge the rebuilt session into the document and recompute derived aggregates. */
function finalize(state: DistilContextV1, _rebuilt: SessionSummary): DistilContextV1 {
  const usage = emptyUsage()
  const time = emptyTime()
  const tools: Record<string, ToolUsageRecord> = {}
  const files: Record<string, FileMention & { sessions: string[] }> = {}
  let usageEstimated = false

  for (const session of Object.values(state.sessions)) {
    addUsage(usage, session.usage)
    addTime(time, session.time)
    usageEstimated = usageEstimated || session.usageEstimated
    for (const [name, record] of Object.entries(session.toolUsage)) {
      const merged = tools[name] ?? { calls: 0, approvals: 0 }
      merged.calls += record.calls
      merged.approvals += record.approvals
      tools[name] = merged
    }
    for (const [path, mention] of Object.entries(session.fileMentions)) {
      const merged = files[path] ?? { ...mention, sessions: [] }
      if (mention.firstSeenAt < merged.firstSeenAt) merged.firstSeenAt = mention.firstSeenAt
      if (mention.lastSeenAt > merged.lastSeenAt) merged.lastSeenAt = mention.lastSeenAt
      merged.sessions.push(session.sessionId)
      files[path] = merged
    }
  }

  return {
    ...state,
    budget: { usage, usageEstimated, time },
    tools,
    files,
    project: { ...state.project, updatedAt: new Date().toISOString() },
  }
}

function addTime(target: TimeMetricsV1, delta: TimeMetricsV1): void {
  target.llmMs += delta.llmMs
  target.toolMs += delta.toolMs
  target.ttftMs += delta.ttftMs
  target.ttftSamples += delta.ttftSamples
  target.decodeMs += delta.decodeMs
  target.decodeTokens += delta.decodeTokens
}

/** Persisted history arrives newest-first; restore chronological order. */
function orderItems(items: readonly SessionEventItem[]): SessionEventItem[] {
  const ordered = [...items]
  ordered.sort((a, b) => {
    const seqA = a.event.sequenceNumber
    const seqB = b.event.sequenceNumber
    if (seqA !== undefined && seqB !== undefined) return seqA - seqB
    const atA = epoch(a.event.createdAt)
    const atB = epoch(b.event.createdAt)
    if (atA !== undefined && atB !== undefined) return atA - atB
    return 0
  })
  return ordered
}

function epoch(iso: string | null | undefined): number | undefined {
  if (iso === undefined || iso === null) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

function usageIsEmpty(usage: SessionSummary['usage']): boolean {
  return usage.inputTokens === 0 && usage.outputTokens === 0
}

function toolName(call: ToolCall): string {
  const info = call.toolInfo
  if (info !== undefined && info.name !== undefined) {
    if (info.type === 'mcp' && 'serverName' in info && info.serverName !== undefined) {
      return `${info.serverName}:${info.name}`
    }
    return info.name
  }
  return call.function.name
}

function textOf(content: string | unknown[] | null | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
      out += (part as { text: string }).text
    }
  }
  return out
}

function pathsOf(argumentsJson: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const paths = new Set<string>()
  collectPaths(parsed, paths)
  return [...paths]
}

function collectPaths(value: unknown, out: Set<string>): void {
  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  for (const key of PATH_KEYS) {
    const v = record[key]
    if (typeof v === 'string' && v.length > 0) out.add(v)
  }
  for (const child of Object.values(record)) collectPaths(child, out)
}

/** All digest section names, for consumers that must iterate the fixed set. */
export const digestSectionNames = DIGEST_SECTIONS
