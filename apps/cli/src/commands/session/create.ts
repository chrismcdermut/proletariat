import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { styles } from '../../lib/styles.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SessionCreate extends PMOCommand {
  static description = 'Create a new tmux session'

  static examples = [
    '<%= config.bin %> <%= command.id %> my-session',
    '<%= config.bin %> <%= command.id %> my-session --command "npm run dev"',
    '<%= config.bin %> <%= command.id %> my-session --detach',
  ]

  static args = {
    name: Args.string({
      description: 'Name for the new tmux session',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    command: Flags.string({
      char: 'c',
      description: 'Initial command to run in the session',
    }),
    detach: Flags.boolean({
      char: 'd',
      description: 'Create session in detached mode (do not attach)',
      default: false,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(SessionCreate)
    const jsonMode = shouldOutputJson(flags)
    const sessionName = args.name

    // Check if tmux is available
    try {
      execSync('which tmux', { stdio: 'pipe' })
    } catch {
      if (jsonMode) {
        outputErrorAsJson('TMUX_NOT_FOUND', 'tmux is not installed or not in PATH.', createMetadata('session create', flags))
      }
      this.error('tmux is not installed or not in PATH.')
    }

    // Check if a session with this name already exists
    try {
      execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'pipe' })
      // If we get here, session exists
      if (jsonMode) {
        outputErrorAsJson('SESSION_EXISTS', `A tmux session named "${sessionName}" already exists.`, createMetadata('session create', flags))
      }
      this.error(`A tmux session named "${sessionName}" already exists.`)
    } catch {
      // Session doesn't exist, good to proceed
    }

    // Build the tmux new-session command
    const tmuxArgs: string[] = ['tmux', 'new-session']

    // Always use detached mode for creation, then attach if needed
    tmuxArgs.push('-d')
    tmuxArgs.push('-s', `"${sessionName}"`)

    if (flags.command) {
      tmuxArgs.push(`"${flags.command}"`)
    }

    try {
      execSync(tmuxArgs.join(' '), { stdio: 'pipe' })
    } catch (error) {
      const message = `Failed to create tmux session "${sessionName}": ${error instanceof Error ? error.message : error}`
      if (jsonMode) {
        outputErrorAsJson('CREATE_FAILED', message, createMetadata('session create', flags))
      }
      this.error(message)
    }

    if (jsonMode) {
      outputSuccessAsJson({
        sessionName,
        detached: flags.detach,
        command: flags.command || null,
      }, createMetadata('session create', flags))
    }

    this.log('')
    this.log(styles.success(`Created tmux session: ${sessionName}`))

    if (!flags.detach) {
      this.log(styles.info(`Attaching to session: ${sessionName}`))
      try {
        execSync(`tmux attach -d -t "${sessionName}"`, { stdio: 'inherit' })
      } catch {
        this.log(styles.muted(`Session "${sessionName}" is running in detached mode.`))
        this.log(styles.muted(`Attach with: tmux attach -t "${sessionName}"`))
      }
    } else {
      this.log(styles.muted(`Attach with: prlt session attach ${sessionName}`))
    }

    this.log('')
  }
}
