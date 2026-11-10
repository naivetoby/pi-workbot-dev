// @env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LspProbe } from './lsp-probe'

export function prepareLanguageProbes(root: string): LspProbe[] {
  const cases = [
    {
      command: 'typescript-language-server',
      args: ['--stdio'],
      languageId: 'typescript',
      file: 'sample.ts',
      bad: 'export const value: number = "bad";\n',
      good: 'export const value: number = 1;\n',
      expected: /not assignable/i,
    },
    {
      command: 'bash-language-server',
      args: ['start'],
      languageId: 'shellscript',
      file: 'sample.sh',
      bad: '#!/bin/bash\nif true; then\n  echo value\n',
      good: '#!/bin/bash\necho value\n',
      expected: /fi|parse|syntax|end/i,
    },
    {
      command: 'docker-langserver',
      args: ['--stdio'],
      languageId: 'dockerfile',
      file: 'Dockerfile',
      bad: 'FROM\n',
      good: 'FROM ubuntu:24.04\n',
      expected: /source|argument|FROM/i,
    },
    {
      command: 'marksman',
      args: ['server'],
      languageId: 'markdown',
      file: 'sample.md',
      bad: '# Title\n\n[[missing]]\n',
      good: '# Title\n\nText.\n',
      expected: /missing|resolve|exist|reference/i,
    },
    {
      command: 'taplo',
      args: ['lsp', 'stdio'],
      languageId: 'toml',
      file: 'sample.toml',
      bad: 'value = [\n',
      good: 'value = 1\n',
      expected: /expected|unterminated|invalid|parse|EOF/i,
    },
    {
      command: 'rust-analyzer',
      args: [],
      languageId: 'rust',
      file: 'src/main.rs',
      bad: 'fn main() { let = ; }\n',
      good: 'fn main() {}\n',
      expected: /expected|parse|syntax/i,
    },
    {
      command: 'svelteserver',
      args: ['--stdio'],
      languageId: 'svelte',
      file: 'Sample.svelte',
      bad: '<script lang="ts">let value: number = "bad";</script>\n<p>{value}</p>\n',
      good: '<script lang="ts">let value: number = 1;</script>\n<p>{value}</p>\n',
      expected: /not assignable/i,
    },
  ]
  return cases.map((test) => {
    const cwd = join(root, 'lsp', test.languageId)
    const file = join(cwd, test.file)
    mkdirSync(dirname(file), { recursive: true })
    if (test.languageId === 'typescript' || test.languageId === 'svelte') {
      writeFileSync(join(cwd, 'package.json'), '{"private":true,"type":"module"}')
      writeFileSync(
        join(cwd, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
          },
          include: ['**/*.ts', '**/*.svelte'],
        }),
      )
    }
    if (test.languageId === 'markdown') writeFileSync(join(cwd, '.marksman.toml'), '')
    if (test.languageId === 'rust') {
      writeFileSync(
        join(cwd, 'Cargo.toml'),
        '[package]\nname = "lsp-probe"\nversion = "0.1.0"\nedition = "2024"\n',
      )
    }
    return { ...test, cwd, file }
  })
}
