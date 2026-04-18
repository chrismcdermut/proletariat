import { expect } from 'chai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * PRLT-313: Validates that multi-value boolean flags have been converted
 * to option flags with backward-compatible deprecated aliases.
 *
 * Each conversion follows this pattern:
 * 1. New option flag exists with valid options
 * 2. Old boolean flag exists but is hidden (deprecated)
 * 3. Resolution logic maps old → new and new → old for downstream compat
 */
describe('PRLT-313: multi-value boolean → option flag conversions', () => {
  const commandsDir = path.resolve(__dirname, '../../src/commands')

  /**
   * Helper: read command source and check for flag definition patterns.
   * We parse the TypeScript source rather than importing the command
   * to avoid needing the full runtime.
   */
  function readCommandSource(relativePath: string): string {
    const fullPath = path.resolve(commandsDir, relativePath)
    return fs.readFileSync(fullPath, 'utf-8')
  }

  function hasOptionFlag(source: string, flagName: string, options: string[]): boolean {
    // Match: flagName: Flags.string({ ... options: [...] ... })
    // Use (?:^|[^a-zA-Z-]) to ensure we match the exact flag name, not a suffix
    const escapedName = flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(?:^|[^a-zA-Z-])['"]?${escapedName}['"]?:\\s*Flags\\.string\\(\\{[\\s\\S]*?options:\\s*\\[([^\\]]+)\\]`,
    )
    const match = source.match(pattern)
    if (!match) return false
    const foundOptions = match[1].split(',').map((s) => s.trim().replace(/['"]/g, ''))
    return options.every((opt) => foundOptions.includes(opt))
  }

  function hasDeprecatedBooleanFlag(source: string, flagName: string): boolean {
    const escapedName = flagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `['"]?${escapedName}['"]?:\\s*Flags\\.boolean\\(\\{[\\s\\S]*?hidden:\\s*true`,
    )
    return pattern.test(source)
  }

  function hasResolutionLogic(source: string, oldFlag: string, newFlag: string): boolean {
    // Check that the resolution block maps old → new using either dot or bracket notation
    const hasBracketOld = source.includes(`flags['${oldFlag}']`)
    const hasDotOld = source.includes(`flags.${oldFlag}`)
    const hasBracketNew = source.includes(`flags['${newFlag}']`)
    const hasDotNew = source.includes(`flags.${newFlag}`)
    return (hasBracketOld || hasDotOld) && (hasBracketNew || hasDotNew)
  }

  // =========================================================================
  // --run-on-host → --environment host|docker|auto
  // =========================================================================
  describe('--run-on-host → --environment', () => {
    const commandsWithRunOnHost = [
      'work/start.ts',
      'work/spawn.ts',
      'work/asana.ts',
      'work/jira.ts',
      'work/shortcut.ts',
      'work/linear.ts',
      'orchestrator/start.ts',
    ]

    for (const cmd of commandsWithRunOnHost) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --environment option flag with host|docker|auto', () => {
          expect(hasOptionFlag(source, 'environment', ['host', 'docker', 'auto'])).to.equal(
            true,
            `${cmd} should have --environment with host, docker, auto options`,
          )
        })

        it('has --run-on-host as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'run-on-host')).to.equal(
            true,
            `${cmd} should have --run-on-host as hidden deprecated boolean`,
          )
        })

        it('has resolution logic mapping old → new', () => {
          expect(hasResolutionLogic(source, 'run-on-host', 'environment')).to.equal(
            true,
            `${cmd} should have resolution logic for run-on-host → environment`,
          )
        })
      })
    }
  })

  // =========================================================================
  // --create-pr / --no-pr → --pr create|skip
  // =========================================================================
  describe('--create-pr/--no-pr → --pr', () => {
    const commandsWithCreatePr = [
      'work/start.ts',
      'work/spawn.ts',
      'work/run.ts',
      'work/asana.ts',
      'work/jira.ts',
      'work/shortcut.ts',
      'work/linear.ts',
      'work/watch.ts',
    ]

    for (const cmd of commandsWithCreatePr) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --pr option flag with create|skip', () => {
          expect(hasOptionFlag(source, 'pr', ['create', 'skip'])).to.equal(
            true,
            `${cmd} should have --pr with create, skip options`,
          )
        })

        it('has --create-pr as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'create-pr')).to.equal(
            true,
            `${cmd} should have --create-pr as hidden deprecated boolean`,
          )
        })
      })
    }

    it('work/ready.ts has --pr with create|skip|draft options', () => {
      const source = readCommandSource('work/ready.ts')
      expect(hasOptionFlag(source, 'pr', ['create', 'skip', 'draft'])).to.equal(true)
    })

    it('work/ready.ts has --no-pr and --draft-pr as deprecated', () => {
      const source = readCommandSource('work/ready.ts')
      expect(hasDeprecatedBooleanFlag(source, 'no-pr')).to.equal(true)
      expect(hasDeprecatedBooleanFlag(source, 'draft-pr')).to.equal(true)
    })
  })

  // =========================================================================
  // --skip-permissions → --permissions skip|ask
  // =========================================================================
  describe('--skip-permissions → --permissions', () => {
    const commandsWithSkipPerms = [
      'work/start.ts',
      'work/spawn.ts',
      'work/asana.ts',
      'work/jira.ts',
      'work/shortcut.ts',
      'work/linear.ts',
      'work/watch.ts',
      'orchestrator/start.ts',
    ]

    for (const cmd of commandsWithSkipPerms) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --permissions option flag with skip|ask', () => {
          expect(hasOptionFlag(source, 'permissions', ['skip', 'ask'])).to.equal(
            true,
            `${cmd} should have --permissions with skip, ask options`,
          )
        })

        it('has --skip-permissions as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'skip-permissions')).to.equal(
            true,
            `${cmd} should have --skip-permissions as hidden deprecated boolean`,
          )
        })
      })
    }
  })

  // =========================================================================
  // --foreground → --mode foreground|daemon
  // =========================================================================
  describe('--foreground → --mode', () => {
    const commandsWithForeground = [
      'orchestrator/start.ts',
      'orchestrate/machine.ts',
    ]

    for (const cmd of commandsWithForeground) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --mode option flag with foreground|daemon', () => {
          expect(hasOptionFlag(source, 'mode', ['foreground', 'daemon'])).to.equal(
            true,
            `${cmd} should have --mode with foreground, daemon options`,
          )
        })

        it('has --foreground as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'foreground')).to.equal(
            true,
            `${cmd} should have --foreground as hidden deprecated boolean`,
          )
        })
      })
    }
  })

  // =========================================================================
  // --ephemeral → --lifetime ephemeral|persistent
  // =========================================================================
  describe('--ephemeral → --lifetime', () => {
    it('work/start.ts has --lifetime option flag with ephemeral|persistent', () => {
      const source = readCommandSource('work/start.ts')
      expect(hasOptionFlag(source, 'lifetime', ['ephemeral', 'persistent'])).to.equal(true)
    })

    it('work/start.ts has --ephemeral as deprecated hidden flag', () => {
      const source = readCommandSource('work/start.ts')
      expect(hasDeprecatedBooleanFlag(source, 'ephemeral')).to.equal(true)
    })

    it('work/start.ts has resolution logic', () => {
      const source = readCommandSource('work/start.ts')
      expect(hasResolutionLogic(source, 'ephemeral', 'lifetime')).to.equal(true)
    })
  })

  // =========================================================================
  // --clone → --workspace clone|worktree
  // =========================================================================
  describe('--clone → --workspace', () => {
    const commandsWithClone = [
      'work/start.ts',
      'work/spawn.ts',
      'agent/staff/add.ts',
    ]

    for (const cmd of commandsWithClone) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --workspace option flag with clone|worktree', () => {
          expect(hasOptionFlag(source, 'workspace', ['clone', 'worktree'])).to.equal(
            true,
            `${cmd} should have --workspace with clone, worktree options`,
          )
        })

        it('has --clone as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'clone')).to.equal(
            true,
            `${cmd} should have --clone as hidden deprecated boolean`,
          )
        })
      })
    }
  })

  // =========================================================================
  // --once → --run-mode once|continuous (watch commands)
  // =========================================================================
  describe('--once → --run-mode', () => {
    const watchCommands = [
      'watch/index.ts',
      'work/watch.ts',
      'session/watch.ts',
    ]

    for (const cmd of watchCommands) {
      describe(cmd, () => {
        let source: string
        before(() => { source = readCommandSource(cmd) })

        it('has --run-mode option flag with once|continuous', () => {
          expect(hasOptionFlag(source, 'run-mode', ['once', 'continuous'])).to.equal(
            true,
            `${cmd} should have --run-mode with once, continuous options`,
          )
        })

        it('has --once as deprecated hidden flag', () => {
          expect(hasDeprecatedBooleanFlag(source, 'once')).to.equal(
            true,
            `${cmd} should have --once as hidden deprecated boolean`,
          )
        })
      })
    }
  })

  // =========================================================================
  // Standard booleans left alone
  // =========================================================================
  describe('standard booleans are NOT converted', () => {
    const startSource = readCommandSource('work/start.ts')

    for (const flag of ['yes', 'force', 'dry-run']) {
      it(`--${flag} remains a non-hidden boolean`, () => {
        const escapedName = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = new RegExp(
          `['"]?${escapedName}['"]?:\\s*Flags\\.boolean\\(\\{[^}]*\\}`,
          's',
        )
        const match = startSource.match(pattern)
        expect(match, `--${flag} should exist as a boolean flag`).to.not.be.null
        if (match) {
          expect(match[0]).to.not.include('hidden: true', `--${flag} should NOT be hidden`)
        }
      })
    }
  })
})
