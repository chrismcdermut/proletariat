import { expect } from 'chai'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Work Jira Command', () => {
  it('defines Jira-specific flags in command source', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/jira.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include('work jira')
    expect(source).to.include("'project-key'")
    expect(source).to.include('jql')
    expect(source).to.include('issue')
  })

  it('smoke: command delegates to work:start for spawn execution', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/jira.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include("this.config.runCommand('work:start'")
  })
})
