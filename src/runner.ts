import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'

export interface DshLaunch {
  file: string
  prefix: string[]
  cwd: string
  shell: boolean
}

export interface RunnerResult {
  exitCode: number
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  cancelled: boolean
  timedOut: boolean
}

export interface RunnerOptions {
  env?: NodeJS.ProcessEnv
  argv?: string[]
  execPath?: string
  cwd?: string
  platform?: NodeJS.Platform
  spawn?: typeof spawn
  timeoutMs?: number
  maxOutputBytes?: number
}

export function resolveDshLaunch(options: RunnerOptions = {}): DshLaunch {
  const env = options.env ?? process.env
  const argv = options.argv ?? process.argv
  const execPath = options.execPath ?? process.execPath
  const cwd = options.cwd ?? process.cwd()
  const platform = options.platform ?? process.platform
  const configured = env.DSH_EXECUTABLE?.trim()
  let file: string
  let prefix: string[]
  if (configured !== undefined && configured !== '') {
    file = configured
    prefix = []
  } else if (argv[1] !== undefined && existsSync(argv[1])) {
    file = execPath
    prefix = [realpathSync(argv[1])]
  } else {
    file = 'dsh'
    prefix = []
  }
  return {
    file,
    prefix,
    cwd,
    shell: platform === 'win32' && /\.(?:cmd|bat)$/iu.test(file),
  }
}

function boundedAppend(current: string, chunk: Buffer | string, maxBytes: number): string {
  const combined = current + chunk.toString()
  return Buffer.byteLength(combined) <= maxBytes ? combined : combined.slice(-maxBytes)
}

export class DshCliRunner {
  private readonly options: RunnerOptions

  constructor(options: RunnerOptions = {}) {
    this.options = options
  }

  runPlugin(
    profile: string,
    args: readonly string[],
    signal: AbortSignal,
    progress: (message: string) => void = () => undefined,
  ): Promise<RunnerResult> {
    const launch = resolveDshLaunch(this.options)
    const spawnImpl = this.options.spawn ?? spawn
    const timeoutMs = this.options.timeoutMs ?? 5 * 60_000
    const maxOutput = this.options.maxOutputBytes ?? 64 * 1024
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawnImpl(
          launch.file,
          [...launch.prefix, 'plugin', '--profile', profile, ...args],
          {
            cwd: launch.cwd,
            env: this.options.env ?? process.env,
            shell: launch.shell,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )
      } catch (error) {
        reject(error)
        return
      }
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let cancelled = false
      let settled = false
      const terminate = (reason: 'timeout' | 'cancel'): void => {
        if (reason === 'timeout') timedOut = true
        else cancelled = true
        child.kill('SIGTERM')
        setTimeout(() => { if (!settled) child.kill('SIGKILL') }, 2_000).unref()
      }
      const timer = setTimeout(() => terminate('timeout'), timeoutMs)
      const onAbort = (): void => terminate('cancel')
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = boundedAppend(stdout, chunk, maxOutput)
        progress(chunk.toString().trim().slice(-500))
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = boundedAppend(stderr, chunk, maxOutput)
        progress(chunk.toString().trim().slice(-500))
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        settled = true
        reject(error)
      })
      child.once('close', (code, closeSignal) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        settled = true
        resolve({
          exitCode: code ?? 1,
          signal: closeSignal,
          stdout,
          stderr,
          cancelled,
          timedOut,
        })
      })
    })
  }
}
