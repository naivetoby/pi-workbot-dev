// @env node
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'

writeFileSync('server.pid', String(process.pid))
const mode = process.argv[2]
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
)
connection.onRequest('initialize', () => ({ capabilities: { textDocumentSync: 2 } }))
function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
async function publish(value: unknown, changed: boolean): Promise<void> {
  if (mode === 'silent') return
  const params = record(value)
  const document = record(params.textDocument)
  let text = document.text
  if (changed) {
    assert(Array.isArray(params.contentChanges))
    text = record(params.contentChanges[0]).text
  }
  assert.equal(typeof text, 'string')
  const bad = String(text).includes('bad') || mode === 'never-clean'
  await connection.sendNotification('textDocument/publishDiagnostics', {
    uri: document.uri,
    version: document.version,
    diagnostics: bad
      ? [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            severity: 1,
            message: 'fixture error',
          },
        ]
      : [],
  })
}
connection.onNotification('textDocument/didOpen', (value) => publish(value, false))
connection.onNotification('textDocument/didChange', (value) => publish(value, true))
connection.onRequest('shutdown', () => null)
connection.onNotification('exit', () => {
  connection.dispose()
  process.exit(0)
})
connection.listen()
