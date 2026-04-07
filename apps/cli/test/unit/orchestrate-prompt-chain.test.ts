/**
 * Unit tests for walkPromptChain (PRLT-1268).
 *
 * walkPromptChain is the engine that lets action handlers drive prlt
 * commands non-interactively by walking JSON prompt responses.
 *
 * These tests inject a fake executor so we can deterministically simulate
 * prlt's JSON envelope responses without spawning real subprocesses.
 */

import { expect } from 'chai'
import {
  walkPromptChain,
  resolveActionDefaults,
  DEFAULT_PROMPT_CHOICES,
  type ChainExecutor,
  type ChainExecutorResult,
} from '../../src/lib/orchestrate/prompt-chain.js'

/**
 * Build a scripted executor that returns the next response in `responses`
 * each time it is called, capturing every command it received.
 */
function scriptedExecutor(responses: ChainExecutorResult[]): {
  exec: ChainExecutor
  calls: string[]
} {
  let i = 0
  const calls: string[] = []
  const exec: ChainExecutor = (command) => {
    calls.push(command)
    if (i >= responses.length) {
      throw new Error(`scriptedExecutor: no response for call ${i + 1} (cmd: ${command})`)
    }
    return responses[i++]
  }
  return { exec, calls }
}

/**
 * Helper to wrap a JSON envelope as a successful executor result.
 */
function jsonResult(envelope: object, status = 0): ChainExecutorResult {
  return {
    stdout: JSON.stringify(envelope, null, 2),
    stderr: '',
    status,
  }
}

describe('walkPromptChain', () => {
  describe('terminal responses', () => {
    it('returns success on first call when prlt emits type=success', () => {
      const { exec, calls } = scriptedExecutor([
        jsonResult({ type: 'success', prompt: null, success: true, result: { ok: 1 } }),
      ])
      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-1',
        defaults: {},
        executor: exec,
      })
      expect(result.success).to.be.true
      expect(result.iterations).to.equal(1)
      expect(result.result).to.deep.equal({ ok: 1 })
      // Helper appends --json automatically
      expect(calls[0]).to.equal('prlt work start TKT-1 --json')
    })

    it('returns success on type=execution_result (spawn results)', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'execution_result',
          result: { executions: [{ workId: 'W1', ticketId: 'TKT-1', agent: 'a', status: 'running' }] },
        }),
      ])
      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-1 --json',
        defaults: {},
        executor: exec,
      })
      expect(result.success).to.be.true
      expect(result.iterations).to.equal(1)
    })

    it('returns failure on type=error with the error code+message', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'error',
          error: { code: 'NO_TICKET', message: 'ticket not found' },
        }, 1),
      ])
      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-X',
        defaults: {},
        executor: exec,
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('NO_TICKET')
      expect(result.error).to.include('ticket not found')
    })

    it('returns failure on type=confirmation_needed (handler must opt in)', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'confirmation_needed',
          plan: {},
          confirm_command: 'prlt foo --yes',
          message: 'confirm please',
        }, 2),
      ])
      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: {},
        executor: exec,
      })
      expect(result.success).to.be.false
      expect(result.error).to.include('confirmation_needed')
    })
  })

  describe('walking prompt chains', () => {
    it('walks a single prompt by picking the configured default', () => {
      const { exec, calls } = scriptedExecutor([
        // Call 1: emits a prompt asking for environment
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'environment',
            message: 'Where should the agent run?',
            choices: [
              {
                name: 'devcontainer',
                value: 'devcontainer',
                command: 'prlt work start TKT-1 --environment devcontainer --json',
              },
              {
                name: 'host',
                value: 'host',
                command: 'prlt work start TKT-1 --run-on-host --json',
              },
            ],
          },
        }, 2),
        // Call 2: chained command, returns success
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-1',
        defaults: { environment: 'devcontainer' },
        executor: exec,
      })

      expect(result.success).to.be.true
      expect(result.iterations).to.equal(2)
      expect(calls).to.have.length(2)
      expect(calls[0]).to.equal('prlt work start TKT-1 --json')
      expect(calls[1]).to.equal('prlt work start TKT-1 --environment devcontainer --json')
    })

    it('walks multiple chained prompts (environment then display)', () => {
      const { exec, calls } = scriptedExecutor([
        // Step 1: environment prompt
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'environment',
            choices: [
              { value: 'devcontainer', command: 'prlt work start TKT-1 --environment devcontainer --json' },
              { value: 'host', command: 'prlt work start TKT-1 --run-on-host --json' },
            ],
          },
        }, 2),
        // Step 2: display prompt
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'display',
            choices: [
              { value: 'terminal', command: 'prlt work start TKT-1 --environment devcontainer --display terminal --json' },
              { value: 'background', command: 'prlt work start TKT-1 --environment devcontainer --display background --json' },
            ],
          },
        }, 2),
        // Step 3: success
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-1',
        defaults: { environment: 'devcontainer', display: 'background' },
        executor: exec,
      })

      expect(result.success).to.be.true
      expect(result.iterations).to.equal(3)
      expect(calls).to.have.length(3)
      expect(calls[2]).to.include('--display background')
      expect(result.commandTrail).to.deep.equal(calls)
    })

    it('uses default values to pick from prompts the operator did not predict', () => {
      // Demonstrates the configurability requirement: a hook can override
      // defaults to pick a non-default choice.
      const { exec, calls } = scriptedExecutor([
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'environment',
            choices: [
              { value: 'devcontainer', command: 'prlt work start TKT-1 --environment devcontainer --json' },
              { value: 'host', command: 'prlt work start TKT-1 --run-on-host --json' },
            ],
          },
        }, 2),
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt work start TKT-1',
        defaults: { environment: 'host' }, // override the built-in default
        executor: exec,
      })

      expect(result.success).to.be.true
      expect(calls[1]).to.equal('prlt work start TKT-1 --run-on-host --json')
    })
  })

  describe('failure modes', () => {
    it('fails when prompt name has no entry in defaults map', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'mystery-prompt',
            choices: [{ value: 'a', command: 'prlt foo --a --json' }],
          },
        }, 2),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: { something: 'else' },
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('mystery-prompt')
      expect(result.error).to.include('No default')
    })

    it('fails when default value matches no choice', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'environment',
            choices: [
              { value: 'devcontainer', command: 'prlt foo --devcontainer --json' },
              { value: 'host', command: 'prlt foo --host --json' },
            ],
          },
        }, 2),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: { environment: 'kubernetes' },
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('environment')
      expect(result.error).to.include('kubernetes')
      expect(result.error).to.include('Available')
    })

    it('fails when chosen choice is missing the command field', () => {
      const { exec } = scriptedExecutor([
        jsonResult({
          type: 'prompt',
          prompt: {
            type: 'list',
            name: 'environment',
            choices: [
              { value: 'devcontainer' }, // no command field
            ],
          },
        }, 2),
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: { environment: 'devcontainer' },
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('command')
    })

    it('fails when stdout is not parseable JSON', () => {
      const { exec } = scriptedExecutor([
        { stdout: 'this is not JSON', stderr: 'syntax error somewhere', status: 1 },
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: {},
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('did not emit a JSON envelope')
    })

    it('fails when spawn returns an exec error with empty stdout', () => {
      const { exec } = scriptedExecutor([
        { stdout: '', stderr: '', status: -1, error: 'ENOENT: prlt not found' },
      ])

      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: {},
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('ENOENT')
    })

    it('respects maxIterations to prevent infinite loops', () => {
      // Build an executor that always emits the same prompt (would loop forever)
      const loopResp: ChainExecutorResult = jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'env',
          choices: [{ value: 'a', command: 'prlt loop --json' }],
        },
      }, 2)
      const exec: ChainExecutor = () => loopResp

      const result = walkPromptChain({
        baseCommand: 'prlt loop',
        defaults: { env: 'a' },
        maxIterations: 4,
        executor: exec,
      })

      expect(result.success).to.be.false
      expect(result.error).to.include('Exceeded max iterations')
      expect(result.iterations).to.equal(4)
    })
  })

  describe('--json flag handling', () => {
    it('appends --json to base command if not present', () => {
      const { exec, calls } = scriptedExecutor([
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])
      walkPromptChain({
        baseCommand: 'prlt foo bar',
        defaults: {},
        executor: exec,
      })
      expect(calls[0]).to.equal('prlt foo bar --json')
    })

    it('does not double-append --json when already present', () => {
      const { exec, calls } = scriptedExecutor([
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])
      walkPromptChain({
        baseCommand: 'prlt foo --json',
        defaults: {},
        executor: exec,
      })
      expect(calls[0]).to.equal('prlt foo --json')
    })

    it('does not match --jsonish or other flag prefixes', () => {
      const { exec, calls } = scriptedExecutor([
        jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
      ])
      walkPromptChain({
        baseCommand: 'prlt foo --jsonish',
        defaults: {},
        executor: exec,
      })
      expect(calls[0]).to.equal('prlt foo --jsonish --json')
    })
  })

  describe('JSON parsing tolerance', () => {
    it('parses JSON when there is leading log output', () => {
      const stdout = [
        '[debug] starting prlt',
        '[debug] resolving ticket',
        JSON.stringify({ type: 'success', prompt: null, success: true, result: { id: 1 } }),
      ].join('\n')

      const { exec } = scriptedExecutor([{ stdout, stderr: '', status: 0 }])
      const result = walkPromptChain({
        baseCommand: 'prlt foo',
        defaults: {},
        executor: exec,
      })
      expect(result.success).to.be.true
      expect(result.result).to.deep.equal({ id: 1 })
    })
  })
})

describe('resolveActionDefaults', () => {
  it('returns built-in defaults when no config is provided', () => {
    const defaults = resolveActionDefaults('spawn-agent')
    expect(defaults.environment).to.equal('devcontainer')
    expect(defaults.display).to.equal('background')
  })

  it('shallow-merges hook config defaults over built-ins', () => {
    const defaults = resolveActionDefaults('spawn-agent', {
      defaults: { environment: 'host', 'permission-mode': 'safe' },
    })
    expect(defaults.environment).to.equal('host')
    expect(defaults['permission-mode']).to.equal('safe')
    // Untouched keys keep the built-in default
    expect(defaults.display).to.equal('background')
  })

  it('passes through unknown override keys verbatim', () => {
    const defaults = resolveActionDefaults('spawn-agent', {
      defaults: { 'custom-future-prompt': 'foo' },
    })
    expect(defaults['custom-future-prompt']).to.equal('foo')
    // Built-in keys still present
    expect(defaults.environment).to.equal('devcontainer')
  })

  it('spawn-review-agent defaults to host environment for speed', () => {
    const defaults = resolveActionDefaults('spawn-review-agent')
    expect(defaults.environment).to.equal('host')
    expect(defaults['permission-mode']).to.equal('safe')
  })

  it('merge-pr defaults to squash + delete-branch=true', () => {
    const defaults = resolveActionDefaults('merge-pr')
    expect(defaults.method).to.equal('squash')
    expect(defaults['delete-branch']).to.equal('true')
  })

  it('move-ticket defaults target to done', () => {
    const defaults = resolveActionDefaults('move-ticket')
    expect(defaults.target).to.equal('done')
  })

  it('exposes DEFAULT_PROMPT_CHOICES as a static map for documentation/tests', () => {
    expect(DEFAULT_PROMPT_CHOICES).to.have.all.keys(
      'spawn-agent',
      'spawn-review-agent',
      'spawn-fix-agent',
      'resolve-conflict',
      'merge-pr',
      'move-ticket',
    )
  })
})
