import { describe, expect, it } from 'vitest'
import { foldSessionItems, initContext, withDigest } from '../src/index.ts'
import type { SessionEventItem, TfEvent } from '../src/index.ts'
import { buildDigestRequest, digestFrom, parseDigestSections } from '../src/index.ts'

function ev(partial: Partial<TfEvent> & Pick<TfEvent, 'type' | 'id'>): TfEvent {
  return { createdAt: '2026-08-29T10:00:00.000Z', threadId: 'main', ...partial }
}

function item(turnId: string, event: TfEvent): SessionEventItem {
  return { turnId, event }
}

describe('fold', () => {
  it('folds a full turn: usage, tools, approvals, timing', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items: SessionEventItem[] = [
      item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1', createdAt: '2026-08-29T10:00:00.000Z' })),
      item('t1', ev({ type: 'model.message', id: 'm1', createdAt: '2026-08-29T10:00:01.000Z', usage: { input_tokens: 100, output_tokens: 50 }, toolCalls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/a.ts"}' } }] })),
      item('t1', ev({ type: 'model.message.delta', id: 'm1', createdAt: '2026-08-29T10:00:02.000Z', content: 'hello' })),
      item('t1', ev({ type: 'tool.response', id: 'r1', toolCallId: 'c1', createdAt: '2026-08-29T10:00:05.000Z', content: 'written' })),
      item('t1', ev({ type: 'model.message', id: 'm2', createdAt: '2026-08-29T10:00:05.000Z', usage: { input_tokens: 10, output_tokens: 5 }, toolCalls: [{ id: 'c2', type: 'function', function: { name: 'deploy', arguments: '{}' } }] })),
      item('t1', ev({ type: 'tool.approval_required', id: 'a1', createdAt: '2026-08-29T10:00:06.000Z', toolCalls: [{ id: 'c2', sourceEventId: 'm2' }] })),
      item('t1', ev({ type: 'turn.done', id: 'e2', createdAt: '2026-08-29T10:00:08.000Z', state: { status: 'done' } })),
    ]
    const folded = foldSessionItems(state, 'sess-1', items)
    const session = folded.sessions['sess-1']
    expect(session).toBeDefined()
    expect(session!.turns).toBe(1)
    expect(session!.usage.inputTokens).toBe(110)
    expect(session!.usage.outputTokens).toBe(55)
    expect(session!.usageEstimated).toBe(false)
    expect(session!.toolUsage['write_file']).toEqual({ calls: 1, approvals: 0 })
    expect(session!.toolUsage['deploy']).toEqual({ calls: 1, approvals: 1 })
    expect(session!.approvals).toHaveLength(1)
    expect(session!.approvals[0]!.kind).toBe('approval')
    expect(session!.fileMentions['src/a.ts']).toBeDefined()
    expect(folded.budget.usage.inputTokens).toBe(110)
    expect(folded.budget.time.toolMs).toBe(4000)
    expect(folded.budget.time.ttftSamples).toBe(1)
    expect(folded.files['src/a.ts']!.sessions).toEqual(['sess-1'])
  })

  it('returns the same reference when a re-fold changes nothing (identity rule)', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })), item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done' } }))]
    const once = foldSessionItems(state, 'sess-1', items)
    const twice = foldSessionItems(once, 'sess-1', items)
    expect(twice).toBe(once)
  })

  it('ignores unknown event types without touching the state', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const folded = foldSessionItems(state, 'sess-1', [item('t1', ev({ type: 'some.future.event', id: 'x' }))])
    expect(folded.sessions['sess-1']).toBeDefined()
    expect(folded.sessions['sess-1']!.turns).toBe(0)
    expect(folded.budget.usage.inputTokens).toBe(0)
  })

  it('re-folding is idempotent — rebuild, never double-count', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })), item('t1', ev({ type: 'model.message', id: 'm1', usage: { prompt_tokens: 7, completion_tokens: 3 } })), item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done' } }))]
    const once = foldSessionItems(state, 'sess-1', items)
    const again = foldSessionItems(once, 'sess-1', items)
    expect(again).toBe(once)
    expect(again.budget.usage.inputTokens).toBe(7)
  })

  it('records subagent threads with parent linkage and sandbox usage', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [
      item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })),
      item('t1', ev({ type: 'thread.created', id: 'th1', threadId: 'sub-1', title: 'analyze', parent: { threadId: 'main', toolCallId: 'c9' } })),
      item('t1', ev({ type: 'sandbox.created', id: 's1', sandboxId: 'sb-1' })),
      item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done' } })),
    ]
    const folded = foldSessionItems(state, 'sess-1', items)
    expect(folded.sessions['sess-1']!.threads).toEqual([{ threadId: 'sub-1', title: 'analyze', parent: { threadId: 'main', toolCallId: 'c9' } }])
    expect(folded.sessions['sess-1']!.sandboxes).toBe(1)
  })

  it('marks usageEstimated when content exists without provider usage', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })), item('t1', ev({ type: 'model.message', id: 'm1', content: 'some reply' })), item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done' } }))]
    const folded = foldSessionItems(state, 'sess-1', items)
    expect(folded.sessions['sess-1']!.usageEstimated).toBe(true)
    expect(folded.budget.usageEstimated).toBe(true)
    expect(folded.budget.usage.inputTokens).toBe(0)
  })

  it('folds harness turn-metrics as usage when the message carried none', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [
      item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1', createdAt: '2026-08-29T10:00:00.000Z' })),
      item('t1', ev({ type: 'model.message', id: 'm1', createdAt: '2026-08-29T10:00:01.000Z', content: 'done' })),
      item('t1', ev({ type: 'turn.done', id: 'e2', createdAt: '2026-08-29T10:00:02.000Z', state: { status: 'done', metrics: { total_input_tokens: 30, total_output_tokens: 10, total_tokens: 40 } } })),
    ]
    const folded = foldSessionItems(state, 'sess-1', items)
    expect(folded.sessions['sess-1']!.usage.inputTokens).toBe(30)
    expect(folded.sessions['sess-1']!.usage.outputTokens).toBe(10)
    expect(folded.sessions['sess-1']!.usageEstimated).toBe(false)
  })

  it('never double-counts: metrics are skipped when message usage already folded', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const items = [
      item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })),
      item('t1', ev({ type: 'model.message', id: 'm1', usage: { input_tokens: 12, output_tokens: 3 } })),
      item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done', metrics: { total_input_tokens: 30, total_output_tokens: 10 } } })),
    ]
    const folded = foldSessionItems(state, 'sess-1', items)
    expect(folded.sessions['sess-1']!.usage.inputTokens).toBe(12)
    expect(folded.sessions['sess-1']!.usage.outputTokens).toBe(3)
  })

  it('withDigest keeps the same reference when the digest is unchanged', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const digest = digestFrom(parseDigestSections('## Files and Code\n- src/a.ts: entry\n'), ['sess-1'])
    const once = withDigest(state, digest)
    const twice = withDigest(once, digest)
    expect(twice).toBe(once)
    expect(once.digest.sections.filesAndCode).toEqual(['src/a.ts: entry'])
  })
})

describe('summarizer', () => {
  it('pins the eight digest sections in the instruction', async () => {
    const { DISTIL_INSTRUCTION } = await import('../src/summarizer.ts')
    for (const heading of ['Primary Request and Intent', 'Key Technical Concepts', 'Files and Code', 'Errors and Fixes', 'Pending Jobs', 'Current Work', 'Next Step', 'Critical Context']) {
      expect(DISTIL_INSTRUCTION).toContain(`## ${heading}`)
    }
  })

  it('parses digest output back into fixed sections, ignoring unknown headings', () => {
    const text = '## Primary Request and Intent\n- Build a CLI\n## Files and Code\n- src/a.ts: entry\n- src/b.ts: util\n## Some Future Section\n- ignored\n## Next Step\n- (none)\n'
    const sections = parseDigestSections(text)
    expect(sections.primaryRequestAndIntent).toEqual(['Build a CLI'])
    expect(sections.filesAndCode).toEqual(['src/a.ts: entry', 'src/b.ts: util'])
    expect(sections.nextStep).toEqual([])
  })

  it('builds a request carrying evidence, prior digest merge, and the instruction', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const digest = digestFrom(parseDigestSections('## Files and Code\n- old.ts: stale\n'), ['sess-0'])
    const withOld = withDigest(state, digest)
    const folded = foldSessionItems(withOld, 'sess-1', [item('t1', ev({ type: 'turn.created', id: 'e1', turnId: 't1' })), item('t1', ev({ type: 'model.message', id: 'm1', content: 'writing the cli' })), item('t1', ev({ type: 'turn.done', id: 'e2', state: { status: 'done' } }))])
    const request = buildDigestRequest(folded, [folded.sessions['sess-1']!], new Map([['sess-1', [item('t1', ev({ type: 'model.message', id: 'm1', content: 'writing the cli' }))]]]))
    expect(request.user).toContain('## EVIDENCE')
    expect(request.user).toContain('PRIOR DIGEST')
    expect(request.user).toContain('old.ts: stale')
    expect(request.user).toContain('writing the cli')
  })
})
