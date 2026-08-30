/**
 * Type vocabulary for the Distil engine.
 *
 * Two worlds meet here: TrueForge's session-event stream (the raw trajectory
 * a harness produces) and Distil's versioned context document (the distilled
 * project understanding). Every fact in the second world is folded from the
 * first — this file declares both shapes.
 *
 * @module @distil/engine/types
 */

/**
 * One event from the TrueForge harness. The harness types streaming events
 * openly (`{ type: string; [key: string]: unknown }`); Distil declares the
 * fields it folds and ignores the rest. Unknown event types are skipped by
 * the fold, never dropped silently by tests.
 */
export interface TfEvent {
  type: string
  id: string
  /** Execution context: `"main"` for the root agent, a generated id for subagents, `null` for run-level events. */
  threadId?: string | null
  /** ISO timestamp; absent on a few delta events, which inherit their base message's time. */
  createdAt?: string | null
  /** Monotonic within a turn on the live stream; absent from persisted history events. */
  sequenceNumber?: number
  [key: string]: unknown
}

/**
 * The persisted-history envelope: one turn's settled event.
 * `GET /sessions/{id}/events` returns these newest-first; Distil re-sorts
 * before folding.
 */
export interface SessionEventItem {
  turnId: string
  event: TfEvent
}

/** Narrow views of the events the fold consumes. */
export interface TurnCreatedEvent extends TfEvent {
  type: 'turn.created'
  turnId: string
  previousTurnId?: string | null
  input?: unknown[]
  state?: { status: 'running' }
}

export interface TurnDoneEvent extends TfEvent {
  type: 'turn.done'
  state: {
    status: string
    output?: unknown
    completed_at?: string
    completedAt?: string
    /** Failure message on error turns — digest evidence for errorsAndFixes. */
    message?: string
    /** Provider-reported whole-turn token accounting (the harness's aggregate). */
    metrics?: {
      total_input_tokens?: number
      total_output_tokens?: number
      total_tokens?: number
      totalInputTokens?: number
      totalOutputTokens?: number
      totalTokens?: number
    }
  }
}

export interface ModelMessageEvent extends TfEvent {
  type: 'model.message'
  content?: string | unknown[] | null
  reasoningContent?: string
  toolCalls?: ToolCall[]
  finishReason?: string | null
  /** Provider-reported token accounting; shape varies by provider. Normalized by `normalizeUsage`. */
  usage?: unknown
}

export interface ModelMessageDeltaEvent extends TfEvent {
  type: 'model.message.delta'
  content?: string | null
}

export interface ToolResponseEvent extends TfEvent {
  type: 'tool.response'
  toolCallId: string
  content: string
}

export interface ToolApprovalRequiredEvent extends TfEvent {
  type: 'tool.approval_required' | 'tool.response_required'
  toolCalls?: ToolCallRef[]
}

export interface ThreadCreatedEvent extends TfEvent {
  type: 'thread.created'
  threadId: string
  title: string
  agentInfo?: { type?: string; name: string; input: string; model?: string }
  parent: { threadId: string; toolCallId: string }
}

export interface ThreadDoneEvent extends TfEvent {
  type: 'thread.done'
  threadId: string
  title?: string
  state?: unknown
}

export interface SandboxCreatedEvent extends TfEvent {
  type: 'sandbox.created'
  sandboxId: string
}

/** One tool invocation inside a model message. `function.arguments` is a JSON string. */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  toolInfo?: ToolInfo
}

export type ToolInfo =
  | { type: 'truefoundry-system'; name: string }
  | { type: 'mcp'; serverId: string; serverName: string; name: string }
  | { type: string; name?: string; [key: string]: unknown }

export interface ToolCallRef {
  id: string
  sourceEventId: string
}

/** Provider-independent token accounting. Buckets are disjoint. */
export interface TokenUsageV1 {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Wall-time metrics for one session, folded from event timestamps. Milliseconds. */
export interface TimeMetricsV1 {
  /** Model wall time: first model message to its last delta. */
  llmMs: number
  /** Tool wall time: tool call issue to its response, summed over calls. */
  toolMs: number
  /** Time-to-first-token, summed over turns that streamed a first token. */
  ttftMs: number
  /** Turns that contributed a ttft sample. */
  ttftSamples: number
  /** Time from first token to last token, summed. */
  decodeMs: number
  /** Provider-reported output tokens across turns; 0 when the provider reported none. */
  decodeTokens: number
}

/** A subagent thread record with its parent linkage (the input to a data-flow graph). */
export interface ThreadRecord {
  threadId: string
  title: string | null
  parent: { threadId: string; toolCallId: string } | null
}

/** One human checkpoint: an approval (or result) request that paused the harness. */
export interface ApprovalRecord {
  eventId: string
  kind: 'approval' | 'response'
  toolCallIds: string[]
  at: string
}

/** One session's folded summary — the append-only evidence unit of the context file. */
export interface SessionSummary {
  sessionId: string
  turns: number
  startedAt: string
  endedAt: string
  usage: TokenUsageV1
  /** True when at least one turn had model content but no provider-reported usage. */
  usageEstimated: boolean
  time: TimeMetricsV1
  approvals: ApprovalRecord[]
  threads: ThreadRecord[]
  sandboxes: number
  toolUsage: Record<string, ToolUsageRecord>
  fileMentions: Record<string, FileMention>
}

export interface ToolUsageRecord {
  calls: number
  approvals: number
}

export interface FileMention {
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * The LLM-generated digest. Sections use the fixed names below, adapted from
 * the DeepSeek Harness compaction checkpoint — never drop one; "(none)" marks
 * an empty section.
 */
export const DIGEST_SECTIONS = [
  'primaryRequestAndIntent',
  'keyTechnicalConcepts',
  'filesAndCode',
  'errorsAndFixes',
  'pendingJobs',
  'currentWork',
  'nextStep',
  'criticalContext',
] as const

export type DigestSectionName = (typeof DIGEST_SECTIONS)[number]

export type DigestSections = Record<DigestSectionName, string[]>

export interface Digest {
  generatedAt: string
  /** Session ids the digest was generated from — its evidence window. */
  fromSessions: string[]
  sections: DigestSections
}

/** Version 1 of the Distil context document (`PROJECT.ctx`). */
export interface DistilContextV1 {
  formatVersion: 1
  project: {
    name: string
    root: string
    updatedAt: string
  }
  digest: Digest
  sessions: Record<string, SessionSummary>
  /** Folded aggregate across all sessions; rebuilt from `sessions` on every fold. */
  budget: {
    usage: TokenUsageV1
    usageEstimated: boolean
    time: TimeMetricsV1
  }
  tools: Record<string, ToolUsageRecord>
  files: Record<string, FileMention & { sessions: string[] }>
}

export function emptyDigest(generatedAt: string): Digest {
  const sections = {} as DigestSections
  for (const name of DIGEST_SECTIONS) sections[name] = []
  return { generatedAt, fromSessions: [], sections }
}

export function emptyUsage(): TokenUsageV1 {
  return { inputTokens: 0, outputTokens: 0 }
}

export function emptyTime(): TimeMetricsV1 {
  return { llmMs: 0, toolMs: 0, ttftMs: 0, ttftSamples: 0, decodeMs: 0, decodeTokens: 0 }
}

export function emptySession(sessionId: string): SessionSummary {
  return {
    sessionId,
    turns: 0,
    startedAt: '',
    endedAt: '',
    usage: emptyUsage(),
    usageEstimated: false,
    time: emptyTime(),
    approvals: [],
    threads: [],
    sandboxes: 0,
    toolUsage: {},
    fileMentions: {},
  }
}
