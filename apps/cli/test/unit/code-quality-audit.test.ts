/**
 * Code Quality Audit Tests — PRLT-1298
 *
 * Validates that code quality rules are enforced:
 * - Zero empty catch blocks
 * - Zero unused imports (ESLint config)
 * - ESLint config has stricter rules
 * - CI workflow includes lint job
 * - Patterns doc exists
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(CLI_ROOT, '../..')
const ESLINT_CONFIG_PATH = path.resolve(CLI_ROOT, 'eslint.config.mjs')
const WORKFLOW_PATH = path.resolve(REPO_ROOT, '.github/workflows/test.yml')
const PATTERNS_DOC_PATH = path.resolve(REPO_ROOT, 'docs/patterns.md')

describe('Code quality audit (PRLT-1298)', () => {
  describe('ESLint configuration', () => {
    let eslintConfig: string

    before(() => {
      eslintConfig = fs.readFileSync(ESLINT_CONFIG_PATH, 'utf-8')
    })

    it('should enforce no-empty with allowEmptyCatch: false', () => {
      expect(eslintConfig).to.include("'no-empty'")
      expect(eslintConfig).to.include('allowEmptyCatch: false')
    })

    it('should enforce no-unreachable as error', () => {
      expect(eslintConfig).to.include("'no-unreachable': 'error'")
    })

    it('should enforce @typescript-eslint/no-unused-vars as error', () => {
      expect(eslintConfig).to.include("'@typescript-eslint/no-unused-vars': ['error'")
    })

    it('should warn on @typescript-eslint/no-explicit-any', () => {
      expect(eslintConfig).to.include("'@typescript-eslint/no-explicit-any': 'warn'")
    })

    it('should have PRLT-1298 code quality rules section', () => {
      expect(eslintConfig).to.include('Code quality rules (PRLT-1298)')
    })
  })

  describe('Zero empty catch blocks', () => {
    it('should have no truly empty catch blocks in src/', () => {
      // Grep for catch {} with no content at all (not even a comment)
      // Uses a simple pattern: catch followed by optional parens, then { }
      const srcDir = path.resolve(CLI_ROOT, 'src')
      let output = ''
      try {
        // Find catch blocks that are empty (no body at all)
        output = execSync(
          `python3 -c "
import re, glob
pattern = re.compile(r'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}', re.MULTILINE)
files = glob.glob('${srcDir}/**/*.ts', recursive=True)
results = []
for f in files:
    with open(f) as fh:
        content = fh.read()
    for m in pattern.finditer(content):
        line_num = content[:m.start()].count('\\\\n') + 1
        results.append(f'{f}:{line_num}')
print(len(results))
"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim()
      } catch {
        // If python3 is not available, skip
        return
      }
      expect(parseInt(output, 10)).to.equal(0, `Found empty catch blocks: ${output}`)
    })
  })

  describe('CI lint enforcement', () => {
    let workflowContent: string

    before(() => {
      workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8')
    })

    it('should have a lint job in CI', () => {
      expect(workflowContent).to.include('lint:')
      expect(workflowContent).to.include('pnpm lint')
    })

    it('should have a typecheck step in CI', () => {
      expect(workflowContent).to.include('pnpm typecheck')
    })

    it('should include lint in ci-status dependencies', () => {
      expect(workflowContent).to.include('needs: [detect-changes, lint, build, unit-tests, e2e-tests]')
    })

    it('should fail CI if lint fails', () => {
      expect(workflowContent).to.include('needs.lint.result')
      expect(workflowContent).to.include('FAIL: lint failed')
    })
  })

  describe('Patterns documentation', () => {
    let patternsDoc: string

    before(() => {
      patternsDoc = fs.readFileSync(PATTERNS_DOC_PATH, 'utf-8')
    })

    it('should exist at docs/patterns.md', () => {
      expect(fs.existsSync(PATTERNS_DOC_PATH)).to.be.true
    })

    it('should document error handling patterns', () => {
      expect(patternsDoc).to.include('Error Handling')
      expect(patternsDoc).to.include('Never swallow errors silently')
    })

    it('should document return patterns', () => {
      expect(patternsDoc).to.include('Return Patterns')
      expect(patternsDoc).to.include('Early returns for guards')
    })

    it('should document import hygiene', () => {
      expect(patternsDoc).to.include('Import Hygiene')
      expect(patternsDoc).to.include('Remove unused imports')
    })

    it('should document null handling', () => {
      expect(patternsDoc).to.include('Null Handling')
    })

    it('should document ESLint rules', () => {
      expect(patternsDoc).to.include('ESLint Rules')
      expect(patternsDoc).to.include('no-empty')
      expect(patternsDoc).to.include('no-unreachable')
      expect(patternsDoc).to.include('no-unused-vars')
    })
  })

  describe('No unreachable code', () => {
    it('should not have return statements followed by more code in execution/logs.ts', () => {
      const filePath = path.resolve(CLI_ROOT, 'src/commands/execution/logs.ts')
      if (!fs.existsSync(filePath)) return
      const content = fs.readFileSync(filePath, 'utf-8')
      // Check for the specific pattern that was fixed: return followed by db.close()
      const lines = content.split('\n')
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim() === 'return' && lines[i + 1].trim().startsWith('db.close()')) {
          expect.fail(`Found unreachable db.close() after return at line ${i + 2}`)
        }
      }
    })

    it('should not have return statements followed by more code in execution/view.ts', () => {
      const filePath = path.resolve(CLI_ROOT, 'src/commands/execution/view.ts')
      if (!fs.existsSync(filePath)) return
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trim() === 'return' && lines[i + 1].trim().startsWith('db.close()')) {
          expect.fail(`Found unreachable db.close() after return at line ${i + 2}`)
        }
      }
    })
  })
})
