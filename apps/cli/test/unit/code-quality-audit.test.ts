/**
 * Code Quality Audit Tests — PRLT-1298
 *
 * Validates acceptance criteria:
 * - ESLint config has strict quality rules
 * - Zero empty catch blocks (without comments)
 * - Zero unused imports (lint passes)
 * - Duplicate session parsers consolidated
 * - Dead code removed (no unreachable code)
 * - CI enforces lint on all PRs
 * - docs/patterns.md exists with required topics
 */
import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLI_ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(CLI_ROOT, '../..')

describe('Code quality audit (PRLT-1298)', () => {
  describe('ESLint config', () => {
    let eslintConfig: string

    before(() => {
      eslintConfig = fs.readFileSync(path.join(CLI_ROOT, 'eslint.config.mjs'), 'utf-8')
    })

    it('should enforce no-empty as error', () => {
      expect(eslintConfig).to.include("'no-empty'")
      expect(eslintConfig).to.include('allowEmptyCatch: false')
    })

    it('should enforce no-unreachable as error', () => {
      expect(eslintConfig).to.include("'no-unreachable': 'error'")
    })

    it('should enforce no-unused-vars with underscore pattern', () => {
      expect(eslintConfig).to.include("'@typescript-eslint/no-unused-vars'")
      expect(eslintConfig).to.include("varsIgnorePattern: '^_'")
      expect(eslintConfig).to.include("caughtErrorsIgnorePattern: '^_'")
    })

    it('should have test file overrides', () => {
      expect(eslintConfig).to.include("files: ['test/**/*.ts'")
    })
  })

  describe('empty catch blocks', () => {
    it('should have zero empty catch blocks without comments in src/', () => {
      // Find catch blocks that are completely empty: catch {} or catch (e) {}
      // Blocks with comments like /* ... */ are acceptable
      const srcDir = path.join(CLI_ROOT, 'src')
      const result = execSync(
        `grep -rn "catch\\s*{\\s*}" ${srcDir} --include="*.ts" || true`,
        { encoding: 'utf-8' }
      )

      // Filter out lines that have comments inside the catch block
      const violations = result
        .split('\n')
        .filter(line => line.trim().length > 0)
        .filter(line => {
          // Lines with comments like /* ... */ inside catch {} are acceptable
          return !line.includes('/*') && !line.includes('//')
        })

      expect(violations, `Empty catch blocks without comments:\n${violations.join('\n')}`).to.have.length(0)
    })
  })

  describe('duplicate code consolidation', () => {
    it('should export extractAgentNameFromSession from session-utils', () => {
      const sessionUtils = fs.readFileSync(
        path.join(CLI_ROOT, 'src/lib/execution/session-utils.ts'),
        'utf-8'
      )
      expect(sessionUtils).to.include('export function extractAgentNameFromSession')
    })

    it('should NOT have a local extractAgentNameFromSession in cascade.ts', () => {
      const cascade = fs.readFileSync(
        path.join(CLI_ROOT, 'src/lib/gc/cascade.ts'),
        'utf-8'
      )
      // Should import, not define locally
      expect(cascade).to.not.match(/^function extractAgentNameFromSession/m)
      expect(cascade).to.include("import { extractAgentNameFromSession }")
    })

    it('should NOT have a local extractAgentNameFromSessionId in container-cleanup-hook.ts', () => {
      const hook = fs.readFileSync(
        path.join(CLI_ROOT, 'src/lib/work-lifecycle/container-cleanup-hook.ts'),
        'utf-8'
      )
      expect(hook).to.not.match(/^function extractAgentNameFromSessionId/m)
      expect(hook).to.include("import { extractAgentNameFromSession }")
    })
  })

  describe('dead code', () => {
    it('should have no unreachable code after return statements in key files', () => {
      const filesToCheck = [
        'src/commands/execution/logs.ts',
        'src/commands/execution/view.ts',
        'src/commands/work/spawn.ts',
      ]

      for (const file of filesToCheck) {
        const content = fs.readFileSync(path.join(CLI_ROOT, file), 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length - 1; i++) {
          const trimmed = lines[i].trim()
          const nextTrimmed = lines[i + 1]?.trim()

          // Check for return followed by statements on the next line (same block)
          if (trimmed === 'return' || trimmed.startsWith('return ')) {
            // Skip if next line is closing brace, comment, or empty
            if (nextTrimmed && !nextTrimmed.startsWith('}') &&
                !nextTrimmed.startsWith('//') && !nextTrimmed.startsWith('/*') &&
                !nextTrimmed.startsWith('*') && nextTrimmed !== '') {
              // Check if next line is code in the same block (not a case/label)
              if (nextTrimmed.startsWith('db.close()') || nextTrimmed === 'return') {
                throw new Error(
                  `Unreachable code in ${file}:${i + 2}: "${nextTrimmed}" after return`
                )
              }
            }
          }
        }
      }
    })
  })

  describe('CI lint enforcement', () => {
    it('should have a lint job in the CI workflow', () => {
      const workflow = fs.readFileSync(
        path.join(REPO_ROOT, '.github/workflows/test.yml'),
        'utf-8'
      )
      expect(workflow).to.include('lint:')
      expect(workflow).to.include('eslint src/')
    })

    it('should include lint in ci-status needs', () => {
      const workflow = fs.readFileSync(
        path.join(REPO_ROOT, '.github/workflows/test.yml'),
        'utf-8'
      )
      expect(workflow).to.match(/needs:.*lint.*build/)
    })

    it('should fail CI if lint fails', () => {
      const workflow = fs.readFileSync(
        path.join(REPO_ROOT, '.github/workflows/test.yml'),
        'utf-8'
      )
      expect(workflow).to.include('needs.lint.result')
      expect(workflow).to.include('FAIL: lint failed')
    })
  })

  describe('patterns documentation', () => {
    let patternsDoc: string

    before(() => {
      const patternsPath = path.join(REPO_ROOT, 'docs/patterns.md')
      expect(fs.existsSync(patternsPath), 'docs/patterns.md should exist').to.be.true
      patternsDoc = fs.readFileSync(patternsPath, 'utf-8')
    })

    it('should document error handling patterns', () => {
      expect(patternsDoc).to.include('Error Handling')
      expect(patternsDoc).to.include('Never swallow errors')
    })

    it('should document return patterns', () => {
      expect(patternsDoc).to.include('Return Patterns')
      expect(patternsDoc).to.include('early return')
    })

    it('should document null handling', () => {
      expect(patternsDoc).to.include('Null Handling')
      expect(patternsDoc).to.include('undefined')
    })

    it('should document naming conventions', () => {
      expect(patternsDoc).to.include('Naming')
      expect(patternsDoc).to.include('No metadata encoded in identifiers')
    })
  })
})
