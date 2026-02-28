import { expect } from 'chai'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '../..')

function getIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.PRLT_HQ_PATH
  delete env.PRLT_PMO_PATH
  delete env.PRLT_DATABASE_PATH
  delete env.PRLT_CONFIG_PATH
  delete env.DEVCONTAINER
  delete env.PRLT_TEST_ENV
  return env
}

function runCli(args: string[]): string {
  const binPath = path.join(root, 'bin', 'run.js')
  try {
    return execSync(`node ${binPath} ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getIsolatedEnv(),
    })
  } catch (error: unknown) {
    return (error as { stdout?: string })?.stdout || ''
  }
}

describe('Work Linear Command', () => {
  it('shows work linear usage in help output', () => {
    const output = runCli(['work', 'linear', '--help'])
    expect(output).to.contain('work linear')
    expect(output).to.contain('--issue')
    expect(output).to.contain('--team')
  })

  it('smoke: command delegates to work:start for spawn execution', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/linear.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include("this.config.runCommand('work:start'")
  })
})
