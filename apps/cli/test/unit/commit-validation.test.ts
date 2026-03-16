import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { validateCommits } from '../../src/lib/execution/commit-validation.js'

/**
 * Unit tests for commit validation (PRLT-984).
 *
 * Tests the validateCommits() function which checks whether meaningful
 * code was committed on a branch, preventing agents from reporting
 * success when they only wrote boilerplate.
 *
 * Each test creates a temporary git repo, makes commits on a branch,
 * then validates those commits.
 */
describe('@smoke CommitValidation', () => {
  let tmpDir: string

  /** Detect the default branch name (main or master depending on git version) */
  function getDefaultBranch(dir: string): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      return 'master'
    }
  }

  let baseBranch: string

  function createTmpRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-validation-'))
    execSync('git init', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })
    // Create initial commit on default branch
    fs.writeFileSync(path.join(dir, '.gitkeep'), '')
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "initial"', { cwd: dir, stdio: 'pipe' })
    // Detect actual default branch name (may be 'main' or 'master')
    baseBranch = getDefaultBranch(dir)
    return dir
  }

  function createBranch(dir: string, name: string): void {
    execSync(`git checkout -b ${name}`, { cwd: dir, stdio: 'pipe' })
  }

  function commitFile(dir: string, filePath: string, content: string, message: string): void {
    const fullPath = path.join(dir, filePath)
    const dirName = path.dirname(fullPath)
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true })
    }
    fs.writeFileSync(fullPath, content)
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' })
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('fails when branch has no commits beyond base', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/test')
    // No commits on feature branch

    const result = validateCommits(tmpDir, 'feature/test', baseBranch)
    expect(result.passed).to.be.false
    expect(result.noCommits).to.be.true
    expect(result.details).to.include('No commits')
  })

  it('fails when branch does not exist', () => {
    tmpDir = createTmpRepo()

    const result = validateCommits(tmpDir, 'nonexistent-branch', baseBranch)
    expect(result.passed).to.be.false
    expect(result.noCommits).to.be.true
    expect(result.details).to.include('not found')
  })

  it('fails when only README.md was committed', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/readme-only')
    commitFile(tmpDir, 'README.md', '# My Project\n\nA cool project.', 'add readme')

    const result = validateCommits(tmpDir, 'feature/readme-only', baseBranch)
    expect(result.passed).to.be.false
    expect(result.boilerplateOnly).to.be.true
    expect(result.totalFiles).to.equal(1)
    expect(result.codeFiles).to.equal(0)
    expect(result.details).to.include('boilerplate')
  })

  it('fails when only LICENSE was committed', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/license-only')
    commitFile(tmpDir, 'LICENSE', 'MIT License...', 'add license')

    const result = validateCommits(tmpDir, 'feature/license-only', baseBranch)
    expect(result.passed).to.be.false
    expect(result.boilerplateOnly).to.be.true
  })

  it('fails when only .gitignore was committed', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/gitignore-only')
    commitFile(tmpDir, '.gitignore', 'node_modules/\ndist/', 'add gitignore')

    const result = validateCommits(tmpDir, 'feature/gitignore-only', baseBranch)
    expect(result.passed).to.be.false
    expect(result.boilerplateOnly).to.be.true
  })

  it('fails when only README.md and .gitignore were committed', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/boilerplate-combo')
    commitFile(tmpDir, 'README.md', '# My Project', 'add readme')
    commitFile(tmpDir, '.gitignore', 'node_modules/', 'add gitignore')

    const result = validateCommits(tmpDir, 'feature/boilerplate-combo', baseBranch)
    expect(result.passed).to.be.false
    expect(result.boilerplateOnly).to.be.true
    expect(result.totalFiles).to.equal(2)
    expect(result.codeFiles).to.equal(0)
  })

  it('passes when meaningful code files are committed', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/real-code')
    commitFile(tmpDir, 'src/index.ts', 'export function hello() { return "world" }', 'add source')

    const result = validateCommits(tmpDir, 'feature/real-code', baseBranch)
    expect(result.passed).to.be.true
    expect(result.codeFiles).to.be.greaterThanOrEqual(1)
    expect(result.totalInsertions).to.be.greaterThan(0)
    expect(result.noCommits).to.be.false
    expect(result.boilerplateOnly).to.be.false
  })

  it('passes when code files are committed alongside boilerplate', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/code-with-readme')
    commitFile(tmpDir, 'README.md', '# My Project', 'add readme')
    commitFile(tmpDir, 'src/app.py', 'def main():\n    print("hello")', 'add code')

    const result = validateCommits(tmpDir, 'feature/code-with-readme', baseBranch)
    expect(result.passed).to.be.true
    expect(result.totalFiles).to.equal(2)
    expect(result.codeFiles).to.equal(1)
  })

  it('passes with multiple code files and deep directory structure', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/multi-file')
    commitFile(tmpDir, 'src/lib/validation.ts', 'export function validate() { return true }', 'add validation')
    commitFile(tmpDir, 'src/lib/types.ts', 'export interface User { name: string }', 'add types')
    commitFile(tmpDir, 'test/validation.test.ts', 'describe("validate", () => { it("works", () => {}) })', 'add tests')

    const result = validateCommits(tmpDir, 'feature/multi-file', baseBranch)
    expect(result.passed).to.be.true
    expect(result.codeFiles).to.equal(3)
    expect(result.details).to.include('3 code file(s)')
  })

  it('includes correct insertion/deletion counts', () => {
    tmpDir = createTmpRepo()
    // Create a file on main that we'll modify on the branch
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), 'const old = true\n')
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' })
    execSync('git commit -m "add existing file"', { cwd: tmpDir, stdio: 'pipe' })

    createBranch(tmpDir, 'feature/modify')
    // Modify existing file
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), 'const updated = true\nconst extra = "new"\n')
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' })
    execSync('git commit -m "modify file"', { cwd: tmpDir, stdio: 'pipe' })

    const result = validateCommits(tmpDir, 'feature/modify', baseBranch)
    expect(result.passed).to.be.true
    expect(result.totalInsertions).to.be.greaterThan(0)
    expect(result.totalDeletions).to.be.greaterThan(0)
  })

  it('auto-detects base branch when not specified', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/auto-base')
    commitFile(tmpDir, 'src/main.rs', 'fn main() { println!("hello") }', 'add rust code')

    // Don't pass baseBranch — should auto-detect 'main'
    const result = validateCommits(tmpDir, 'feature/auto-base')
    expect(result.passed).to.be.true
  })

  it('handles case-insensitive boilerplate detection', () => {
    tmpDir = createTmpRepo()
    createBranch(tmpDir, 'feature/uppercase-readme')
    commitFile(tmpDir, 'README.MD', '# UPPERCASE README', 'add readme')

    const result = validateCommits(tmpDir, 'feature/uppercase-readme', baseBranch)
    expect(result.passed).to.be.false
    expect(result.boilerplateOnly).to.be.true
  })
})
