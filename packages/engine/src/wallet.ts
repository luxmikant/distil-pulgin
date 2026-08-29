/**
 * Token accounting: normalize provider-reported usage and provide an
 * explicitly labeled estimator for the no-usage case.
 *
 * Fail-closed policy (inherited from the DeepSeek Harness token-meter):
 * a payload the fold cannot prove is counted as nothing — never guessed.
 * The chars/4 heuristic is available as a separate, labeled estimate and is
 * never presented as exact.
 *
 * @module @distil/engine/wallet
 */

import type { TokenUsageV1, TfEvent } from './types.ts'

const CACHE_READ_KEYS = ['cache_read_input_tokens', 'cache_read_tokens', 'cacheReadTokens'] as const
const CACHE_WRITE_KEYS = ['cache_creation_input_tokens', 'cache_write_tokens', 'cacheWriteTokens'] as const

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

/**
 * Normalize the `usage` payload of a model message event into provider-
 * independent buckets. Accepts OpenAI-style snake_case, Anthropic-style
 * camelCase, and their DeepSeek cache variants. Returns undefined when the
 * payload cannot be proven — the caller must not guess.
 */
export function normalizeUsage(usage: unknown): TokenUsageV1 | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const u = usage as Record<string, unknown>

  const inputTokens = num(u.total_input_tokens) ?? num(u.totalInputTokens) ?? num(u.input_tokens) ?? num(u.inputTokens) ?? num(u.prompt_tokens)
  const outputTokens = num(u.total_output_tokens) ?? num(u.totalOutputTokens) ?? num(u.output_tokens) ?? num(u.outputTokens) ?? num(u.completion_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined

  const cacheReadTokens = firstNum(u, CACHE_READ_KEYS)
  const cacheWriteTokens = firstNum(u, CACHE_WRITE_KEYS)
  const totalTokens = num(u.total_tokens) ?? num(u.totalTokens)

  return {
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  }
}

function firstNum(u: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = num(u[key])
    if (value !== undefined) return value
  }
  return undefined
}

/** Chars-per-token heuristic, 4 chars/token — labeled estimated everywhere it is used. */
export const CHARS_PER_TOKEN = 4

/**
 * Estimate token count of text. Non-authoritative: CJK and dense JSON are
 * underpriced at 4 chars/token. Callers must surface `estimated: true`.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Sum two usage records in place (mutates `target`). */
export function addUsage(target: TokenUsageV1, delta: TokenUsageV1): void {
  target.inputTokens += delta.inputTokens
  target.outputTokens += delta.outputTokens
  if (delta.totalTokens !== undefined) {
    target.totalTokens = (target.totalTokens ?? 0) + delta.totalTokens
  }
  if (delta.cacheReadTokens !== undefined) {
    target.cacheReadTokens = (target.cacheReadTokens ?? 0) + delta.cacheReadTokens
  }
  if (delta.cacheWriteTokens !== undefined) {
    target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + delta.cacheWriteTokens
  }
}

/** Extract a `model.message`-style event's usage, tolerating arbitrary harness payloads. */
export function usageOf(event: TfEvent): TokenUsageV1 | undefined {
  return normalizeUsage(event.usage)
}
