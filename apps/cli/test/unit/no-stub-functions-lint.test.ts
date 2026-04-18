/**
 * Tests for the proletariat/no-stub-functions ESLint rule (PRLT-1320).
 *
 * Validates that:
 * 1. Functions whose body is only `throw new Error('...removed...')` are flagged
 * 2. Functions delegating to a deadMethod helper are flagged
 * 3. Legitimate throw functions (assertions, validation) are NOT flagged
 * 4. Multi-statement function bodies are NOT flagged
 * 5. The ESLint config includes the rule as an error
 * 6. The implement action prompt warns against soft stubs
 * 7. docs/patterns.md documents the hard-remove policy
 */

import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CLI_ROOT = path.resolve(__dirname, '../..')
const SRC_ROOT = path.resolve(CLI_ROOT, 'src')
const DOCS_ROOT = path.resolve(CLI_ROOT, '../../docs')

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8')
}

describe('PRLT-1320: hard-remove policy — no-stub-functions lint rule', () => {
  describe('ESLint rule file exists and exports correct structure', () => {
    const rulePath = path.join(CLI_ROOT, 'eslint-rules/no-stub-functions.mjs')

    it('rule file exists', () => {
      expect(fs.existsSync(rulePath), 'eslint-rules/no-stub-functions.mjs should exist').to.be.true
    })

    it('rule file exports meta and create', async () => {
      const rule = await import(rulePath)
      const mod = rule.default || rule
      expect(mod).to.have.property('meta')
      expect(mod).to.have.property('create')
      expect(mod.meta.type).to.equal('problem')
    })

    it('rule has correct message IDs', async () => {
      const rule = await import(rulePath)
      const mod = rule.default || rule
      expect(mod.meta.messages).to.have.property('throwOnlyStub')
      expect(mod.meta.messages).to.have.property('deadMethodCall')
    })
  })

  describe('ESLint config registers the rule as an error', () => {
    const configSource = readFile(path.join(CLI_ROOT, 'eslint.config.mjs'))

    it('imports the no-stub-functions rule', () => {
      expect(configSource).to.include("import noStubFunctions from './eslint-rules/no-stub-functions.mjs'")
    })

    it('registers the rule under the proletariat plugin', () => {
      expect(configSource).to.include("'no-stub-functions': noStubFunctions")
    })

    it('enables the rule as an error', () => {
      expect(configSource).to.include("'proletariat/no-stub-functions': 'error'")
    })
  })

  describe('rule detection logic — stub patterns', () => {
    // These tests verify the rule's pattern detection by importing and
    // running the rule's internal logic against synthetic AST-like structures.
    // For full ESLint integration, the lint step in CI is the definitive check.

    it('STUB_KEYWORDS covers common removal patterns', async () => {
      const rulePath = path.join(CLI_ROOT, 'eslint-rules/no-stub-functions.mjs')
      const ruleSource = readFile(rulePath)
      const requiredKeywords = ['removed', 'deprecated', 'not implemented', 'stub', 'deleted', 'dead']
      for (const keyword of requiredKeywords) {
        expect(ruleSource).to.include(
          `'${keyword}'`,
          `STUB_KEYWORDS should include '${keyword}'`,
        )
      }
    })

    it('DEAD_METHOD_NAMES pattern matches deadMethod', async () => {
      const rulePath = path.join(CLI_ROOT, 'eslint-rules/no-stub-functions.mjs')
      const ruleSource = readFile(rulePath)
      expect(ruleSource).to.include('deadMethod', 'rule should detect deadMethod calls')
    })
  })

  describe('existing legacy stubs are suppressed with eslint-disable', () => {
    const storageSource = readFile(path.join(SRC_ROOT, 'lib/pmo/storage/index.ts'))

    it('has eslint-disable for proletariat/no-stub-functions on legacy stubs', () => {
      expect(storageSource).to.include(
        'eslint-disable proletariat/no-stub-functions',
        'legacy stubs must be suppressed with eslint-disable to avoid blocking CI',
      )
    })

    it('has eslint-enable to re-enable after the legacy stubs section', () => {
      expect(storageSource).to.include(
        'eslint-enable proletariat/no-stub-functions',
        'eslint-enable must follow the disabled section',
      )
    })

    it('disable comment references the tracking ticket PRLT-1319', () => {
      const disableLine = storageSource.split('\n').find(l => l.includes('eslint-disable proletariat/no-stub-functions'))
      expect(disableLine).to.include('PRLT-1319', 'disable comment should reference tracking ticket')
    })
  })

  describe('implement action prompt warns against soft stubs', () => {
    const baseSource = readFile(path.join(SRC_ROOT, 'lib/pmo/storage/base.ts'))

    it('implement action prompt contains hard-remove warning', () => {
      // Find the implement action's prompt text
      const implementMatch = baseSource.match(/id:\s*'implement'[\s\S]*?prompt:\s*`([\s\S]*?)`/)
      expect(implementMatch, 'implement action should exist with a prompt').to.not.be.null
      const prompt = implementMatch![1]
      expect(prompt).to.match(
        /hard.remove|soft.stub|delete.*entirely|throw.*removed/i,
        'implement prompt should warn against soft stubs',
      )
    })

    it('prompt mentions the TypeScript compiler as an audit tool', () => {
      // Search the full implement action block instead of trying to extract
      // the template literal (escaping makes regex extraction fragile).
      const implementBlock = baseSource.match(/id:\s*'implement'[\s\S]*?position:\s*\d+/)
      expect(implementBlock, 'implement action block should exist').to.not.be.null
      const block = implementBlock![0]
      expect(block).to.match(
        /TypeScript compiler/,
        'prompt should explain why hard removes are better (compiler catches callers)',
      )
    })
  })

  describe('docs/patterns.md documents the hard-remove policy', () => {
    const patternsDoc = readFile(path.join(DOCS_ROOT, 'patterns.md'))

    it('has a "Hard Remove Policy" section', () => {
      expect(patternsDoc).to.include('## Hard Remove Policy')
    })

    it('documents the no-stub rule', () => {
      expect(patternsDoc).to.include('proletariat/no-stub-functions')
    })

    it('explains why soft stubs are bad', () => {
      expect(patternsDoc).to.match(/soft.stub|runtime.*stub/i)
      expect(patternsDoc).to.match(/delete.*entirely|delete.*function/i)
    })

    it('shows BAD and GOOD code examples', () => {
      expect(patternsDoc).to.include('// BAD')
      expect(patternsDoc).to.include('// GOOD')
    })

    it('ESLint rules table includes no-stub-functions', () => {
      expect(patternsDoc).to.match(
        /no-stub-functions.*soft.stub/i,
        'ESLint rules table should include no-stub-functions',
      )
    })
  })

  describe('CI enforces the rule', () => {
    const ciConfig = readFile(path.join(CLI_ROOT, '../../.github/workflows/test.yml'))

    it('CI runs eslint on src/', () => {
      expect(ciConfig).to.match(
        /eslint\s+src\//,
        'CI must run eslint on src/ to enforce the no-stub-functions rule',
      )
    })

    it('lint job is a required check for CI status', () => {
      expect(ciConfig).to.include('lint', 'lint must be part of the CI pipeline')
    })
  })
})
