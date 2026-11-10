// @env node
import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function buildWithCommands(fail = ''): { status: number | null; log: string; stderr: string } {
  const fixture = mkdtempSync(join(tmpdir(), 'workbot-dev-build-'))
  try {
    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    for (const name of ['docker', 'devcontainer']) {
      symlinkSync(join(root, 'test/fixtures/record-command.sh'), join(bin, name))
    }
    const log = join(fixture, 'commands')
    const result = spawnSync('bash', ['scripts/build.sh', 'example.com/workbot-dev:check'], {
      cwd: root,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: fixture,
        TMPDIR: fixture,
        CI_JOB_ID: '123',
        TEST_LOG: log,
        TEST_FAIL: fail,
      },
      encoding: 'utf8',
      timeout: 10_000,
    })
    if (result.error) throw result.error
    return { status: result.status, log: readFileSync(log, 'utf8'), stderr: result.stderr }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

describe('镜像构建入口', () => {
  it('统一使用 linux/amd64 拉取和构建镜像，冻结 Features，结束时清理临时标签', () => {
    const result = buildWithCommands()
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const calls = result.log.trim().split('\n')
    expect(calls[0]).toBe(
      'docker <pull> <--platform> <linux/amd64> <mcr.microsoft.com/devcontainers/base:ubuntu24.04>',
    )
    expect(calls[1]).toStartWith('docker <image> <inspect>')
    expect(calls[2]).toBe(
      'devcontainer <build> <--workspace-folder> <.> <--image-name> <pi-workbot-dev-toolchain:123> <--platform> <linux/amd64> <--frozen-lockfile> <--skip-persisting-customizations-from-features>',
    )
    expect(calls[3]).toBe(
      'docker <build> <--platform> <linux/amd64> <--provenance=false> <--build-arg> <BASE_IMAGE=pi-workbot-dev-toolchain:123> <-t> <example.com/workbot-dev:check> <.>',
    )
    expect(calls[4]).toBe('docker <image> <rm> <pi-workbot-dev-toolchain:123>')
    expect(calls).toHaveLength(5)
    expect(result.log).not.toContain('<push>')
  })

  it('基础镜像拉取失败时保留错误码，停止后续构建并清理临时标签', () => {
    const result = buildWithCommands('pull')
    expect(result.status).toBe(30)
    expect(result.log).not.toContain('devcontainer <build>')
    expect(result.log).not.toContain('docker <build>')
    expect(result.log.trim()).toEndWith('docker <image> <rm> <pi-workbot-dev-toolchain:123>')
  })

  it('Features 构建失败时保留错误码、不构建或发布最终镜像，仍清理临时标签', () => {
    const result = buildWithCommands('features')
    expect(result.status).toBe(31)
    expect(result.log).not.toContain('docker <build>')
    expect(result.log).not.toContain('<push>')
    expect(result.log.trim()).toEndWith('docker <image> <rm> <pi-workbot-dev-toolchain:123>')
  })

  it('最终构建或验收失败时不掩盖错误，仍清理临时标签', () => {
    const result = buildWithCommands('image')
    expect(result.status).toBe(32)
    expect(result.log).not.toContain('<push>')
    expect(result.log.trim()).toEndWith('docker <image> <rm> <pi-workbot-dev-toolchain:123>')
  })
})

describe('环境边界', () => {
  it('五种语言使用官方 Features，并有完整的摘要锁定', async () => {
    const config = await Bun.file(join(root, '.devcontainer/devcontainer.json')).json()
    const lock = await Bun.file(join(root, '.devcontainer/devcontainer-lock.json')).json()
    const expected = ['go:1', 'java:1', 'node:2', 'python:1', 'rust:1'].map(
      (name) => `ghcr.io/devcontainers/features/${name}`,
    )
    expect(Object.keys(config.features).sort()).toEqual(expected)
    expect(Object.keys(lock.features).sort()).toEqual(expected)
    for (const feature of expected) {
      expect(lock.features[feature].integrity).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(lock.features[feature].resolved).toBe(
        `${feature.split(':')[0]}@${lock.features[feature].integrity}`,
      )
    }
    expect(config.features['ghcr.io/devcontainers/features/java:1']).toMatchObject({
      version: '21',
      additionalVersions: '25',
      installMaven: true,
    })
    expect(config.features['ghcr.io/devcontainers/features/python:1']).toMatchObject({
      version: '3.12',
      installTools: false,
    })
    expect(config.features['ghcr.io/devcontainers/features/go:1'].installGoTools).toBe(false)
    expect(config.features['ghcr.io/devcontainers/features/rust:1']).toMatchObject({
      version: '1.99.1',
      profile: 'minimal',
      components: 'rust-analyzer,rust-src,rustfmt,clippy',
    })
    expect(config.remoteUser).toBe('vscode')
    expect(config.postCreateCommand).toBeUndefined()
    expect(config.postStartCommand).toBeUndefined()
  })

  it('最终镜像依赖禁网非 root 验收，不包含 Pi 或构建 CLI，不设置角色安装策略', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain('RUN --network=none')
    expect(dockerfile).toContain(
      'HOME="$home" timeout --kill-after=5s 600s bun /tmp/workbot-dev-check/scripts/verify.ts',
    )
    expect(dockerfile).toContain('COPY --from=verification /tmp/workbot-dev-verified.json')
    expect(dockerfile).toContain('test ! -e node_modules/pi-lens/package.json')
    expect(dockerfile).toContain('test ! -e node_modules/@devcontainers/cli/package.json')
    expect(dockerfile).toContain('ENTRYPOINT []')
    expect(dockerfile).not.toContain('PI_LENS_DISABLE_')
    expect(dockerfile.trim()).toEndWith('USER vscode\nWORKDIR /workspace')
    expect(dockerfile).not.toContain('usermod')
    expect(dockerfile).not.toContain('/opt/java')
    expect(dockerfile).toContain('rm -f /etc/sudoers.d/vscode')
    expect(dockerfile).not.toMatch(/^ENV\s+.*DEBIAN_FRONTEND/m)
    expect(dockerfile).toContain('bun install --frozen-lockfile --production --ignore-scripts')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const name of ['pi-lens', '@earendil-works/pi-coding-agent']) {
      expect(manifest.dependencies[name]).toBeUndefined()
      expect(manifest.devDependencies[name]).toBeUndefined()
    }
    const verification = dockerfile
      .split('FROM tools AS verification')[1]!
      .split('FROM tools\n')[0]!
    expect(verification).toContain('WORKDIR /tmp/workbot-dev-check\nCOPY package.json bun.lock ./')
    expect(verification).toContain('USER vscode\nWORKDIR /workspace')
    expect(verification.indexOf('USER vscode')).toBeGreaterThan(-1)
    expect(verification.indexOf('USER vscode')).toBeLessThan(
      verification.indexOf('RUN --network=none'),
    )
  })

  it('源码格式检查使用统一规则', () => {
    const config = JSON.parse(readFileSync(join(root, '.oxfmtrc.json'), 'utf8'))
    expect(config.ignorePatterns).toBeUndefined()
  })

  it('GitHub CI 验收后才登录和发布，仅 main 可推送，PR 不接触凭证', () => {
    const ci = Bun.YAML.parse(
      readFileSync(join(root, '.github/workflows/docker-hub.yml'), 'utf8'),
    ) as {
      on: { push: { branches: string[] }; pull_request: unknown }
      permissions: { contents: string }
      jobs: {
        build: {
          steps: {
            name: string
            run?: string
            uses?: string
            if?: string
            with?: Record<string, unknown>
          }[]
        }
      }
    }
    expect(ci.on.push.branches).toEqual(['main'])
    expect(ci.on.pull_request).toBeNull()
    expect(ci.permissions).toEqual({ contents: 'read' })
    const steps = ci.jobs.build.steps
    const build = steps.findIndex((step) => step.name === 'Build and verify image')
    const login = steps.findIndex((step) => step.name === 'Log in to Docker Hub')
    const publish = steps.findIndex((step) => step.name === 'Publish verified image')
    expect(build).toBeGreaterThanOrEqual(0)
    expect(login).toBeGreaterThan(build)
    expect(publish).toBeGreaterThan(login)
    expect(steps[build]!.run).toBe('bash scripts/build.sh pi-workbot-dev:check')
    expect(steps[login]!.with?.password).toBe('${{ secrets.DOCKERHUB_TOKEN }}')
    expect(steps[0]!.with?.['persist-credentials']).toBe(false)
    for (const index of [login, publish])
      expect(steps[index]!.if).toBe(
        "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'",
      )
    expect(steps[publish]!.run?.trim().split('\n').slice(-2)).toEqual([
      'docker push "$image:sha-${GITHUB_SHA}"',
      'docker push "$image:latest"',
    ])
    expect(steps.find((step) => step.name === 'Install pinned Dev Container CLI')!.run).toContain(
      'require("./package.json").devDependencies["@devcontainers/cli"]',
    )
    for (const step of steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/)
      if (!step.run) continue
      const parsed = spawnSync('bash', ['-n', '-c', step.run], { encoding: 'utf8' })
      expect(parsed.status).toBe(0)
      expect(parsed.stderr).toBe('')
    }
  })

  it('移除旧 Go 二进制，固定源码版本重新编译，并显式更新开发头文件', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const packages = (dockerfile.match(/apt-get install\s+([\s\S]*?)&&/)?.[1] ?? '').split(/\s+/)
    expect(packages).toContain('linux-libc-dev')
    expect(packages).not.toContain('git-lfs')
    expect(packages).not.toContain('shfmt')
    expect(dockerfile).toContain('apt-get purge -y git-lfs shfmt')
    expect(dockerfile).toContain('GOTOOLCHAIN=local')
    expect(dockerfile).toMatch(/go install -trimpath mvdan\.cc\/sh\/v3\/cmd\/shfmt@v\d+\.\d+\.\d+/)
    expect(dockerfile).toMatch(
      /go install -trimpath github\.com\/git-lfs\/git-lfs\/v3@v\d+\.\d+\.\d+/,
    )
    expect(dockerfile).toContain('git-lfs install --system --skip-repo')
  })

  it('官方发布包固定版本并校验 SHA-256，不加入镜像加速或 LuaLS', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const downloads = [...dockerfile.matchAll(/ADD ([^\n]+)\\\n\s*(https:\/\/\S+) \S+/g)]
    expect(downloads).toHaveLength(6)
    for (const download of downloads) {
      expect(download[1]).toMatch(/--checksum=sha256:[a-f0-9]{64}/)
      expect(['download.eclipse.org', 'github.com', 'gitlab.com']).toContain(
        new URL(download[2]!).hostname,
      )
      expect(download[2]).not.toContain('/latest')
    }
    expect(dockerfile).toContain('/tmp/packages/gh.deb /tmp/packages/glab.deb')
    expect(dockerfile).not.toMatch(/npmmirror|aliyun|lua-language-server/)
    expect(dockerfile).toContain('cmake-language-server==0.1.11 pygls==1.3.1')
  })
})
