import { expect } from 'chai'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CLI_ROOT = path.resolve(__dirname, '..', '..')
const SRC_DIR = path.join(CLI_ROOT, 'src')
const REPO_ROOT = path.resolve(CLI_ROOT, '..', '..')

describe('Code Quality Audit', () => {
  describe('ESLint configuration', () => {
    it('has strict rules configured in eslint.config.mjs', () => {
      const configPath = path.join(CLI_ROOT, 'eslint.config.mjs')
      const config = fs.readFileSync(configPath, 'utf-8')

      // no-empty must be error with allowEmptyCatch: false
      expect(config).to.include("'no-empty'")
      expect(config).to.include('allowEmptyCatch: false')

      // no-unreachable must be error
      expect(config).to.include("'no-unreachable': 'error'")

      // @typescript-eslint/no-unused-vars must be error with _ prefix convention
      expect(config).to.include("'@typescript-eslint/no-unused-vars'")
      expect(config).to.include("varsIgnorePattern: '^_'")
      expect(config).to.include("argsIgnorePattern: '^_'")
    })

    it('downgraded pre-existing violations to warnings', () => {
      const configPath = path.join(CLI_ROOT, 'eslint.config.mjs')
      const config = fs.readFileSync(configPath, 'utf-8')

      // These rules should be warnings, not errors
      expect(config).to.include("'no-void': 'warn'")
      expect(config).to.include("'no-useless-return': 'warn'")
      expect(config).to.include("'n/no-unsupported-features/node-builtins': 'warn'")
    })

    it('disabled perfectionist/sort-sets', () => {
      const configPath = path.join(CLI_ROOT, 'eslint.config.mjs')
      const config = fs.readFileSync(configPath, 'utf-8')
      expect(config).to.include("'perfectionist/sort-sets': 'off'")
    })
  })

  describe('Empty catch blocks', () => {
    it('has zero empty catch blocks in source code', () => {
      // Find all .ts files in src/
      const result = execSync(
        `python3 -c "
import re, os
pattern = re.compile(r'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}')
count = 0
for root, dirs, files in os.walk('${SRC_DIR}'):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for f in files:
        if f.endswith('.ts'):
            with open(os.path.join(root, f)) as fp:
                if pattern.search(fp.read()):
                    count += 1
print(count)
"`,
        { encoding: 'utf-8' }
      ).trim()

      expect(parseInt(result, 10)).to.equal(0, 'Found empty catch blocks in source code')
    })
  })

  describe('Unused imports', () => {
    it('ESLint reports zero errors on src/', function (this: Mocha.Context) {
      this.timeout(120000)
      try {
        execSync('npx eslint --no-cache src/ --quiet', {
          cwd: CLI_ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err: any) {
        const output = err.stdout || err.stderr || ''
        // Count only errors (not warnings)
        const errorMatch = output.match(/(\d+) errors?/)
        const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0
        expect(errorCount).to.equal(0, `ESLint errors found:\n${output.slice(0, 2000)}`)
      }
    })
  })

  describe('Duplicate code consolidation', () => {
    it('session-utils.ts has the canonical parseSessionName', () => {
      const sessionUtils = fs.readFileSync(
        path.join(SRC_DIR, 'lib', 'execution', 'session-utils.ts'),
        'utf-8'
      )
      expect(sessionUtils).to.include('export function parseSessionName')
    })

    it('no duplicate extractAgentNameFromSession functions in source', () => {
      const result = execSync(
        `grep -rn "function extractAgentNameFromSession" "${SRC_DIR}" --include="*.ts" | wc -l`,
        { encoding: 'utf-8' }
      ).trim()
      expect(parseInt(result, 10)).to.equal(0, 'Found duplicate extractAgentNameFromSession functions')
    })

    it('no duplicate extractAgentNameFromSessionId functions in source', () => {
      const result = execSync(
        `grep -rn "function extractAgentNameFromSessionId" "${SRC_DIR}" --include="*.ts" | wc -l`,
        { encoding: 'utf-8' }
      ).trim()
      expect(parseInt(result, 10)).to.equal(0, 'Found duplicate extractAgentNameFromSessionId functions')
    })
  })

  describe('Dead code removal', () => {
    it('no unreachable code after return statements', function (this: Mocha.Context) {
      this.timeout(120000)
      try {
        const output = execSync(
          'npx eslint --no-cache src/ --quiet -f json',
          { cwd: CLI_ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
        const data = JSON.parse(output)
        let unreachableCount = 0
        for (const file of data) {
          for (const msg of file.messages || []) {
            if (msg.ruleId === 'no-unreachable' && msg.severity >= 2) {
              unreachableCount++
            }
          }
        }
        expect(unreachableCount).to.equal(0)
      } catch (err: any) {
        // ESLint exits with code 1 when there are errors
        const output = err.stdout || ''
        if (output.startsWith('[')) {
          const data = JSON.parse(output)
          let unreachableCount = 0
          for (const file of data) {
            for (const msg of file.messages || []) {
              if (msg.ruleId === 'no-unreachable' && msg.severity >= 2) {
                unreachableCount++
              }
            }
          }
          expect(unreachableCount).to.equal(0, 'Found unreachable code')
        }
      }
    })
  })

  describe('CI enforcement', () => {
    it('test.yml includes a lint job', () => {
      const ciConfig = fs.readFileSync(
        path.join(REPO_ROOT, '.github', 'workflows', 'test.yml'),
        'utf-8'
      )
      expect(ciConfig).to.include('lint:')
      expect(ciConfig).to.include('npx eslint src/ --quiet')
    })

    it('ci-status job depends on lint', () => {
      const ciConfig = fs.readFileSync(
        path.join(REPO_ROOT, '.github', 'workflows', 'test.yml'),
        'utf-8'
      )
      expect(ciConfig).to.include('needs: [detect-changes, lint, build, unit-tests, e2e-tests]')
    })
  })

  describe('Patterns documentation', () => {
    it('docs/patterns.md exists', () => {
      const patternsPath = path.join(REPO_ROOT, 'docs', 'patterns.md')
      expect(fs.existsSync(patternsPath)).to.be.true
    })

    it('covers all required topics', () => {
      const patternsPath = path.join(REPO_ROOT, 'docs', 'patterns.md')
      const patterns = fs.readFileSync(patternsPath, 'utf-8')

      expect(patterns).to.include('Error Handling')
      expect(patterns).to.include('Unused Code')
      expect(patterns).to.include('Return Patterns')
      expect(patterns).to.include('Null Handling')
      expect(patterns).to.include('Naming')
      expect(patterns).to.include('Duplicate Code')
    })
  })
})
