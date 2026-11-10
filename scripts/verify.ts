// @env node
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareLanguageProbes } from './lsp-fixtures'
import { probeLanguageServer } from './lsp-probe'

async function verify(): Promise<void> {
  assert.equal(process.platform, 'linux', '镜像验收必须在 Linux 内执行')
  assert.notEqual(process.getuid!(), 0, '必须以运行时非 root 用户验证')
  assert.equal(Bun.which('devcontainer'), null, '验收应使用正式工具路径')
  if (Bun.which('sudo')) {
    const sudo = spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8', timeout: 5000 })
    assert.equal(sudo.status, 1, `免密 sudo 必须被拒绝：${sudo.error ?? sudo.stderr}`)
  }
  assert(process.versions.bun && Bun.semver.satisfies(process.versions.bun, '>=1.4.2'))
  for (const name of ['PI_LENS_DISABLE_LSP_INSTALL', 'PI_LENS_DISABLE_TOOL_INSTALL']) {
    assert.equal(process.env[name], undefined, '共享底座不得包含 code 专用安装策略')
  }
  assert.equal(
    execFileSync('node', ['-p', 'Boolean(process.versions.node && !process.versions.bun)'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim(),
    'true',
    'JS 工具需要真实 Node.js，不是 Bun 别名',
  )

  const versions: Record<string, string> = {}
  for (const [command, args] of [
    ['bun', ['--version']],
    ['node', ['--version']],
    ['python3', ['--version']],
    ['java', ['--version']],
    ['javac', ['-version']],
    ['mvn', ['--version']],
    ['go', ['version']],
    ['gopls', ['version']],
    ['rustc', ['--version']],
    ['cargo', ['--version']],
    ['rust-analyzer', ['--version']],
    ['rustfmt', ['--version']],
    ['cargo-clippy', ['--version']],
    ['git-lfs', ['version']],
    ['gh', ['--version']],
    ['glab', ['--version']],
    ['yq', ['--version']],
    ['rsync', ['--version']],
    ['cmake', ['--version']],
    ['cmake-language-server', ['--version']],
    ['marksman', ['--version']],
    ['taplo', ['--version']],
    ['bash-language-server', ['--version']],
    ['ruff', ['--version']],
    ['tsc', ['--version']],
    ['typescript-language-server', ['--version']],
    ['pyright', ['--version']],
    ['clangd', ['--version']],
    ['cppcheck', ['--version']],
    ['shellcheck', ['--version']],
    ['shfmt', ['--version']],
  ] as const) {
    const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 15_000 })
    assert.equal(result.status, 0, `${command}: ${result.error ?? result.stderr}`)
    versions[command] = (result.stdout + result.stderr).trim()
  }
  assert.match(versions.node!, /^v24\./)
  assert.match(versions.javac!, /^javac 21\./)
  const goVersion = execFileSync('go', ['env', 'GOVERSION'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim()
  for (const command of ['gopls', 'git-lfs', 'shfmt']) {
    const binary = `/usr/local/bin/${command}`
    assert.equal(Bun.which(command), binary, `${command} 应使用镜像内编译的版本`)
    assert.equal(
      execFileSync('go', ['version', binary], { encoding: 'utf8', timeout: 5000 }).trim(),
      `${binary}: ${goVersion}`,
      `${command} 必须使用当前 Go 工具链编译`,
    )
    versions[`${command}-go`] = goVersion
  }
  for (const command of ['git-lfs', 'shfmt'])
    assert(!existsSync(`/usr/bin/${command}`), `残留发行版旧二进制：${command}`)
  versions['linux-libc-dev'] = execFileSync(
    'dpkg-query',
    ['-W', '-f=${Version}', 'linux-libc-dev'],
    { encoding: 'utf8', timeout: 5000 },
  ).trim()
  execFileSync('dpkg', ['--compare-versions', versions['linux-libc-dev'], 'ge', '6.8.0-149.149'], {
    timeout: 5000,
  })
  execFileSync('gh', ['api', '--help'], { timeout: 15_000 })
  execFileSync('glab', ['api', '--help'], { timeout: 15_000 })
  execFileSync('jdtls', ['--help'], { timeout: 15_000 })
  for (const command of [
    'pyright-langserver',
    'vscode-json-language-server',
    'vscode-html-language-server',
    'vscode-css-language-server',
    'yaml-language-server',
    'docker-langserver',
    'svelteserver',
    'ssh',
    'envsubst',
    'perl',
    'zip',
    'unzip',
    'xz',
    'lsof',
    'strace',
    'dig',
    'nc',
  ])
    assert(Bun.which(command), `缺少预装命令：${command}`)

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workbot-dev-check-')))
  try {
    const cwd = join(root, 'workspace')
    mkdirSync(cwd)
    Object.assign(process.env, {
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
      GOSUMDB: 'off',
      CARGO_NET_OFFLINE: 'true',
    })

    execFileSync(
      'python3',
      [
        '-c',
        'import sys, ssl, sqlite3, bz2, lzma, ctypes, readline; assert sys.version_info[:2] == (3, 12)',
      ],
      { timeout: 15_000 },
    )
    const venv = join(root, '.venv')
    execFileSync('python3', ['-m', 'venv', venv], { timeout: 30_000 })
    execFileSync(join(venv, 'bin/python'), ['-m', 'pip', '--version'], { timeout: 15_000 })
    console.log('PASS Python: standard library, venv and pip')

    assert(process.env.SDKMAN_DIR, 'Java Feature 必须提供 SDKMAN_DIR')
    const javaRoot = join(process.env.SDKMAN_DIR, 'candidates/java')
    assert.equal(realpathSync(process.env.JAVA_HOME!), realpathSync(join(javaRoot, 'current')))
    const javaFile = join(root, 'JavaCheck.java')
    for (const version of [21, 25]) {
      const candidates = readdirSync(javaRoot).filter(
        (name) => name.startsWith(`${version}.`) && name.endsWith('-tem'),
      )
      assert.equal(candidates.length, 1, `预期一个 Temurin ${version} 安装`)
      const javaHome = join(javaRoot, candidates[0]!)
      const env = {
        ...process.env,
        JAVA_HOME: javaHome,
        PATH: `${javaHome}/bin:${process.env.PATH}`,
      }
      writeFileSync(
        javaFile,
        'public class JavaCheck { public static void main(String[] args) { int value = "bad"; } }',
      )
      const bad = spawnSync('javac', [javaFile], { env, encoding: 'utf8', timeout: 15_000 })
      assert.equal(bad.status, 1, bad.error?.message ?? bad.stderr)
      assert(bad.stderr.includes('incompatible types'), bad.stderr)
      writeFileSync(
        javaFile,
        'public class JavaCheck { public static void main(String[] args) { System.out.println(Runtime.version().feature()); } }',
      )
      execFileSync('javac', [javaFile], { env, timeout: 15_000 })
      assert.equal(
        execFileSync('java', ['-cp', root, 'JavaCheck'], {
          env,
          encoding: 'utf8',
          timeout: 15_000,
        }).trim(),
        String(version),
      )
      assert(
        execFileSync('mvn', ['--version'], { env, encoding: 'utf8', timeout: 15_000 }).includes(
          `Java version: ${version}.`,
        ),
      )
      console.log(`PASS JDK ${version}: compile error, corrected execution and Maven runtime`)
    }
    const pom = join(root, 'pom.xml')
    writeFileSync(
      pom,
      '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>offline-check</artifactId><version>1</version><packaging>pom</packaging></project>',
    )
    assert(
      execFileSync('mvn', ['--batch-mode', '--offline', '-f', pom, 'validate'], {
        encoding: 'utf8',
        timeout: 30_000,
      }).includes('BUILD SUCCESS'),
    )

    const goFile = join(root, 'go-check.go')
    writeFileSync(goFile, 'package main\nfunc main() { var value int = "bad"; _ = value }\n')
    const badGo = spawnSync('go', ['build', '-o', join(root, 'go-check'), goFile], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    assert.equal(badGo.status, 1, badGo.error?.message ?? badGo.stderr)
    assert(badGo.stderr.includes('cannot use'), badGo.stderr)
    writeFileSync(goFile, 'package main\nfunc main() { println("go-ok") }\n')
    execFileSync('go', ['build', '-o', join(root, 'go-check'), goFile], { timeout: 60_000 })
    const goRun = spawnSync(join(root, 'go-check'), [], { encoding: 'utf8', timeout: 5000 })
    assert.equal(goRun.status, 0)
    assert.equal(goRun.stderr.trim(), 'go-ok')
    console.log('PASS Go: compile error and corrected execution without downloads')

    const rust = join(root, 'rust-check')
    mkdirSync(join(rust, 'src'), { recursive: true })
    writeFileSync(
      join(rust, 'Cargo.toml'),
      '[package]\nname = "rust-check"\nversion = "0.1.0"\nedition = "2024"\n',
    )
    writeFileSync(join(rust, 'src/main.rs'), 'fn main() { let _value: i32 = "bad"; }\n')
    const badRust = spawnSync('cargo', ['check', '--offline'], {
      cwd: rust,
      encoding: 'utf8',
      timeout: 60_000,
    })
    assert.equal(badRust.status, 101, badRust.error?.message ?? badRust.stderr)
    assert(badRust.stderr.includes('mismatched types'), badRust.stderr)
    writeFileSync(join(rust, 'src/main.rs'), 'fn main() {\n    println!("rust-ok");\n}\n')
    assert.equal(
      execFileSync('cargo', ['run', '--offline', '--quiet'], {
        cwd: rust,
        encoding: 'utf8',
        timeout: 60_000,
      }).trim(),
      'rust-ok',
    )
    execFileSync('cargo', ['fmt', '--check'], { cwd: rust, timeout: 30_000 })
    execFileSync('cargo', ['clippy', '--offline', '--', '-D', 'warnings'], {
      cwd: rust,
      timeout: 60_000,
    })
    console.log(
      'PASS Rust: compile error, corrected execution, rustfmt and Clippy without downloads',
    )

    const lfs = join(root, 'lfs-check')
    execFileSync('git', ['init', '--quiet', lfs], { timeout: 5000 })
    execFileSync('git', ['lfs', 'install', '--local'], { cwd: lfs, timeout: 5000 })
    const payload = 'workbot-lfs-check\n'
    const pointer = execFileSync('git', ['lfs', 'clean', '--', 'sample.bin'], {
      cwd: lfs,
      input: payload,
      encoding: 'utf8',
      timeout: 5000,
    })
    assert(pointer.includes(`oid sha256:${createHash('sha256').update(payload).digest('hex')}`))
    assert.equal(
      execFileSync('git', ['lfs', 'smudge', '--', 'sample.bin'], {
        cwd: lfs,
        input: pointer,
        encoding: 'utf8',
        timeout: 5000,
      }),
      payload,
    )
    console.log('PASS Git LFS: clean and smudge round-trip without downloads')

    const yaml = join(cwd, 'sample.yaml')
    writeFileSync(yaml, 'value: 42\n')
    assert.equal(
      execFileSync('yq', ['-r', '.value', yaml], { encoding: 'utf8', timeout: 5000 }).trim(),
      '42',
    )
    const substituted = spawnSync('envsubst', [], {
      input: '${WORKBOT_VERIFY}',
      env: { ...process.env, WORKBOT_VERIFY: 'ready' },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(substituted.status, 0)
    assert.equal(substituted.stdout, 'ready')
    console.log('PASS utilities: yq and envsubst; gh/glab commands available without credentials')

    for (const [file, content] of Object.entries({
      'bad.js': 'debugger;\nconst x={a:1}\nconsole.log(x);\n',
      'bad.ts': 'const value: number = "bad";\n',
      'bad.md': '# Title\n\n### Skipped\n',
      'bad.html': '<html><head></head><body></body></html>\n',
      'bad.css': 'a { color: #ggg; }\n',
      'stylelint.json': '{"rules":{"color-no-invalid-hex":true}}',
      'bad.py': 'import os\n',
      'bad.sh': '#!/bin/sh\necho $value\n',
      'unformatted.sh': '#!/bin/sh\nif true;then echo ok;fi\n',
    }))
      writeFileSync(join(cwd, file), content)

    for (const [command, args, status, expected] of [
      [
        'ast-grep',
        ['--pattern', 'console.log($A)', '--lang', 'javascript', 'bad.js'],
        0,
        'console.log',
      ],
      ['htmlhint', ['bad.html'], 1, 'doctype-first'],
      ['markdownlint-cli2', ['bad.md'], 1, 'MD001'],
      ['oxfmt', ['--check', 'bad.js'], 1, 'Format issues'],
      ['oxlint', ['-D', 'no-debugger', 'bad.js'], 1, 'no-debugger'],
      ['prettier', ['--check', 'bad.js'], 1, 'Code style issues'],
      ['stylelint', ['--config', 'stylelint.json', 'bad.css'], 2, 'color-no-invalid-hex'],
      ['tsc', ['--noEmit', '--skipLibCheck', '--pretty', 'false', 'bad.ts'], 2, 'TS2322'],
      ['ruff', ['check', '--isolated', 'bad.py'], 1, 'F401'],
      ['shellcheck', ['bad.sh'], 1, 'SC2086'],
      ['shfmt', ['-d', 'unformatted.sh'], 1, '+if true; then'],
    ] as const) {
      const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', timeout: 30_000 })
      const output = result.stdout + result.stderr
      assert.equal(result.status, status, `${command}: ${result.error ?? output}`)
      assert(output.includes(expected), `${command}: ${output}`)
      console.log(`PASS ${command}: ${expected}`)
    }
    for (const probe of prepareLanguageProbes(root)) await probeLanguageServer(probe)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const lockHash = createHash('sha256')
    .update(readFileSync(new URL('../.devcontainer/devcontainer-lock.json', import.meta.url)))
    .digest('hex')
  writeFileSync(
    '/tmp/workbot-dev-verified.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        architecture: process.arch,
        versions,
        featuresLockSha256: lockHash,
      },
      null,
      2,
    ) + '\n',
  )
}

await verify().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
