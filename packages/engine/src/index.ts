/**
 * Distil engine public surface: the folds, the wallet, the summarizer, and
 * the `.ctx` format. Pure library — network and LLM access live in
 * `@distil/cli`.
 *
 * @module @distil/engine
 */

export type {
  ApprovalRecord,
  Digest,
  DigestSectionName,
  DigestSections,
  DistilContextV1,
  FileMention,
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  SandboxCreatedEvent,
  SessionEventItem,
  SessionSummary,
  TfEvent,
  ThreadCreatedEvent,
  ThreadDoneEvent,
  ThreadRecord,
  TimeMetricsV1,
  ToolApprovalRequiredEvent,
  ToolCall,
  ToolCallRef,
  ToolInfo,
  ToolResponseEvent,
  TokenUsageV1,
  ToolUsageRecord,
  TurnCreatedEvent,
  TurnDoneEvent,
} from './types.ts'
export { DIGEST_SECTIONS, emptyDigest, emptySession, emptyTime, emptyUsage } from './types.ts'
export { digestSectionNames, foldSessionItems, initContext, withDigest } from './fold.ts'
export { addUsage, CHARS_PER_TOKEN, estimateTokens, normalizeUsage, usageOf } from './wallet.ts'
export { buildDigestRequest, digestFrom, DISTIL_INSTRUCTION, parseDigestSections } from './summarizer.ts'
export { CTX_FILE_NAME, emptyDigestSections, isDistilContextV1, parseContext, readContext, renderMarkdown, writeContext } from './format.ts'
