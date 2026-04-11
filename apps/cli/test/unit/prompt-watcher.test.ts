/* eslint-disable max-nested-callbacks */
import { expect } from 'chai'
import {
  detectPrompt,
  detectUnknownPrompt,
  findMenuOptionKey,
  resolveKeyToSend,
  KNOWN_PROMPT_PATTERNS,
  type PromptPattern,
} from '../../src/lib/execution/prompt-watcher.js'

// =============================================================================
// Realistic pane content fixtures
// =============================================================================

const VERCEL_TELEMETRY_PANE = [
  '  ☐ Telemetry',
  '  The Vercel plugin collects anonymous usage data...',
  '  ❯ 1. Share prompts',
  '    2. No thanks',
  '    3. Type something.',
  '    4. Chat about this',
].join('\n')

const CLAUDE_PERMISSION_PANE = [
  '  Claude requested permissions to edit',
  '  /Users/agent/.claude/vercel-plugin-telemetry-preference',
  '  which is a sensitive file.',
  '  ❯ 1. Yes',
  '    2. Yes, and always allow access to .claude/ from this project',
  '    3. No',
].join('\n')

const CLAUDE_PERMISSION_PANE_NO_ALWAYS = [
  '  Claude requested permissions to edit',
  '  /Users/agent/.claude/some-plugin-config',
  '  which is a sensitive file.',
  '  ❯ 1. Yes',
  '    2. No',
].join('\n')

const NORMAL_NUMBERED_LIST = [
  'Here are the available options:',
  '',
  '1. Run tests',
  '2. Build project',
  '3. Deploy',
  '',
  'Which would you like to do?',
].join('\n')

const NORMAL_CODE_OUTPUT = [
  '⏺ I\'ll now implement the feature.',
  '',
  '  Writing to src/index.ts:',
  '  1  import { foo } from "./bar"',
  '  2  import { baz } from "./qux"',
  '  3',
  '  4  export function main() {',
  '  5    return foo() + baz()',
  '  6  }',
  '',
  '  esc to interrupt',
].join('\n')

const UNKNOWN_PLUGIN_PROMPT = [
  '  ☐ Some New Plugin Setup',
  '  This plugin needs to configure something...',
  '  ❯ 1. Configure now',
  '    2. Skip setup',
  '    3. Learn more',
].join('\n')

const WORKING_AGENT_OUTPUT = [
  '⏺ Reading file src/lib/execution/spawner.ts',
  '',
  '  Found 945 lines of code.',
  '',
  '  esc to interrupt',
].join('\n')

// =============================================================================
// Tests
// =============================================================================

describe('Prompt Watcher', () => {
  // ===========================================================================
  // detectPrompt
  // ===========================================================================
  describe('detectPrompt', () => {
    it('should detect Vercel telemetry prompt', () => {
      const result = detectPrompt(VERCEL_TELEMETRY_PANE)
      expect(result).to.not.be.null
      expect(result!.pattern.name).to.equal('vercel-plugin-telemetry')
      expect(result!.matchedText).to.equal('The Vercel plugin collects anonymous usage data')
    })

    it('should detect Claude sensitive file permission prompt', () => {
      const result = detectPrompt(CLAUDE_PERMISSION_PANE)
      expect(result).to.not.be.null
      expect(result!.pattern.name).to.equal('claude-sensitive-file-permission')
      expect(result!.matchedText).to.equal('Claude requested permissions to edit')
    })

    it('should NOT match normal numbered lists without cursor marker', () => {
      const result = detectPrompt(NORMAL_NUMBERED_LIST)
      expect(result).to.be.null
    })

    it('should NOT match normal code output', () => {
      const result = detectPrompt(NORMAL_CODE_OUTPUT)
      expect(result).to.be.null
    })

    it('should NOT match working agent output', () => {
      const result = detectPrompt(WORKING_AGENT_OUTPUT)
      expect(result).to.be.null
    })

    it('should return null for empty pane content', () => {
      expect(detectPrompt('')).to.be.null
    })

    it('should return null when cursor marker is present but no known header', () => {
      const pane = '❯ some random text with cursor'
      expect(detectPrompt(pane)).to.be.null
    })

    it('should return null when known header present but no cursor marker', () => {
      const pane = 'The Vercel plugin collects anonymous usage data\n1. Share prompts\n2. No thanks'
      expect(detectPrompt(pane)).to.be.null
    })
  })

  // ===========================================================================
  // detectUnknownPrompt
  // ===========================================================================
  describe('detectUnknownPrompt', () => {
    it('should detect unknown plugin prompt with cursor and numbered menu', () => {
      expect(detectUnknownPrompt(UNKNOWN_PLUGIN_PROMPT)).to.be.true
    })

    it('should NOT flag known Vercel telemetry prompt as unknown', () => {
      expect(detectUnknownPrompt(VERCEL_TELEMETRY_PANE)).to.be.false
    })

    it('should NOT flag known Claude permission prompt as unknown', () => {
      expect(detectUnknownPrompt(CLAUDE_PERMISSION_PANE)).to.be.false
    })

    it('should NOT flag normal numbered list without cursor', () => {
      expect(detectUnknownPrompt(NORMAL_NUMBERED_LIST)).to.be.false
    })

    it('should NOT flag normal code output', () => {
      expect(detectUnknownPrompt(NORMAL_CODE_OUTPUT)).to.be.false
    })

    it('should NOT flag empty pane', () => {
      expect(detectUnknownPrompt('')).to.be.false
    })

    it('should NOT flag cursor marker without numbered menu', () => {
      const pane = '❯ just a cursor line\nsome text'
      expect(detectUnknownPrompt(pane)).to.be.false
    })
  })

  // ===========================================================================
  // findMenuOptionKey
  // ===========================================================================
  describe('findMenuOptionKey', () => {
    it('should find "No thanks" as option 2 in Vercel telemetry menu', () => {
      const key = findMenuOptionKey(VERCEL_TELEMETRY_PANE, 'No thanks')
      expect(key).to.equal('2')
    })

    it('should find "Share prompts" as option 1 in Vercel telemetry menu', () => {
      const key = findMenuOptionKey(VERCEL_TELEMETRY_PANE, 'Share prompts')
      expect(key).to.equal('1')
    })

    it('should find "Yes" as option 1 in permission dialog', () => {
      const key = findMenuOptionKey(CLAUDE_PERMISSION_PANE, 'Yes')
      expect(key).to.equal('1')
    })

    it('should find "Yes, and always allow" as option 2 in permission dialog', () => {
      const key = findMenuOptionKey(CLAUDE_PERMISSION_PANE, 'Yes, and always allow access to .claude/')
      expect(key).to.equal('2')
    })

    it('should return null for non-existent option', () => {
      const key = findMenuOptionKey(VERCEL_TELEMETRY_PANE, 'Non-existent option')
      expect(key).to.be.null
    })

    it('should match case-insensitively', () => {
      const key = findMenuOptionKey(VERCEL_TELEMETRY_PANE, 'no thanks')
      expect(key).to.equal('2')
    })
  })

  // ===========================================================================
  // resolveKeyToSend
  // ===========================================================================
  describe('resolveKeyToSend', () => {
    it('should resolve "No thanks" for Vercel telemetry (decline)', () => {
      const pattern = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'vercel-plugin-telemetry')!
      const result = resolveKeyToSend(VERCEL_TELEMETRY_PANE, pattern)
      expect(result).to.not.be.null
      expect(result!.key).to.equal('2')
      expect(result!.optionText).to.equal('No thanks')
    })

    it('should resolve "Yes, and always allow" for Claude permission (approve_always)', () => {
      const pattern = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-sensitive-file-permission')!
      const result = resolveKeyToSend(CLAUDE_PERMISSION_PANE, pattern)
      expect(result).to.not.be.null
      expect(result!.key).to.equal('2')
      expect(result!.optionText).to.equal('Yes, and always allow access to .claude/')
    })

    it('should fall back to "Yes" when "always allow" is not available', () => {
      const pattern = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-sensitive-file-permission')!
      const result = resolveKeyToSend(CLAUDE_PERMISSION_PANE_NO_ALWAYS, pattern)
      expect(result).to.not.be.null
      expect(result!.key).to.equal('1')
      expect(result!.optionText).to.equal('Yes')
    })

    it('should return null when no matching option is found', () => {
      const pattern: PromptPattern = {
        name: 'test-pattern',
        headerMatch: 'test header',
        cursorMarker: '❯',
        action: 'decline',
        preferredOption: 'Nonexistent option',
      }
      const result = resolveKeyToSend(VERCEL_TELEMETRY_PANE, pattern)
      expect(result).to.be.null
    })
  })

  // ===========================================================================
  // KNOWN_PROMPT_PATTERNS registry
  // ===========================================================================
  describe('KNOWN_PROMPT_PATTERNS', () => {
    it('should have at least 2 registered patterns', () => {
      expect(KNOWN_PROMPT_PATTERNS.length).to.be.at.least(2)
    })

    it('should have unique pattern names', () => {
      const names = KNOWN_PROMPT_PATTERNS.map(p => p.name)
      expect(new Set(names).size).to.equal(names.length)
    })

    it('should have vercel-plugin-telemetry with decline action', () => {
      const pattern = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'vercel-plugin-telemetry')
      expect(pattern).to.exist
      expect(pattern!.action).to.equal('decline')
    })

    it('should have claude-sensitive-file-permission with approve_always action', () => {
      const pattern = KNOWN_PROMPT_PATTERNS.find(p => p.name === 'claude-sensitive-file-permission')
      expect(pattern).to.exist
      expect(pattern!.action).to.equal('approve_always')
      expect(pattern!.fallbackOption).to.equal('Yes')
    })
  })

  // ===========================================================================
  // False positive regression tests
  // ===========================================================================
  describe('false positive prevention', () => {
    it('should not match agent output with numbered tool results', () => {
      const pane = [
        '⏺ Found 3 matching files:',
        '  1. src/lib/foo.ts',
        '  2. src/lib/bar.ts',
        '  3. src/lib/baz.ts',
        '',
        '  esc to interrupt',
      ].join('\n')
      expect(detectPrompt(pane)).to.be.null
      expect(detectUnknownPrompt(pane)).to.be.false
    })

    it('should not match markdown numbered lists in agent output', () => {
      const pane = [
        '⏺ Here is the plan:',
        '',
        '1. First, update the schema',
        '2. Then, run migrations',
        '3. Finally, update the API',
        '',
        '  esc to interrupt',
      ].join('\n')
      expect(detectPrompt(pane)).to.be.null
      expect(detectUnknownPrompt(pane)).to.be.false
    })

    it('should not match zsh prompt line with ❯ character', () => {
      const pane = [
        'Last command output',
        '~/workspace ❯',
      ].join('\n')
      expect(detectPrompt(pane)).to.be.null
      expect(detectUnknownPrompt(pane)).to.be.false
    })

    it('should not match ❯ in random prose text', () => {
      const pane = [
        'The arrow ❯ indicates the current selection.',
        'Use the up/down keys to navigate.',
      ].join('\n')
      expect(detectPrompt(pane)).to.be.null
      expect(detectUnknownPrompt(pane)).to.be.false
    })
  })

  // ===========================================================================
  // Integration-style test: simulated auto-dismiss flow
  // ===========================================================================
  describe('end-to-end prompt detection flow', () => {
    it('should detect and resolve the full Vercel telemetry auto-dismiss flow', () => {
      // Step 1: Detect the prompt
      const detection = detectPrompt(VERCEL_TELEMETRY_PANE)
      expect(detection).to.not.be.null

      // Step 2: Resolve the key to send
      const resolution = resolveKeyToSend(VERCEL_TELEMETRY_PANE, detection!.pattern)
      expect(resolution).to.not.be.null
      expect(resolution!.key).to.equal('2')
      expect(resolution!.optionText).to.equal('No thanks')

      // Step 3: Verify the pattern action is 'decline' (telemetry)
      expect(detection!.pattern.action).to.equal('decline')
    })

    it('should detect and resolve the full Claude permission auto-dismiss flow', () => {
      // Step 1: Detect the prompt
      const detection = detectPrompt(CLAUDE_PERMISSION_PANE)
      expect(detection).to.not.be.null

      // Step 2: Resolve the key to send
      const resolution = resolveKeyToSend(CLAUDE_PERMISSION_PANE, detection!.pattern)
      expect(resolution).to.not.be.null
      expect(resolution!.key).to.equal('2')
      expect(resolution!.optionText).to.equal('Yes, and always allow access to .claude/')

      // Step 3: Verify the pattern action is 'approve_always'
      expect(detection!.pattern.action).to.equal('approve_always')
    })

    it('should escalate unknown prompts without auto-answering', () => {
      // Known prompts should NOT be flagged as unknown
      expect(detectUnknownPrompt(VERCEL_TELEMETRY_PANE)).to.be.false
      expect(detectUnknownPrompt(CLAUDE_PERMISSION_PANE)).to.be.false

      // Unknown plugin prompt SHOULD be flagged
      expect(detectUnknownPrompt(UNKNOWN_PLUGIN_PROMPT)).to.be.true

      // But detectPrompt should NOT match it (no auto-answer)
      expect(detectPrompt(UNKNOWN_PLUGIN_PROMPT)).to.be.null
    })
  })
})
