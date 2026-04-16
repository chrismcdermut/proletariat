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

/**
 * PRLT-1274 — defaults map must name real choice values.
 *
 * The defaults map is only useful if every entry maps to a value that the
 * corresponding prompt actually offers. Previously `prChoice` defaulted to
 * `'create'`/`'no-pr'` even though the real `prlt work start` prompt emits
 * `yes`/`no`, which caused walkPromptChain to fail with
 * `Prompt "prChoice" has no choice with value "create"` the first time a
 * real chain was walked in production.
 *
 * This block pins the valid choice values for every prompt the action
 * handlers can encounter and verifies the defaults map against them, plus a
 * scripted live-chain simulation that drives the real `prlt work start`
 * prompt sequence through walkPromptChain to verify the defaults walk
 * successfully end-to-end.
 *
 * When adding a new prompt to any prlt command that an orchestrate action
 * handler walks, add its valid values here and extend the defaults map in
 * lockstep.
 */
describe('DEFAULT_PROMPT_CHOICES value validity (PRLT-1274)', () => {
  // Authoritative list of valid choice values per prompt name, mirroring
  // the FlagResolver prompts in `apps/cli/src/commands/work/start.ts`,
  // `work/ship.ts`, and `ticket/move.ts`. FlagResolver stringifies all
  // choice values for JSON mode (see resolver.ts line 353), so booleans
  // appear here as the strings 'true'/'false'.
  const VALID_CHOICES: Record<string, ReadonlySet<string>> = {
    // work start — environment selection
    environment: new Set(['devcontainer', 'host', 'cancel']),
    // work start — display mode (FlagResolver path)
    display: new Set(['terminal', 'foreground', 'background']),
    // work start — display mode (legacy inquirer path, same values)
    selectedDisplay: new Set(['terminal', 'foreground', 'background']),
    // work start — permissions mode
    'permission-mode': new Set(['danger', 'safe']),
    // work start — GitHub token missing action
    tokenAction: new Set(['continue', 'cancel', 'host']),
    // work start — Docker daemon not running action
    dockerAction: new Set(['host', 'cancel']),
    // work start — auth method selection (oauth + apikey + escape hatches)
    authAction: new Set(['oauth', 'apikey', 'host', 'cancel']),
    // work start — save auth choice as workspace default (boolean → string)
    saveDefault: new Set(['true', 'false']),
    // work start — PR creation choice (yes/no, NOT create/no-pr — PRLT-1274)
    prChoice: new Set(['yes', 'no']),
    // work start — branch reuse choice (only fires in non-JSON path today,
    // but list it so defaults stay in sync if the JSON path grows it)
    branchChoice: new Set(['create', 'enter', 'search']),
    // work ship — merge method
    method: new Set(['merge', 'squash', 'rebase']),
    // work ship — delete source branch after merge (boolean → string)
    'delete-branch': new Set(['true', 'false']),
    // ticket move — target is free-form (resolveWorkflowTarget walks it),
    // but 'done' is always an accepted intent alias
    target: new Set(['done', 'review', 'in-progress', 'backlog']),
  }

  // Every concrete prompt default under every action entry must resolve to
  // a value in the matching VALID_CHOICES set.
  for (const [actionName, defaultsMap] of Object.entries(DEFAULT_PROMPT_CHOICES)) {
    describe(`${actionName}`, () => {
      for (const [promptName, value] of Object.entries(defaultsMap)) {
        it(`defaults prompt "${promptName}" to a real choice value`, () => {
          const valid = VALID_CHOICES[promptName]
          expect(
            valid,
            `No VALID_CHOICES entry for prompt "${promptName}" — if you added a new prompt to a prlt command, list its valid values in the test above and add a matching default in DEFAULT_PROMPT_CHOICES.`,
          ).to.not.be.undefined
          expect(
            valid!.has(value),
            `${actionName}.${promptName} default "${value}" is not in the real prompt's choices [${[...valid!].join(', ')}]. See PRLT-1274 — this exact mismatch took down live orchestrator runs once already.`,
          ).to.be.true
        })
      }
    })
  }

  it('walks the real `prlt work start` prompt chain successfully with spawn-agent defaults', () => {
    // This simulates the prompt sequence that a containerized `prlt work
    // start TKT-1` emits in JSON mode when Docker is running and credentials
    // are present: environment → permission-mode → prChoice → success.
    // If any default misses a choice value, walkPromptChain returns a
    // `no choice with value "X"` error and this test fails loudly.
    let i = 0
    const responses: ChainExecutorResult[] = [
      // Step 1: environment prompt
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'environment',
          message: 'Where should the agent run?',
          choices: [
            { value: 'devcontainer', command: 'prlt work start TKT-1 --environment devcontainer --json' },
            { value: 'host', command: 'prlt work start TKT-1 --run-on-host --json' },
            { value: 'cancel', command: '' },
          ],
        },
      }, 2),
      // Step 2: permission-mode prompt
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'permission-mode',
          message: 'Permission mode for claude:',
          choices: [
            { value: 'danger', command: 'prlt work start TKT-1 --environment devcontainer --permission-mode danger --json' },
            { value: 'safe', command: 'prlt work start TKT-1 --environment devcontainer --permission-mode safe --json' },
          ],
        },
      }, 2),
      // Step 3: prChoice prompt (the one PRLT-1274 was about)
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'prChoice',
          message: 'Create a pull request when work is ready?',
          choices: [
            { value: 'yes', command: 'prlt work start TKT-1 --environment devcontainer --permission-mode danger --create-pr --json' },
            { value: 'no', command: 'prlt work start TKT-1 --environment devcontainer --permission-mode danger --json' },
          ],
        },
      }, 2),
      // Step 4: terminal success
      jsonResult({ type: 'success', prompt: null, success: true, result: { workId: 'W1' } }),
    ]
    const calls: string[] = []
    const exec: ChainExecutor = (command) => {
      calls.push(command)
      if (i >= responses.length) {
        throw new Error(`no response for call ${i + 1} (cmd: ${command})`)
      }
      return responses[i++]
    }

    const result = walkPromptChain({
      baseCommand: 'prlt work start TKT-1',
      defaults: resolveActionDefaults('spawn-agent'),
      executor: exec,
    })

    expect(result.success).to.be.true
    expect(result.iterations).to.equal(4)
    // The chain must have walked through --create-pr, proving prChoice=yes
    // was selected and matched a real choice.
    expect(calls[3]).to.include('--create-pr')
  })

  it('walks the `spawn-review-agent` chain selecting no-PR via prChoice=no', () => {
    // Review agents set modifiesCode=false which would normally skip prChoice
    // entirely, but we guard the default anyway in case a future code path
    // re-emits the prompt for review-style actions.
    // PRLT-1316: `--action` was removed from the public CLI. Internal
    // orchestrator callers set the action via PRLT_INTERNAL_ACTION now, so
    // the follow-up commands emitted by work start no longer include it.
    let i = 0
    const responses: ChainExecutorResult[] = [
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
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'permission-mode',
          choices: [
            { value: 'danger', command: 'prlt work start TKT-1 --run-on-host --permission-mode danger --json' },
            { value: 'safe', command: 'prlt work start TKT-1 --run-on-host --permission-mode safe --json' },
          ],
        },
      }, 2),
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'prChoice',
          choices: [
            { value: 'yes', command: 'prlt work start TKT-1 --run-on-host --permission-mode safe --create-pr --json' },
            { value: 'no', command: 'prlt work start TKT-1 --run-on-host --permission-mode safe --json' },
          ],
        },
      }, 2),
      jsonResult({ type: 'success', prompt: null, success: true, result: {} }),
    ]
    const calls: string[] = []
    const exec: ChainExecutor = (command) => {
      calls.push(command)
      return responses[i++]
    }

    const result = walkPromptChain({
      baseCommand: 'prlt work start TKT-1',
      defaults: resolveActionDefaults('spawn-review-agent'),
      executor: exec,
    })

    expect(result.success).to.be.true
    // Review agents default to host, safe, no-PR
    expect(calls[1]).to.include('--run-on-host')
    expect(calls[2]).to.include('--permission-mode safe')
    // prChoice=no → no --create-pr in the final call
    expect(calls[3]).to.not.include('--create-pr')
  })

  it('emits a clear error if a prChoice default ever regresses to an invalid value', () => {
    // Regression harness: if someone flips prChoice back to 'create' in the
    // defaults map, the scripted chain fails with the exact production error
    // message observed in PRLT-1274.
    const exec: ChainExecutor = () =>
      jsonResult({
        type: 'prompt',
        prompt: {
          type: 'list',
          name: 'prChoice',
          choices: [
            { value: 'yes', command: 'prlt work start TKT-1 --create-pr --json' },
            { value: 'no', command: 'prlt work start TKT-1 --json' },
          ],
        },
      }, 2)

    const result = walkPromptChain({
      baseCommand: 'prlt work start TKT-1',
      defaults: { prChoice: 'create' }, // the old, broken default
      executor: exec,
    })

    expect(result.success).to.be.false
    expect(result.error).to.include('prChoice')
    expect(result.error).to.include('create')
    expect(result.error).to.include('yes, no')
  })
})
