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

describe('Work Spawn Jira Integration', () => {
  it('defines Jira flags in spawn command source', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/spawn.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include("'from-jira'")
    expect(source).to.include("'jira-host'")
    expect(source).to.include("'jira-token'")
    expect(source).to.include("'jira-email'")
    expect(source).to.include("'jira-project'")
    expect(source).to.include("'jira-jql'")
    expect(source).to.include("'jira-limit'")
  })

  it('spawn command handles Jira source provider', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/spawn.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include("resolvedSource?.provider === 'jira'")
    expect(source).to.include('importJiraIssueToPmo')
    expect(source).to.include('listJiraIssues')
    expect(source).to.include('getJiraIssueByKey')
  })

  it('spawn command includes Jira source metadata tracking', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/work/spawn.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')
    expect(source).to.include('JIRA_NOT_CONFIGURED')
    expect(source).to.include('NO_JIRA_ISSUES')
    expect(source).to.include('autoExportToBoard')
  })
})
