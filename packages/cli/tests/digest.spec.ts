import { describe, expect, it } from 'vitest'
import { foldSessionItems, initContext } from '../../engine/src/index.ts'
import { digestLlmFromEnv, runDigest } from '../src/digest.ts'
import type { EvidenceClient } from '../src/digest.ts'

const SECTIONS = `## Primary Request and Intent
- build a counter service

## Key Technical Concepts
- node http

## Files and Code
- server.js: the endpoint

## Errors and Fixes
- (none)

## Pending Jobs
- add tests

## Current Work
- none

## Next Step
- (none)

## Critical Context
- no deps allowed
`

describe('runDigest', () => {
  it('parses the composed digest and merges it into the context document', async () => {
    let state = initContext({ name: 'demo', root: '/demo' })
    state = foldSessionItems(state, 'sess-1', [
      { turnId: 't1', event: { type: 'turn.created', id: 'e1', turnId: 't1', createdAt: '2026-08-29T10:00:00.000Z' } },
      { turnId: 't1', event: { type: 'model.message', id: 'm1', content: 'built it', usage: { input_tokens: 10, output_tokens: 2 } } },
      { turnId: 't1', event: { type: 'turn.done', id: 'e2', createdAt: '2026-08-29T10:00:05.000Z', state: { status: 'done' } } },
    ])

    const llm = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    const result = await runDigest(state, llm, {
      now: new Date('2026-08-29T12:00:00Z'),
      compose: async () => SECTIONS,
    })

    expect(result.digest.sections.primaryRequestAndIntent).toEqual(['build a counter service'])
    expect(result.digest.sections.keyTechnicalConcepts).toEqual(['node http'])
    expect(result.digest.sections.errorsAndFixes).toEqual([])
    expect(result.digest.fromSessions).toEqual(['sess-1'])
    expect(result.state.digest.sections.primaryRequestAndIntent).toEqual(['build a counter service'])
    expect(result.state.digest.generatedAt).toBe('2026-08-29T12:00:00.000Z')
  })

  it('keeps folded facts intact — only the digest changes', async () => {
    let state = initContext({ name: 'demo', root: '/demo' })
    state = foldSessionItems(state, 'sess-1', [
      { turnId: 't1', event: { type: 'turn.created', id: 'e1', turnId: 't1' } },
      { turnId: 't1', event: { type: 'model.message', id: 'm1', content: 'hi', usage: { input_tokens: 10, output_tokens: 2 } } },
      { turnId: 't1', event: { type: 'turn.done', id: 'e2', state: { status: 'done' } } },
    ])

    const result = await runDigest(state, { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, { compose: async () => SECTIONS })
    expect(result.state.sessions['sess-1']!.usage.inputTokens).toBe(10)
    expect(result.state.budget.usage.inputTokens).toBe(10)
  })

  it('enriches the evidence with raw events when a client is provided', async () => {
    const state = foldSessionItems(initContext({ name: 'demo', root: '/demo' }), 'sess-1', [
      { turnId: 't1', event: { type: 'turn.created', id: 'e1', turnId: 't1' } },
      { turnId: 't1', event: { type: 'turn.done', id: 'e2', state: { status: 'done' } } },
    ])
    const client: EvidenceClient = {
      listSessionEvents: async () => [{ turnId: 't1', event: { type: 'model.message', id: 'm1', content: 'raw evidence line' } }],
    }
    let seenUser = ''
    await runDigest(state, { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, {
      compose: async (_llm, _system, user) => { seenUser = user; return SECTIONS },
      client,
    })
    expect(seenUser).toContain('raw evidence line')
  })
})

describe('digestLlmFromEnv', () => {
  it('fails loud when any required variable is missing', () => {
    expect(() => digestLlmFromEnv({})).toThrow(/DISTIL_LLM_BASE_URL/)
    expect(() => digestLlmFromEnv({ DISTIL_LLM_BASE_URL: 'u', DISTIL_LLM_API_KEY: 'k' })).toThrow(/DISTIL_LLM_MODEL/)
  })

  it('returns the configuration when all variables are present', () => {
    const env = { DISTIL_LLM_BASE_URL: 'u', DISTIL_LLM_API_KEY: 'k', DISTIL_LLM_MODEL: 'm' }
    expect(digestLlmFromEnv(env)).toEqual({ baseUrl: 'u', apiKey: 'k', model: 'm' })
  })
})
