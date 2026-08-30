import { describe, expect, it } from 'vitest'
import { estimateTokens, normalizeUsage } from '../src/index.ts'

describe('normalizeUsage', () => {
  it('accepts OpenAI-style snake_case', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 20, total_tokens: 30 })).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 })
  })

  it('accepts Anthropic-style camelCase', () => {
    expect(normalizeUsage({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 5 })).toEqual({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 5 })
  })

  it('accepts DeepSeek cache variants as disjoint buckets', () => {
    expect(normalizeUsage({ prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_cache_hit_tokens: 40 })).toEqual({ inputTokens: 100, outputTokens: 25, totalTokens: 125 })
  })

  it('accepts the harness turn-metrics aggregate shape', () => {
    expect(normalizeUsage({ total_input_tokens: 42, total_output_tokens: 7, total_tokens: 49 })).toEqual({ inputTokens: 42, outputTokens: 7, totalTokens: 49 })
  })

  it('fails closed on unprovable payloads — never guesses', () => {
    expect(normalizeUsage(undefined)).toBeUndefined()
    expect(normalizeUsage('tokens?')).toBeUndefined()
    expect(normalizeUsage({ prompt_tokens: 'many' })).toBeUndefined()
    expect(normalizeUsage({ input_tokens: -1, output_tokens: 2 })).toBeUndefined()
  })
})

describe('estimateTokens', () => {
  it('uses the documented chars/4 heuristic', () => {
    expect(estimateTokens('12345678')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})
