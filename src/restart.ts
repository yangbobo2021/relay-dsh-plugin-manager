import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import { fail } from './errors.ts'

export function detectedSupervisor(env: NodeJS.ProcessEnv = process.env, ppid = process.ppid): string | null {
  const systemd = (env.INVOCATION_ID ?? '') !== '' || (env.JOURNAL_STREAM ?? '') !== ''
  return systemd && ppid === 1 ? 'systemd' : null
}

export function restartAllowed(
  allowRestart: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
  ppid = process.ppid,
): boolean {
  if (allowRestart !== undefined) return allowRestart
  return detectedSupervisor(env, ppid) === null
}

export interface RestarterOptions {
  allowRestart?: boolean
  env?: NodeJS.ProcessEnv
  argv?: string[]
  execPath?: string
  cwd?: string
  ppid?: number
  spawn?: typeof spawn
  terminate?: () => void
}

export class DshRestarter {
  private readonly options: RestarterOptions

  constructor(options: RestarterOptions = {}) {
    this.options = options
  }

  available(): boolean {
    return restartAllowed(this.options.allowRestart, this.options.env, this.options.ppid)
  }

  schedule(): { helperPid: number | undefined; logFile: string } {
    if (!this.available()) fail('RESTART_UNAVAILABLE', 'Automatic restart is disabled or owned by the process supervisor.')
    const argv = this.options.argv ?? process.argv
    if (argv[1] === undefined) fail('RESTART_UNAVAILABLE', 'The current DSH entry point cannot be identified.')
    const execPath = this.options.execPath ?? process.execPath
    const cwd = this.options.cwd ?? process.cwd()
    const env = this.options.env ?? process.env
    const logFile = join(tmpdir(), `relay-dsh-plugin-manager-restart-${Date.now()}.log`)
    const source = [
      "const { spawn } = require('node:child_process')",
      "const fs = require('node:fs')",
      'setTimeout(() => {',
      `  const out = fs.openSync(${JSON.stringify(logFile)}, 'a')`,
      `  const child = spawn(${JSON.stringify(execPath)}, ${JSON.stringify(argv.slice(1))}, {`,
      `    cwd: ${JSON.stringify(cwd)}, env: process.env, detached: true, stdio: ['ignore', out, out]`,
      '  })',
      "  child.on('error', error => fs.appendFileSync(" + JSON.stringify(logFile) + ", String(error) + '\\n'))",
      '  child.unref()',
      '}, 1200)',
    ].join('\n')
    writeFileSync(logFile, '', { flag: 'a', mode: 0o600 })
    const helper = (this.options.spawn ?? spawn)(execPath, ['-e', source], {
      detached: true,
      stdio: 'ignore',
      env,
    })
    helper.unref()
    setTimeout(this.options.terminate ?? (() => process.kill(process.pid, 'SIGTERM')), 500).unref()
    return { helperPid: helper.pid, logFile }
  }
}
