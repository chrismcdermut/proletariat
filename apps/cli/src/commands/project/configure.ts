import { Flags } from '@oclif/core'
import {
  PMOCommand,
  pmoBaseFlags,
} from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
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

/** Valid keys for the --set flag */
const VALID_SET_KEYS = new Set<string>(WORKFLOW_INTENTS.map((i) => i.key))

export default class ProjectConfigure extends PMOCommand {
  static description = 'Configure workflow column mapping for a project'

  static examples = [
    '<%= config.bin %> <%= command.id %> --workflow',
    '<%= config.bin %> <%= command.id %> --workflow --show',
    '<%= config.bin %> <%= command.id %> --set planned=Todo --set in_progress="In Progress"',
    '<%= config.bin %> <%= command.id %> --set review=Review --set done=Done --set backlog=Backlog',
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
    set: Flags.string({
      multiple: true,
      description: 'Set a workflow column mapping as key=value (e.g., --set planned=Todo). Valid keys: planned, in_progress, review, done, backlog',
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

    // Show-only mode — does not require board columns
    if (flags.show) {
      if (jsonMode) {
        outputSuccessAsJson({
          workflow: currentConfig,
        }, createMetadata('project configure', flags))
        return
      }

      this.log(styles.emphasis('\nWorkflow Column Mapping:\n'))
      for (const intent of WORKFLOW_INTENTS) {
        const current = currentConfig[intent.key]
        this.log(`  ${intent.label}: ${styles.emphasis(current)}`)
      }
      this.log('')
      return
    }

    // Non-interactive --set mode: parse key=value pairs and save directly
    // Does not require board column lookup — the user/agent provides exact values.
    if (flags.set && flags.set.length > 0) {
      const newConfig: Partial<WorkflowConfig> = {}

      for (const pair of flags.set) {
        const eqIndex = pair.indexOf('=')
        if (eqIndex === -1) {
          if (jsonMode) {
            outputErrorAsJson('INVALID_SET_FORMAT', `Invalid --set format: "${pair}". Expected key=value (e.g., --set planned=Todo)`, createMetadata('project configure', flags))
            return
          }
          this.error(`Invalid --set format: "${pair}". Expected key=value (e.g., --set planned=Todo)`)
        }

        const key = pair.substring(0, eqIndex)
        const value = pair.substring(eqIndex + 1)

        if (!VALID_SET_KEYS.has(key)) {
          if (jsonMode) {
            outputErrorAsJson('INVALID_SET_KEY', `Invalid workflow key: "${key}". Valid keys: ${[...VALID_SET_KEYS].join(', ')}`, createMetadata('project configure', flags))
            return
          }
          this.error(`Invalid workflow key: "${key}". Valid keys: ${[...VALID_SET_KEYS].join(', ')}`)
        }

        if (!value) {
          if (jsonMode) {
            outputErrorAsJson('EMPTY_SET_VALUE', `Empty value for key "${key}". Provide a column name.`, createMetadata('project configure', flags))
            return
          }
          this.error(`Empty value for key "${key}". Provide a column name.`)
        }

        newConfig[key as WorkColumnType] = value
      }

      setWorkflowConfig(this.db!, newConfig)

      if (jsonMode) {
        outputSuccessAsJson({ workflow: { ...currentConfig, ...newConfig } }, createMetadata('project configure', flags))
        return
      }

      this.log(styles.success('\nWorkflow mapping saved.\n'))
      const merged = { ...currentConfig, ...newConfig }
      for (const intent of WORKFLOW_INTENTS) {
        const val = merged[intent.key]
        const changed = newConfig[intent.key] ? styles.success(' (updated)') : ''
        this.log(`  ${intent.label}: ${styles.emphasis(val)}${changed}`)
      }
      this.log('')
      return
    }

    // Interactive mapping — needs board columns from provider
    let columns: string[]
    try {
      const board = await this.storage.getProjectBoard(projectId)
      columns = board ? board.columns.map((col) => col.name) : []
    } catch {
      // PRLT-1299: getProjectBoard may be dead if provider handles boards.
      // Fall back to current config values as the column list.
      columns = []
    }

    if (columns.length === 0) {
      // Fall back to current config values as column choices
      columns = [...new Set(Object.values(currentConfig))]
      if (columns.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_COLUMNS', 'No columns found. Use --set to configure workflow mappings directly (e.g., --set planned=Todo).', createMetadata('project configure', flags))
          return
        }
        this.error('No columns found. Use --set to configure workflow mappings directly (e.g., --set planned=Todo).')
      }
    }

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
        // Build accumulated --set flags from any already-resolved intents
        const accumulatedSets = Object.entries(newConfig)
          .map(([k, v]) => `--set ${k}=${v}`)
          .join(' ')
        const setPrefix = accumulatedSets ? `${accumulatedSets} ` : ''

        outputPromptAsJson(
          buildPromptConfig('list', intent.key, message, choices.map((c) => ({
            ...c,
            command: `prlt project configure -P ${projectId} ${setPrefix}--set ${intent.key}=${c.value} --json`,
          })), defaultValue),
          createMetadata('project configure', flags),
        )
        return
      }

      const selected = await this.selectFromList({
        message,
        items: choices,
        getName: (c) => c.name,
        getValue: (c) => c.value,
        getCommand: (_c) => `prlt project configure -P ${projectId} --json`,
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
      outputSuccessAsJson({ workflow: newConfig }, createMetadata('project configure', flags))
    }
  }
}
