// @env node
import { expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeLanguageServer, type LspProbe } from '../scripts/lsp-probe'

function fixture(cwd: string, mode = ''): LspProbe {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/lsp-server.ts', import.meta.url)), mode],
    cwd,
    file: join(cwd, 'sample.txt'),
    languageId: 'fixture',
    bad: 'bad',
    good: 'good',
    expected: /fixture error/,
    timeoutMs: 2000,
  }
}

it('真实子进程报告错误，修改后清空诊断并完成 shutdown/exit', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'lsp-probe-'))
  try {
    await probeLanguageServer(fixture(cwd))
    expect(readFileSync(join(cwd, 'sample.txt'), 'utf8')).toBe('good')
    const pid = Number(readFileSync(join(cwd, 'server.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

it('服务不返回诊断时失败，不将空消息视为通过，并清理子进程', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'lsp-probe-'))
  try {
    await expect(probeLanguageServer(fixture(cwd, 'silent'))).rejects.toThrow(
      'error diagnostic: timeout',
    )
    const pid = Number(readFileSync(join(cwd, 'server.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}, 10_000)

it('修复后仍有诊断时失败，不跳过修复检查，并清理子进程', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'lsp-probe-'))
  try {
    await expect(probeLanguageServer(fixture(cwd, 'never-clean'))).rejects.toThrow(
      'cleared diagnostic: timeout',
    )
    const pid = Number(readFileSync(join(cwd, 'server.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}, 10_000)
