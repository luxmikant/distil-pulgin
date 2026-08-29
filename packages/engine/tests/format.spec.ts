import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { foldSessionItems, initContext, parseContext, readContext, renderMarkdown, writeContext } from '../src/index.ts'
import type { SessionEventItem } from '../src/index.ts'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'distil-'))
  cleanup.push(dir)
  return dir
}

describe('.ctx format', () => {
  it('round-trips through an atomic write and read', async () => {
    const dir = await scratchDir()
    const path = join(dir, 'PROJECT.ctx')
    const state = initContext({ name: 'demo', root: '/demo' })
    const folded = foldSessionItems(state, 'sess-1', [
      { turnId: 't1', event: { type: 'turn.created', id: 'e1', turnId: 't1' } },
      { turnId: 't1', event: { type: 'turn.done', id: 'e2', state: { status: 'done' } } },
    ] as SessionEventItem[])
    await writeContext(path, folded)
    const read = await readContext(path)
    expect(read).toEqual(folded)
    expect(parseContext(await readFile(path, 'utf8'))).toEqual(folded)
    expect(read.sessions['sess-1']!.turns).toBe(1)
  })

  it('rejects a document with an unknown formatVersion', async () => {
    const dir = await scratchDir()
    const path = join(dir, 'PROJECT.ctx')
    await writeFile(path, JSON.stringify({ formatVersion: 99, project: {}, digest: {}, sessions: {}, budget: {}, tools: {}, files: {} }), 'utf8')
    await expect(readContext(path)).rejects.toThrow(/formatVersion 1/)
  })

  it('rejects non-JSON content', async () => {
    const dir = await scratchDir()
    const path = join(dir, 'PROJECT.ctx')
    await writeFile(path, 'not json at all', 'utf8')
    await expect(readContext(path)).rejects.toThrow(/not valid JSON/)
  })
})

describe('renderMarkdown', () => {
  it('projects budget, sessions, and digest sections', () => {
    const state = initContext({ name: 'demo', root: '/demo' })
    const folded = foldSessionItems(state, 'sess-1', [
      { turnId: 't1', event: { type: 'turn.created', id: 'e1', turnId: 't1' } },
      { turnId: 't1', event: { type: 'model.message', id: 'm1', usage: { input_tokens: 1000, output_tokens: 500 } } },
      { turnId: 't1', event: { type: 'turn.done', id: 'e2', state: { status: 'done' } } },
    ] as SessionEventItem[])
    const markdown = renderMarkdown(folded)
    expect(markdown).toContain('# demo — project context')
    expect(markdown).toContain('| Input | 1,000 |')
    expect(markdown).toContain('| Output | 500 |')
    expect(markdown).toContain('`sess-1`')
  })
})
