import { Flags } from '@oclif/core'
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
  outputErrorAsJson,
} from '../../lib/prompt-json.js'
import {
  getWorkflowConfig,
  setWorkflowConfig,
  type WorkflowConfig,
  type WorkColumnType,
} from '../../lib/work-lifecycle/settings.js'

/**
 * Workflow intents that the user maps to board columns.
 * Order matters — this is the prompt order.
 */
const WORKFLOW_INTENTS: Array<{
  key: WorkColumnType
  label: string
  description: string
}> = [
  { key: 'planned', label: 'Ready for work', description: 'Tickets ready for an agent to pick up' },
  { key: 'in_progress', label: 'In progress', description: 'Tickets being actively worked on' },
  { key: 'review', label: 'In review', description: 'Tickets awaiting code review' },
  { key: 'done', label: 'Done', description: 'Tickets that are complete' },
  { key: 'backlog', label: 'Backlog', description: 'Tickets not yet scheduled' },
]

export default class ProjectConfigure extends PMOCommand {
  static description = 'Configure workflow column mapping for a project'

  static examples = [
    '<%= config.bin %> <%= command.id %> --workflow',
    '<%= config.bin %> <%= command.id %> --workflow --show',
  ]

  static flags = {
    ...pmoBaseFlags,
    workflow: Flags.boolean({
      char: 'w',
      description: 'Configure workflow column mapping',
      default: true,
    }),
    show: Flags.boolean({
      description: 'Show current workflow mapping without prompting',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ProjectConfigure)
    const jsonMode = shouldOutputJson(flags)

    const projectId = await this.requireProject({
      jsonMode: jsonMode
        ? { flags, commandName: 'project configure', baseCommand: 'prlt project configure' }
        : undefined,
    })

    // Get current board columns
    const board = await this.storage.getProjectBoard(projectId)
    if (!board) {
      if (jsonMode) {
        outputErrorAsJson('PROJECT_NOT_FOUND', 'Project not found.', createMetadata('project configure', flags))
        return
      }
      this.error('Project not found.')
    }

    const columns = board.columns.map((col) => col.name)
    if (columns.length === 0) {
      if (jsonMode) {
        outputErrorAsJson('NO_COLUMNS', 'No columns found on the board.', createMetadata('project configure', flags))
        return
      }
      this.error('No columns found on the board.')
    }

    if (!this.db) {
      if (jsonMode) {
        outputErrorAsJson('NO_DATABASE', 'No workspace database found.', createMetadata('project configure', flags))
        return
      }
      this.error('No workspace database found. Run "prlt new" first.')
    }

    // Read current config
    let currentConfig: WorkflowConfig
    try {
      currentConfig = getWorkflowConfig(this.db)
    } catch {
      currentConfig = {
        planned: 'Planned',
        in_progress: 'In Progress',
        review: 'Review',
        done: 'Done',
        backlog: 'Backlog',
      }
    }

    // Show-only mode
    if (flags.show) {
      if (jsonMode) {
        this.log(JSON.stringify({
          success: true,
          workflow: currentConfig,
          columns,
        }, null, 2))
        return
      }

      this.log(styles.emphasis('\nWorkflow Column Mapping:\n'))
      for (const intent of WORKFLOW_INTENTS) {
        const current = currentConfig[intent.key]
        const exists = columns.some((c) => c.toLowerCase() === current.toLowerCase())
        const status = exists ? styles.success('(exists)') : styles.warning('(not on board)')
        this.log(`  ${intent.label}: ${styles.emphasis(current)} ${status}`)
      }
      this.log('')
      return
    }

    // Interactive mapping
    if (!jsonMode) {
      this.log(styles.emphasis('\nWorkflow Column Mapping'))
      this.log(styles.muted('Map your board columns to workflow stages.\n'))
      this.log(styles.muted(`Board columns: ${columns.join(', ')}\n`))
    }

    const newConfig: Partial<WorkflowConfig> = {}

    for (const intent of WORKFLOW_INTENTS) {
      const message = `Which column means '${intent.label}'?`
      const choices = columns.map((col) => ({
        name: col === currentConfig[intent.key] ? `${col} (current)` : col,
        value: col,
      }))

      // Find the best default — current config value if it exists on the board, otherwise first column
      const defaultValue = columns.find((c) => c.toLowerCase() === currentConfig[intent.key].toLowerCase()) || columns[0]

      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('list', intent.key, message, choices, defaultValue),
          createMetadata('project configure', flags),
        )
        return
      }

      const selected = await this.selectFromList({
        message,
        items: choices,
        getName: (c) => c.name,
        getValue: (c) => c.value,
        getCommand: (c) => `prlt project configure -P ${projectId} --json`,
        jsonMode: null,
      })

      if (!selected) return
      newConfig[intent.key] = selected
    }

    // Save the config (db is guaranteed non-null at this point — guarded above)
    setWorkflowConfig(this.db!, newConfig)

    if (!jsonMode) {
      this.log(styles.success('\nWorkflow mapping saved.\n'))
      for (const intent of WORKFLOW_INTENTS) {
        const value = newConfig[intent.key]
        if (value) {
          this.log(`  ${intent.label}: ${styles.emphasis(value)}`)
        }
      }
      this.log('')
    } else {
      this.log(JSON.stringify({ success: true, workflow: newConfig }, null, 2))
    }
  }
}
