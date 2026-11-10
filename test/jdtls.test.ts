// @env node
import { expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

it.each([
  {
    name: '使用 SDKMAN JDK 25，不受业务 JAVA_HOME 影响并保留参数',
    versions: ['25.0.1-tem'],
    status: 0,
  },
  { name: '缺少 JDK 25 时失败，不回退到业务 JDK', versions: [], status: 1 },
  {
    name: 'JDK 25 安装不唯一时失败，不静默选择版本',
    versions: ['25.0.1-tem', '25.0.2-tem'],
    status: 1,
  },
])('$name', ({ versions, status }) => {
  const root = mkdtempSync(join(tmpdir(), 'workbot-jdtls-'))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const python = join(bin, 'python3')
    writeFileSync(python, '#!/bin/sh\nprintf "%s\\n" "$@"\n')
    chmodSync(python, 0o755)
    for (const version of versions) {
      const javaBin = join(root, 'sdkman/candidates/java', version, 'bin')
      mkdirSync(javaBin, { recursive: true })
      writeFileSync(join(javaBin, 'java'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(javaBin, 'java'), 0o755)
    }

    const result = spawnSync(
      '/bin/sh',
      [
        fileURLToPath(new URL('../scripts/jdtls.sh', import.meta.url)),
        '-data',
        '/tmp/path with spaces',
      ],
      {
        env: { PATH: bin, SDKMAN_DIR: join(root, 'sdkman'), JAVA_HOME: '/business/jdk21' },
        encoding: 'utf8',
        timeout: 5000,
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(status)
    if (status === 0) {
      expect(result.stderr).toBe('')
      expect(result.stdout.trim().split('\n')).toEqual([
        '/opt/workbot-dev/jdtls/bin/jdtls',
        '--java-executable',
        join(root, 'sdkman/candidates/java/25.0.1-tem/bin/java'),
        '--jvm-arg=-Xms128m',
        '--jvm-arg=-Xmx1g',
        '-data',
        '/tmp/path with spaces',
      ])
    } else {
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Expected exactly one SDKMAN Temurin 25')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
