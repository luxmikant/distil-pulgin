/**
 * Distil CLI public surface.
 *
 * @module @distil/cli
 */

export { TfClient } from './client.ts'
export type { TfClientOptions, TfSession, TurnInputItem } from './client.ts'
export { loadOrInit, sync, watch } from './daemon.ts'
export type { SyncOptions } from './daemon.ts'
export { askLocal, askWithAgent, sessionLine } from './ask.ts'
export type { AskResult } from './ask.ts'
export { digestLlmFromEnv, runDigest } from './digest.ts'
export type { Compose, DigestLlmOptions, DigestResult } from './digest.ts'
export { serve } from './serve.ts'
export type { ServeOptions } from './serve.ts'
