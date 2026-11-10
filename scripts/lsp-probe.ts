// @env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'

export interface LspProbe {
  command: string
  args: string[]
  cwd: string
  file: string
  languageId: string
  bad: string
  good: string
  expected: RegExp
  timeoutMs?: number
}

export async function probeLanguageServer(probe: LspProbe): Promise<void> {
  const timeoutMs = probe.timeoutMs ?? 60_000
  const uri = pathToFileURL(probe.file).href
  writeFileSync(probe.file, probe.bad)
  const child = spawn(probe.command, probe.args, {
    cwd: probe.cwd,
    env: { ...process.env, CARGO_NET_OFFLINE: 'true' },
    stdio: 'pipe',
  })
  let stderr = ''
  let failure: Error | undefined
  let exited = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const exit = new Promise<number | null>((resolve) => {
    child.once('error', (error) => {
      failure = error
      exited = true
      resolve(null)
      notify()
    })
    child.once('exit', (code) => {
      exited = true
      resolve(code)
      notify()
    })
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8000)
  })
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  )
  let version = 1
  let diagnostics: { message: string }[] | undefined
  connection.onNotification('textDocument/publishDiagnostics', (value: unknown) => {
    if (!value || typeof value !== 'object' || !('uri' in value) || value.uri !== uri) return
    if ('version' in value && typeof value.version === 'number' && value.version < version) return
    if (
      !('diagnostics' in value) ||
      !Array.isArray(value.diagnostics) ||
      !value.diagnostics.every(
        (item) => item && typeof item === 'object' && typeof item.message === 'string',
      )
    ) {
      failure = new Error('Malformed LSP diagnostics')
    } else {
      diagnostics = value.diagnostics
    }
    notify()
  })
  connection.onRequest('workspace/configuration', (value: unknown) => {
    if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items))
      return []
    return value.items.map(() => null)
  })
  connection.onRequest('client/registerCapability', () => null)
  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.listen()

  async function bounded<T>(label: string, operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${probe.command} ${label}: timeout; ${stderr}`)),
            timeoutMs,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async function waitForDiagnostics(
    label: string,
    ready: (messages: { message: string }[]) => boolean,
  ): Promise<void> {
    let check = (): void => {}
    try {
      await bounded(
        label,
        new Promise<void>((resolve, reject) => {
          check = () => {
            if (failure || exited)
              reject(failure ?? new Error(`${probe.command} exited before ${label}; ${stderr}`))
            else if (diagnostics && ready(diagnostics)) resolve()
          }
          listeners.add(check)
          check()
        }),
      )
    } finally {
      listeners.delete(check)
    }
  }

  try {
    await bounded(
      'initialize',
      connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(probe.cwd).href,
        workspaceFolders: [{ uri: pathToFileURL(probe.cwd).href, name: 'probe' }],
        capabilities: {
          workspace: { configuration: true },
          textDocument: { publishDiagnostics: { versionSupport: true } },
        },
      }),
    )
    await connection.sendNotification('initialized', {})
    await connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: probe.languageId, version, text: probe.bad },
    })
    await connection.sendNotification('textDocument/didSave', { textDocument: { uri } })
    await waitForDiagnostics('error diagnostic', (messages) =>
      messages.some((item) => probe.expected.test(item.message)),
    )
    console.log(
      `PASS LSP ${probe.languageId}: ${diagnostics!.map((item) => item.message).join('; ')}`,
    )

    version++
    diagnostics = undefined
    writeFileSync(probe.file, probe.good)
    await connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: probe.good }],
    })
    await connection.sendNotification('textDocument/didSave', { textDocument: { uri } })
    // 必须收到服务器清空诊断的响应，不能把超时或没有消息当作通过
    await waitForDiagnostics('cleared diagnostic', (messages) => messages.length === 0)
    console.log(`PASS LSP ${probe.languageId}: fixed; server published zero diagnostics`)
    await bounded('shutdown', connection.sendRequest('shutdown'))
    await connection.sendNotification('exit')
    assert.equal(await bounded('exit', exit), 0, `${probe.command}: ${stderr}`)
  } finally {
    connection.dispose()
    if (!exited) {
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      try {
        await exit
      } finally {
        clearTimeout(kill)
      }
    }
  }
}
