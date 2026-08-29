#!/usr/bin/env node
/**
 * Distil CLI entry point.
 *
 *   distil init [--base-url <url>] [--name <project>] [--root <dir>]
 *   distil sync [--watch] [--interval <ms>] [--session <id>...]
 *   distil ask <question> [--llm --agent <name>]
 *   distil budget
 *   distil render
 *
 * @module @distil/cli/main
 */

import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CTX_FILE_NAME, renderMarkdown, writeContext } from '../../engine/src/index.ts'
import { askLocal, askWithAgent, sessionLine } from './ask.ts'
import { TfClient } from './client.ts'
import { loadOrInit, sync, watch } from './daemon.ts'

interface CliOptions {
  baseUrl: string
  ctxPath: string
  projectName: string
  projectRoot: string
}

function parseArgs(argv: string[]): { command: string; args: string[]; options: Record<string, string[]> } {
  const [command, ...rest] = argv
  const args: string[] = []
  const options: Record<string, string[]> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const value = rest[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        options[key] = [...(options[key] ?? []), value]
        i += 1
      } else {
        options[key] = ['true']
      }
    } else {
      args.push(token)
    }
  }
  return { command: command ?? 'help', args, options }
}

function optionsOf(argv: string[]): CliOptions {
  const parsed = parseArgs(['_', ...argv])
  const baseUrl = parsed.options['base-url']?.[0] ?? process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790'
  const projectRoot = resolve(parsed.options['root']?.[0] ?? process.cwd())
  return {
    baseUrl,
    ctxPath: resolve(projectRoot, CTX_FILE_NAME),
    projectName: parsed.options['name']?.[0] ?? process.env.DISTIL_PROJECT_NAME ?? basenameOf(projectRoot),
    projectRoot,
  }
}

function basenameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2)
  if (raw.length === 0 || raw[0] === 'help' || raw[0] === '--help') {
    console.log(USAGE)
    return
  }
  const { command, args, options } = parseArgs(raw)
  const opts = optionsOf(raw)
  const log = (message: string): void => console.error(`[distil] ${message}`)

  switch (command) {
    case 'init': {
      const state = await loadOrInit(opts)
      await mkdir(dirname(opts.ctxPath), { recursive: true })
      await writeContext(opts.ctxPath, state)
      console.log(`initialized ${opts.ctxPath} for project "${opts.projectName}" (harness at ${opts.baseUrl})`)
      return
    }
    case 'sync': {
      const client = new TfClient({ baseUrl: opts.baseUrl })
      const sessionIds = options.session
      if (options.watch !== undefined) {
        const signal = new AbortController().signal
        await watch({ client, ...opts, log, intervalMs: Number(options.interval?.[0] ?? 5000), ...(sessionIds === undefined ? {} : { sessionIds }) }, signal)
        return
      }
      const result = await sync({ client, ...opts, log, ...(sessionIds === undefined ? {} : { sessionIds }) })
      console.log(`synced ${result.folded} session(s) into ${opts.ctxPath}`)
      return
    }
    case 'ask': {
      const question = args.join(' ')
      if (question.length === 0) {
        console.log('usage: distil ask <question>')
        return
      }
      const state = await loadOrInit(opts)
      if (options.llm !== undefined) {
        const client = new TfClient({ baseUrl: opts.baseUrl })
        const agent = options.agent?.[0] ?? 'distil-reader'
        const result = await askWithAgent(state, question, agent, client)
        console.log(result.answer)
        if (result.grounding.length > 0) console.log('\n— grounded in —\n' + result.grounding.map(g => `  ${g}`).join('\n'))
        return
      }
      console.log(askLocal(state, question).answer)
      return
    }
    case 'budget': {
      const state = await loadOrInit(opts)
      const { usage, time } = state.budget
      console.log(`project: ${state.project.name}`)
      console.log(`tokens: in ${usage.inputTokens.toLocaleString('en-US')} · out ${usage.outputTokens.toLocaleString('en-US')} · cache read ${(usage.cacheReadTokens ?? 0).toLocaleString('en-US')} · total ${(usage.totalTokens ?? usage.inputTokens + usage.outputTokens).toLocaleString('en-US')}${state.budget.usageEstimated ? ' (partial — some turns had no provider usage)' : ''}`)
      console.log(`time:   llm ${(time.llmMs / 1000).toFixed(1)}s · tools ${(time.toolMs / 1000).toFixed(1)}s · avg ttft ${time.ttftSamples > 0 ? (time.ttftMs / time.ttftSamples / 1000).toFixed(1) : '—'}s (${time.ttftSamples} samples)`)
      for (const session of Object.values(state.sessions)) console.log(`  ${sessionLine(session)}`)
      return
    }
    case 'render': {
      const state = await loadOrInit(opts)
      console.log(renderMarkdown(state))
      return
    }
    default:
      console.log(`unknown command "${command}"\n\n${USAGE}`)
      return
  }
}

const USAGE = [
  'distil — project-context engine over the TrueForge harness',
  '',
  '  distil init [--base-url <url>] [--name <project>] [--root <dir>]',
  '  distil sync [--watch] [--interval <ms>] [--session <id>...]',
  '  distil ask <question> [--llm --agent <name>]',
  '  distil budget',
  '  distil render',
  '',
  'Environment: TRUEFORGE_BASE_URL (default http://localhost:8790), DISTIL_PROJECT_NAME.',
].join('\n')

void main().catch(error => {
  console.error(`[distil] ${(error as Error).stack ?? (error as Error).message}`)
  process.exitCode = 1
})
