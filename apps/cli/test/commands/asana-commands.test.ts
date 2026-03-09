import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Asana Commands', () => {
  it('connect command defines auth-related flags and description', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/asana/connect.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')

    expect(source).to.include('Authenticate with Asana')
    expect(source).to.include('disconnect')
    expect(source).to.include('workspace')
    expect(source).to.include('project')
  })

  it('sync command defines ticket/task sync flags', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/asana/sync.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')

    expect(source).to.include('Sync PMO tickets to Asana tasks')
    expect(source).to.include('create-missing')
    expect(source).to.include('ticket')
    expect(source).to.include('task')
  })

  it('import command defines import-related flags and description', () => {
    const sourcePath = path.resolve(__dirname, '../../src/commands/asana/import.ts')
    const source = fs.readFileSync(sourcePath, 'utf-8')

    expect(source).to.include('Import Asana tasks into PMO as tickets')
    expect(source).to.include('limit')
    expect(source).to.include('dry-run')
    expect(source).to.include('all')
  })
})
