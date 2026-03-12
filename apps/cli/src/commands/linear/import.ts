import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'
import {
  LinearClient,
  isLinearConfigured,
  loadLinearConfig,
  LinearMapper,
} from '../../lib/linear/index.js'
import type { LinearIssue, LinearIssueFilter } from '../../lib/linear/types.js'

export default class LinearImport extends PMOCommand {
  static description = 'Import Linear issues into PMO as tickets'

  static strict = false  // Allow variadic issue identifier args

  static examples = [
    '<%= config.bin %> <%= command.id %>                           # Interactive: select team and issues',
    '<%= config.bin %> <%= command.id %> ENG-123 ENG-124           # Import specific issues by identifier',
    '<%= config.bin %> <%= command.id %> --team ENG                # Import from a specific team',
    '<%= config.bin %> <%= command.id %> --team ENG --state "In Progress"  # Filter by state',
    '<%= config.bin %> <%= command.id %> --team ENG --label bug    # Filter by label',
    '<%= config.bin %> <%= command.id %> --limit 20 --json         # Import up to 20 issues, JSON output',
  ]

  static flags = {
    ...pmoBaseFlags,
    team: Flags.string({
      char: 't',
      description: 'Linear team key (e.g., ENG)',
    }),
    state: Flags.string({
      description: 'Filter by Linear state name (e.g., "In Progress", "Backlog")',
    }),
    'state-type': Flags.string({
      description: 'Filter by Linear state type',
      options: ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'],
    }),
    label: Flags.string({
      description: 'Filter by Linear label name',
    }),
    assignee: Flags.string({
      description: 'Filter by assignee name or "me"',
    }),
    cycle: Flags.string({
      description: 'Filter by cycle ID',
    }),
    limit: Flags.integer({
      char: 'n',
      description: 'Maximum number of issues to import',
      default: 50,
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Import all matching issues without interactive selection',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview issues that would be imported without creating tickets',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(LinearImport)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    // Check Linear is configured
    if (!isLinearConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('LINEAR_NOT_CONFIGURED', 'Linear is not configured. Run "prlt linear connect" first.', createMetadata('linear import', flags))
        this.exit(1)
      }
      this.error('Linear is not configured. Run "prlt linear connect" first.')
    }

    const config = loadLinearConfig(db)!
    const client = new LinearClient(config.apiKey)
    const mapper = new LinearMapper(db)

    // Parse explicit issue identifiers from args
    const issueIdentifiers = argv as string[]

    // Get project for import
    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'linear import',
        baseCommand: `${this.config.bin} linear import`,
      } : undefined,
    })

    // Get the project's workflow statuses for mapping
    const workflow = await this.storage.getProjectWorkflow(projectId)
    if (!workflow) {
      if (jsonMode) {
        outputErrorAsJson('NO_WORKFLOW', 'Project has no workflow configured.', createMetadata('linear import', flags))
        this.exit(1)
      }
      this.error('Project has no workflow configured.')
    }
    const statuses = await this.storage.listStatuses(workflow.id)

    let issues: LinearIssue[]

    if (issueIdentifiers.length > 0) {
      // Fetch specific issues by identifier
      this.log(colors.textMuted(`Fetching ${issueIdentifiers.length} issue(s) from Linear...`))
      issues = []
      for (const id of issueIdentifiers) {
        // eslint-disable-next-line no-await-in-loop
        const issue = await client.getIssueByIdentifier(id)
        if (issue) {
          issues.push(issue)
        } else {
          this.log(colors.warning(`Issue not found: ${id}`))
        }
      }
    } else {
      // Build filter from flags
      const filter: LinearIssueFilter = {
        teamKey: flags.team ?? config.defaultTeamKey,
        stateName: flags.state,
        stateType: flags['state-type'],
        labelName: flags.label,
        assigneeMe: flags.assignee?.toLowerCase() === 'me' ? true : undefined,
        assigneeId: flags.assignee && flags.assignee.toLowerCase() !== 'me' ? flags.assignee : undefined,
        cycleId: flags.cycle,
        limit: flags.limit,
      }

      // If no team specified and no default, prompt
      if (!filter.teamKey && !filter.teamId) {
        const teams = await client.listTeams()
        if (teams.length === 0) {
          if (jsonMode) {
            outputErrorAsJson('NO_TEAMS', 'No teams found in your Linear workspace.', createMetadata('linear import', flags))
            this.exit(1)
          }
          this.error('No teams found in your Linear workspace.')
        }

        if (teams.length === 1) {
          filter.teamKey = teams[0].key
        } else {
          if (jsonMode) {
            const teamChoices = teams.map((t) => ({
              name: `${t.name} (${t.key})`,
              value: t.key,
            }))
            outputPromptAsJson(
              buildPromptConfig('list', 'teamKey', 'Select a team to import from:', teamChoices),
              createMetadata('linear import', flags),
            )
          }

          const teamChoices = teams.map((t) => ({
            name: `${t.name} (${t.key})`,
            value: t.key,
          }))

          const { teamKey } = await inquirer.prompt([{
            type: 'list',
            name: 'teamKey',
            message: 'Select a team to import from:',
            choices: teamChoices,
          }])
          filter.teamKey = teamKey
        }
      }

      this.log(colors.textMuted(`Fetching issues from Linear (team: ${filter.teamKey})...`))
      issues = await client.listIssues(filter)
    }

    if (issues.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          imported: 0,
          message: 'No matching issues found.',
        }, createMetadata('linear import', flags))
        return
      }
      this.log(colors.warning('No matching issues found.'))
      return
    }

    // Categorize issues by import status for display
    const newIssues: LinearIssue[] = []
    const alreadyImported: LinearIssue[] = []

    for (const issue of issues) {
      const existing = mapper.getByLinearId(issue.id)
      if (existing) {
        alreadyImported.push(issue)
      } else {
        newIssues.push(issue)
      }
    }

    // Interactive selection (unless --all or explicit IDs)
    // All issues are eligible since importIssue is idempotent (creates or updates)
    let selectedIssues = issues
    if (!flags.all && issueIdentifiers.length === 0 && !jsonMode) {
      const issueChoices = issues.map((issue) => {
        const isExisting = alreadyImported.includes(issue)
        const tag = isExisting ? ' [update]' : ' [new]'
        return {
          name: `${issue.identifier}  ${issue.title}  [${issue.state.name}]  ${issue.priority > 0 ? `P${issue.priority - 1}` : ''}${tag}`,
          value: issue.id,
          checked: !isExisting,  // Pre-select new issues, not existing ones
        }
      })

      const { selectedIds } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIds',
        message: `Select issues to import/update (${newIssues.length} new, ${alreadyImported.length} existing):`,
        choices: issueChoices,
      }])

      selectedIssues = issues.filter((i) => (selectedIds as string[]).includes(i.id))
    }

    if (selectedIssues.length === 0) {
      this.log(colors.textMuted('No issues selected.'))
      return
    }

    // Dry run mode
    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          wouldImport: selectedIssues.map((i) => {
            const existing = mapper.getByLinearId(i.id)
            return {
              identifier: i.identifier,
              title: i.title,
              state: i.state.name,
              priority: i.priority,
              action: existing ? 'update' : 'create',
            }
          }),
        }, createMetadata('linear import', flags))
        return
      }

      this.log('')
      this.log(colors.primary('Dry run - would import/update:'))
      for (const issue of selectedIssues) {
        const existing = mapper.getByLinearId(issue.id)
        const action = existing ? 'update' : 'create'
        this.log(`  ${colors.textSecondary(issue.identifier)}  ${issue.title}  (${action})`)
      }
      this.log('')
      this.log(colors.textMuted(`${selectedIssues.length} issue(s) would be processed.`))
      return
    }

    // Import issues
    this.log('')
    this.log(colors.textMuted(`Importing ${selectedIssues.length} issue(s)...`))

    const result = await mapper.importIssues(selectedIssues, projectId, this.storage, statuses)

    if (jsonMode) {
      outputSuccessAsJson({
        imported: result.imported,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      }, createMetadata('linear import', flags))
      return
    }

    this.log('')
    if (result.imported > 0) {
      this.log(colors.success(`Imported ${result.imported} issue(s) into PMO`))
    }
    if (result.updated > 0) {
      this.log(colors.success(`Updated ${result.updated} issue(s) from Linear`))
    }
    if (result.skipped > 0) {
      this.log(colors.textMuted(`  Skipped ${result.skipped} (unchanged)`))
    }
    if (result.errors.length > 0) {
      this.log(colors.error(`  ${result.errors.length} error(s):`))
      for (const err of result.errors) {
        this.log(colors.textMuted(`    ${err.identifier}: ${err.error}`))
      }
    }
  }
}
