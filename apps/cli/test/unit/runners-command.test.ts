import { expect } from 'chai'
import {
  buildExecutorCommandTemplate,
  buildExecutorShellCommand,
} from '../../src/lib/execution/runners.js'

describe('Runner Command Generation', () => {
  it('builds codex host command without Claude-only flags', () => {
    const command = buildExecutorShellCommand(
      'codex',
      'host',
      { type: 'shell', value: '"$(cat \\"$PROMPT_PATH\\")"' },
      'interactive',
      true
    )

    expect(command).to.contain('codex')
    expect(command).to.not.contain('--prompt')
    expect(command).to.not.contain('--permission-mode')
    expect(command).to.not.contain('--dangerously-skip-permissions')
  })

  it('uses codex exec for print mode', () => {
    const template = buildExecutorCommandTemplate('codex', 'docker', 'print', true)
    expect(template.cmd).to.equal('codex')
    expect(template.args).to.deep.equal(['exec'])
    expect(template.promptMode).to.equal('positional')
  })

  it('preserves Claude devcontainer trust bypass behavior', () => {
    const template = buildExecutorCommandTemplate('claude-code', 'devcontainer', 'interactive', true)
    expect(template.args).to.deep.equal(['--permission-mode', 'bypassPermissions'])
  })

  it('keeps Claude host mode free of devcontainer trust flag', () => {
    const template = buildExecutorCommandTemplate('claude-code', 'host', 'interactive', true)
    expect(template.args).to.not.include('--permission-mode')
    expect(template.args).to.not.include('bypassPermissions')
  })
})
