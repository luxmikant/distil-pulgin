/**
 * Sync engine: pull session events from the harness, fold them into the
 * context document, and persist `PROJECT.ctx`. Watch mode polls on an
 * interval; a live-turn subscriber is the natural next step.
 *
 * @module @distil/cli/daemon
 */

import { foldSessionItems, initContext, readContext, writeContext } from '../../engine/src/index.ts'
import type { DistilContextV1 } from '../../engine/src/index.ts'
import type { TfClient } from './client.ts'

export interface SyncOptions {
  client: TfClient
  ctxPath: string
  projectName: string
  projectRoot: string
  /** Restrict sync to these session ids; empty = all sessions. */
  sessionIds?: readonly string[]
  log?: (message: string) => void
}

/** Load the existing document or initialize one for this project. */
export async function loadOrInit(opts: Pick<SyncOptions, 'ctxPath' | 'projectName' | 'projectRoot'>): Promise<DistilContextV1> {
  try {
    return await readContext(opts.ctxPath)
  } catch {
    return initContext({ name: opts.projectName, root: opts.projectRoot })
  }
}

/**
 * Fold all harness sessions into the context document and persist it.
 * Returns the number of sessions folded.
 */
export async function sync(opts: SyncOptions): Promise<{ state: DistilContextV1; folded: number }> {
  const log = opts.log ?? (() => {})
  let state = await loadOrInit(opts)
  const sessions = await opts.client.listSessions()
  const wanted = opts.sessionIds === undefined || opts.sessionIds.length === 0
    ? sessions
    : sessions.filter(session => opts.sessionIds!.includes(session.id))
  let folded = 0
  for (const session of wanted) {
    const items = await opts.client.listSessionEvents(session.id)
    if (items.length === 0) continue
    const next = foldSessionItems(state, session.id, items)
    if (next !== state) {
      folded += 1
      log(`folded session ${session.id}: ${items.length} event(s)`)
    }
    state = next
  }
  await writeContext(opts.ctxPath, state)
  return { state, folded }
}

/** Poll-sync on an interval until aborted. */
export async function watch(opts: SyncOptions & { intervalMs: number }, signal: AbortSignal): Promise<void> {
  const log = opts.log ?? (() => {})
  log(`watching ${opts.client.baseUrl} every ${opts.intervalMs}ms`)
  for (;;) {
    if (signal.aborted) return
    try {
      const result = await sync(opts)
      if (result.folded > 0) log(`context updated (${result.folded} session(s) changed)`)
    } catch (error) {
      log(`sync failed: ${(error as Error).message}`)
    }
    await delay(opts.intervalMs, signal)
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
