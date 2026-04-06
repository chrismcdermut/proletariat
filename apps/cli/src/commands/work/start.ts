/* eslint-disable max-lines -- large command with many execution paths */
import { Args, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags, autoExportToBoard, type Ticket } from '../../lib/pmo/index.js'
import { trackAgentSpawned, trackPrimitiveExecuted } from '../../lib/telemetry/analytics.js'
import { enrichAgentSession } from '../../lib/telemetry/telemetry-bridge.js'
import { registerAgent } from '../../lib/registry/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
  outputConfirmationNeededAsJson,
  outputExecutionResultAsJson,
} from '../../lib/prompt-json.js'
import { FlagResolver } from '../../lib/flags/index.js'
import { getWorkColumnSetting, findColumnByName, resolveReviewGate, isValidReviewGateMode } from '../../lib/work-lifecycle/settings.js'
import { moveTicketByIntent } from '../../lib/work-lifecycle/transition.js'
import { getTicketExternalMetadata, resolveExternalTicketId } from '../../lib/external-issues/utils.js'
import type { ReviewGateMode } from '../../lib/pmo/types.js'
import { WorkAction } from '../../lib/pmo/types.js'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
  createEphemeralAgent,
  getTicketTmuxSession,
  killTmuxSession,
  findWorktreeForBranch,
  WorkspaceInfo,
  resolveAgentDir,
} from '../../lib/agents/commands.js'
import { Agent, openWorkspaceDatabase } from '../../lib/database/index.js'
import {
  DisplayMode,
  SessionManager,
  OutputMode,
  ExecutorType,
  ExecutionContext,
  ExecutionEnvironment,
  TerminalApp,
  Shell,
  PermissionMode,
  CleanupPolicy,
  generateBranchName,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js'
import { runExecution, isDockerRunning, isGitHubTokenAvailable, isDevcontainerCliInstalled, dockerCredentialsExist, getDockerCredentialInfo, isClaudeExecutor, getExecutorDisplayName } from '../../lib/execution/runners.js'
import { ExecutionStorage, ContainerStorage } from '../../lib/execution/storage.js'
import { loadExecutionConfig, getTerminalApp, promptTerminalPreference, getShell, promptShellPreference, hasTerminalPreference, hasShellPreference, getAuthMethod, saveAuthMethod, getCreatePrDefault, getVerifyCiDefault, getMirrorToPmoDefault, getCleanupPolicy } from '../../lib/execution/config.js'
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js'
import { detectRepoWorktrees, resolveWorktreePath, buildWorkspaceRepos } from '../../lib/execution/context.js'
import { isGHInstalled, isGHAuthenticated } from '../../lib/pr/index.js'
import {
  buildLinearMetadata,
  buildLinearSpawnContextMessage,
  buildLinearTicketDescription,
  getLinearIssueByIdentifier,
} from '../../lib/external-issues/linear.js'
import {
  buildJiraMetadata,
  buildJiraSpawnContextMessage,
  buildJiraTicketDescription,
  getJiraIssueByKey,
} from '../../lib/external-issues/jira.js'
import {
  buildAsanaMetadata,
  buildAsanaSpawnContextMessage,
  buildAsanaTicketDescription,
  getAsanaTaskByGid,
} from '../../lib/external-issues/asana.js'
import {
  buildShortcutMetadata,
  buildShortcutSpawnContextMessage,
  buildShortcutTicketDescription,
  getShortcutStoryByKey,
} from '../../lib/external-issues/shortcut.js'
import {
  buildTrelloMetadata,
  buildTrelloSpawnContextMessage,
  buildTrelloTicketDescription,
  getTrelloCardById,
} from '../../lib/external-issues/trello.js'
import { resolveMirrorToPmo } from '../../lib/external-issues/work-start.js'
import { buildTicketFromEnvelope } from '../../lib/external-issues/ticket-builder.js'
import { TicketRefStore } from '../../lib/execution/ticket-refs.js'
import { getLinearApiKey, loadLinearConfig } from '../../lib/linear/config.js'
import { LinearMapper } from '../../lib/linear/mapper.js'
import { ExternalIssueAdapterError, type IssueSource, type NormalizedIssueEnvelope } from '../../lib/external-issues/types.js'
import {
  parseWorkSourceRef,
  formatWorkSourceRef,
  loadDefaultWorkSource,
  getRegisteredWorkSources,
  getConnectedIntegrations,
  isLocalTicketId,
} from '../../lib/work-source/index.js'
import { pruneWorktrees, checkoutBranchSafe } from '../../lib/branch/index.js'
import { handlePostExecutionTransition } from '../../lib/work-lifecycle/index.js'
import { runPreflightChecks, formatPreflightReport } from '../../lib/execution/preflight.js'

/**
 * Try to execute a git command, return true if successful
 */
function tryGitCommand(cmd: string, cwd: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false /* git command failed — caller uses boolean to branch logic */
  }
}

/**
 * Check if a directory is a git repository
 */
function isGitRepo(dir: string): boolean {
  return tryGitCommand('git rev-parse --git-dir', dir)
}

/**
 * Find the first existing branch from a list of candidates
 */
function findBaseBranch(repoPath: string, candidates: string[] = ['origin/main', 'origin/master']): string {
  for (const branch of candidates) {
    if (tryGitCommand(`git rev-parse --verify ${branch}`, repoPath)) {
      return branch
    }
  }
  return 'HEAD'
}

/**
 * Get active staff agents that exist on disk.
 * Warns about any agents in DB that are missing their directory.
 */
function getActiveStaffAgents(
  workspaceInfo: WorkspaceInfo,
  log: (msg: string) => void
): Agent[] {
  const result: Agent[] = []

  for (const agent of workspaceInfo.agents) {
    if (agent.type !== 'persistent' || agent.status !== 'active') continue

    const agentDir = agent.worktree_path
      ? path.join(workspaceInfo.path, agent.worktree_path)
      : path.join(workspaceInfo.path, 'agents', 'staff', agent.name)

    if (fs.existsSync(agentDir)) {
      result.push(agent)
    } else {
      log(styles.warning(`⚠ Agent '${agent.name}' in database but directory missing - skipping`))
    }
  }

  return result
}

function parseBooleanSetting(value: string | undefined): boolean | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

/**
 * Merge action-level and flag-level network allowlists.
 * Returns undefined if no domains are specified.
 */
function mergeAllowlists(actionDomains?: string[], flagValue?: string): string[] | undefined {
  const domains: string[] = []
  if (actionDomains) domains.push(...actionDomains)
  if (flagValue) {
    domains.push(...flagValue.split(',').map(d => d.trim()).filter(Boolean))
  }
  return domains.length > 0 ? domains : undefined
}

function isIssueSource(value: string | undefined): value is IssueSource {
  return value === 'linear' || value === 'jira' || value === 'asana' || value === 'shortcut' || value === 'trello'
}

/**
 * Extract explicitly-set flags for JSON mode command chaining.
 * Filters out defaults (false/undefined) and the json flag itself.
 * Used as accumulatedFlags so buildCommand includes prior resolver results.
 */
function getAccumulatedFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(flags)) {
    if (key === 'json' || val === undefined || val === false) continue
    result[key] = val
  }
  return result
}

/**
 * Build a base command string with all explicitly-set flags for JSON mode chaining.
 * Used by getCommand callbacks to include accumulated flags from prior prompts.
 */
function buildJsonBase(ticketId: string, flags: Record<string, unknown>): string {
  let cmd = `prlt work start ${ticketId}`
  for (const [key, val] of Object.entries(flags)) {
    if (key === 'json' || val === undefined || val === false) continue
    if (typeof val === 'boolean') {
      cmd += ` --${key}`
    } else if (typeof val === 'string') {
      cmd += ` --${key} "${val}"`
    } else if (Array.isArray(val)) {
      for (const item of val) {
        cmd += ` --${key} "${item}"`
      }
    } else {
      cmd += ` --${key} ${val}`
    }
  }
  return cmd
}

function buildExternalMetadata(envelope: NormalizedIssueEnvelope): Record<string, string> {
  switch (envelope.source.name) {
    case 'jira': return buildJiraMetadata(envelope)
    case 'asana': return buildAsanaMetadata(envelope)
    case 'shortcut': return buildShortcutMetadata(envelope)
    case 'trello': return buildTrelloMetadata(envelope)
    default: return buildLinearMetadata(envelope)
  }
}

function buildExternalTicketDescription(envelope: NormalizedIssueEnvelope): string {
  switch (envelope.source.name) {
    case 'jira': return buildJiraTicketDescription(envelope)
    case 'asana': return buildAsanaTicketDescription(envelope)
    case 'shortcut': return buildShortcutTicketDescription(envelope)
    case 'trello': return buildTrelloTicketDescription(envelope)
    default: return buildLinearTicketDescription(envelope)
  }
}

function buildExternalSpawnContextMessage(
  envelope: NormalizedIssueEnvelope,
  additionalMessage?: string,
): string {
  switch (envelope.source.name) {
    case 'jira': return buildJiraSpawnContextMessage(envelope, additionalMessage)
    case 'asana': return buildAsanaSpawnContextMessage(envelope, additionalMessage)
    case 'shortcut': return buildShortcutSpawnContextMessage(envelope, additionalMessage)
    case 'trello': return buildTrelloSpawnContextMessage(envelope, additionalMessage)
    default: return buildLinearSpawnContextMessage(envelope, additionalMessage)
  }
}

export default class WorkStart extends PMOCommand {
  static description = 'Start work on a ticket (launches an agent to implement it)'

  static strict = false  // Allow multiple ticket ID args for batch spawn

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --create-pr  # Create PR when work is ready',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode foreground',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode tmux',
    '<%= config.bin %> <%= command.id %> TKT-001 --mode terminal',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
    '<%= config.bin %> <%= command.id %> --all  # Spawn all backlog tickets',
    '<%= config.bin %> <%= command.id %> TKT-001 --prompt "Add unit tests for the API"  # Custom prompt',
    '<%= config.bin %> <%= command.id %> --from-issue --source linear --key ENG-123',
    '<%= config.bin %> <%= command.id %> --from-issue --source jira --key PROJ-123 --mirror-to-pmo',
    '<%= config.bin %> <%= command.id %> --from linear:ENG-123              # Unified: provider:key shorthand',
    '<%= config.bin %> <%= command.id %> --from jira:PROJ-123               # Unified: Jira shorthand',
    '<%= config.bin %> <%= command.id %> --from asana:1234567890            # Unified: Asana shorthand',
    '<%= config.bin %> <%= command.id %> --from shortcut:sc-123             # Unified: Shortcut shorthand',
    '<%= config.bin %> <%= command.id %> --from trello:abc123              # Unified: Trello shorthand',
    '<%= config.bin %> <%= command.id %> PRLT-933                           # Auto-detect: resolves via default source',
    '<%= config.bin %> <%= command.id %> --from-issue                       # Uses workspace default source',
    '<%= config.bin %> <%= command.id %> TKT-001 --review-gate auto        # Ship directly, no approval needed',
    '<%= config.bin %> <%= command.id %> TKT-001 --review-gate post        # Ship then human reviews after',
    '<%= config.bin %> <%= command.id %> PRLT-1085 PRLT-1086 PRLT-1087 --create-pr  # Batch spawn in parallel',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 TKT-003 --max-parallel 2  # Limit concurrent spawns',
    '<%= config.bin %> <%= command.id %> TKT-001 --dry-run                        # Validate environment without spawning',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) - prompts with dropdown if not provided. Pass multiple IDs for batch spawn.',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Start work on all unassigned backlog tickets (batch mode)',
      default: false,
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'custom'],
    }),
    action: Flags.string({
      description: 'Action to perform (internal — use work groom/implement/review/resolve instead)',
      hidden: true,
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'Custom prompt (overrides action)',
    }),
    message: Flags.string({
      description: 'Additional instructions appended to any action prompt',
    }),
    from: Flags.string({
      description: 'External issue ref in provider:key format (e.g., linear:ENG-123, jira:PROJ-456). Shorthand for --from-issue --source X --key Y.',
    }),
    'from-issue': Flags.boolean({
      description: 'Start from external issue source instead of internal ticket id',
      default: false,
    }),
    source: Flags.string({
      description: 'External issue source',
      options: ['linear', 'jira', 'asana', 'shortcut', 'trello'],
    }),
    key: Flags.string({
      description: 'External issue key (for example: ENG-123, PROJ-456)',
    }),
    'mirror-to-pmo': Flags.boolean({
      description: 'Mirror external issue data into PMO ticket (default from execution.mirror_to_pmo_default or PRLT_MIRROR_TO_PMO_DEFAULT)',
      allowNo: true,
    }),
    watch: Flags.boolean({
      char: 'w',
      description: 'Stream output in real-time',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Start even if work already in progress',
      default: false,
    }),
    'vm-host': Flags.string({
      description: 'VM host for vm mode',
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    reconfigure: Flags.boolean({
      description: 'Re-prompt for terminal app preference',
      default: false,
    }),
    'permission-mode': Flags.string({
      description: 'Permission mode for selected executor (danger=skip checks, safe=require approval)',
      options: ['danger', 'safe'],
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission checks (shorthand for --permission-mode danger)',
      default: false,
    }),
    'create-pr': Flags.boolean({
      description: 'Create PR when work is ready (canonical flag for PR behavior)',
      default: false,
    }),
    'no-pr': Flags.boolean({
      description: '[deprecated: use --create-pr instead] Skip PR creation when work is ready',
      default: false,
    }),
    'verify-ci': Flags.boolean({
      description: 'Agent polls CI after pushing and fixes failures before exiting (PRLT-1126)',
      default: false,
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output mode',
      options: ['interactive', 'print'],
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode (foreground=current terminal, terminal=new tab, background=detached)',
      options: ['foreground', 'terminal', 'background'],
    }),
    session: Flags.string({
      char: 's',
      description: 'Session manager inside container (tmux runs agent in tmux inside container)',
      options: ['tmux', 'direct'],
      default: 'tmux',
    }),
    agent: Flags.string({
      description: 'Agent to assign (skips interactive selection)',
    }),
    ephemeral: Flags.boolean({
      description: 'Create an ephemeral agent on-demand (auto-generates name)',
      default: false,
    }),
    focus: Flags.boolean({
      description: 'Bring terminal to foreground when opening new tabs (default: opens in background)',
      default: false,
    }),
    clone: Flags.boolean({
      description: 'Use independent git clone instead of worktree (more isolation, no real-time sync)',
      default: false,
    }),
    'review-gate': Flags.string({
      description: 'Review gate mode: required (human approves before landing), auto (ship directly), post (ship then review)',
      options: ['required', 'auto', 'post'],
    }),
    'session-action': Flags.string({
      description: 'Action when existing session found (attach, spawn, kill, cancel). Skips interactive menu.',
      options: ['attach', 'spawn', 'kill', 'cancel'],
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt (for non-TTY/scripted execution)',
      default: false,
    }),
    'use-api-key': Flags.boolean({
      description: 'Use ANTHROPIC_API_KEY for Docker containers instead of OAuth credentials',
      default: false,
      hidden: true,
    }),
    'tool-policy': Flags.string({
      description: 'Tool policy profile name for per-agent access control (e.g., code-agent, ops-agent)',
    }),
    'keep-alive': Flags.boolean({
      description: 'Keep container running after agent exits (shorthand for --cleanup persistent)',
      default: false,
    }),
    cleanup: Flags.string({
      description: 'Container cleanup policy (on-exit, persistent, on-error-keep)',
      options: ['on-exit', 'persistent', 'on-error-keep'],
    }),
    'allow-network': Flags.string({
      description: 'Extra domains to allow in container firewall (comma-separated, e.g., api.linear.app,api.slack.com)',
    }),
    repo: Flags.string({
      description: 'Repository to mount in agent workspace (can be specified multiple times, first is primary)',
      multiple: true,
    }),
    'max-parallel': Flags.integer({
      description: 'Maximum number of concurrent spawns when starting multiple tickets (default: unlimited)',
      min: 1,
    }),
    'dry-run': Flags.boolean({
      description: 'Validate environment and prerequisites without actually spawning an agent',
      default: false,
    }),
    environment: Flags.string({
      description: 'Execution environment (devcontainer or host). Use to bypass the environment selection prompt.',
      options: ['devcontainer', 'host'],
    }),
  }

  private async findLinkedTicketByEnvelope(_projectId: string, envelope: NormalizedIssueEnvelope): Promise<Ticket | undefined> {
    // Ticket lives in the provider (Linear, etc.) — look it up directly, no local PMO scan
    const provider = this.resolveProjectProvider(_projectId)
    if (provider.name !== 'pmo') {
      const result = await provider.getTicket(envelope.source.externalKey)
      if (result.success && result.ticket) return result.ticket
    }
    return undefined
  }

  private async createOrUpdateLinkedTicket(_projectId: string, envelope: NormalizedIssueEnvelope, _db: Database.Database): Promise<Ticket> {
    // No local PMO mirror or LinearMapper mapping needed.
    // Build a ticket from the envelope directly — the ticket lives in the provider.
    const metadata = buildExternalMetadata(envelope)
    return {
      id: envelope.source.externalKey,
      title: envelope.title,
      description: buildExternalTicketDescription(envelope),
      priority: envelope.priority ?? undefined,
      category: envelope.category ?? undefined,
      projectId: envelope.projectKey,
      projectName: envelope.projectKey,
      statusId: envelope.status,
      statusName: envelope.status,
      owner: envelope.assignee || undefined,
      assignee: envelope.assignee || undefined,
      subtasks: [],
      labels: envelope.labels,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  private async fetchExternalIssue(
    source: IssueSource,
    key: string,
    db: Database.Database,
  ): Promise<NormalizedIssueEnvelope | null> {
    switch (source) {
      case 'jira': return getJiraIssueByKey({}, key)
      case 'asana': return getAsanaTaskByGid({}, key)
      case 'shortcut': return getShortcutStoryByKey({}, key)
      case 'trello': return getTrelloCardById({}, key)
      default: {
        const apiKey = getLinearApiKey(db) || undefined
        const linearConfig = loadLinearConfig(db)
        const team = linearConfig?.defaultTeamKey || undefined
        return getLinearIssueByIdentifier({ apiKey, team }, key)
      }
    }
  }

  private async resolveIssueSourceAndKey(
    input: {
      source?: string
      key?: string
      db?: Database.Database
    },
    jsonMode: boolean,
  ): Promise<{ source: IssueSource; key: string; sourceResolution: { method: string; provider: string } }> {
    let source = input.source
    let key = input.key
    let sourceResolutionMethod = 'flag'

    // If no explicit source flag, try workspace default source
    if (!isIssueSource(source) && input.db) {
      const defaultSource = loadDefaultWorkSource(input.db)
      if (defaultSource && isIssueSource(defaultSource.provider)) {
        source = defaultSource.provider
        sourceResolutionMethod = 'default-source'
      }
    }

    const sourceResolver = new FlagResolver<{ source?: string }>({
      commandName: 'work start',
      baseCommand: 'prlt work start --from-issue',
      jsonMode,
      flags: {},
    })

    sourceResolver.addPrompt({
      flagName: 'source',
      type: 'list',
      message: 'Select external issue source:',
      default: isIssueSource(source) ? source : undefined,
      when: () => !isIssueSource(source),
      choices: () => [
        { name: 'Linear', value: 'linear', command: 'prlt work start --from linear:ISSUE-KEY --json' },
        { name: 'Jira', value: 'jira', command: 'prlt work start --from jira:ISSUE-KEY --json' },
        { name: 'Asana', value: 'asana', command: 'prlt work start --from asana:TASK-GID --json' },
        { name: 'Shortcut', value: 'shortcut', command: 'prlt work start --from shortcut:STORY-ID --json' },
        { name: 'Trello', value: 'trello', command: 'prlt work start --from trello:CARD-ID --json' },
      ],
    })
    const sourceResult = await sourceResolver.resolve()
    if (!isIssueSource(source)) {
      source = sourceResult.source
      sourceResolutionMethod = 'interactive'
    }

    if (!isIssueSource(source)) {
      throw new Error('Invalid source')
    }

    const keyResolver = new FlagResolver<{ key?: string }>({
      commandName: 'work start',
      baseCommand: `prlt work start --from ${source}:`,
      jsonMode,
      flags: {},
    })

    keyResolver.addPrompt({
      flagName: 'key',
      type: 'input',
      message: `Enter ${source === 'linear' ? 'Linear' : source === 'jira' ? 'Jira' : source === 'asana' ? 'Asana task' : source === 'shortcut' ? 'Shortcut story' : source === 'trello' ? 'Trello card' : source} key:`,
      default: key,
      when: () => !key?.trim(),
      validate: (value) => (value as string).trim().length > 0 ? true : 'Issue key is required',
    })
    const keyResult = await keyResolver.resolve()
    const resolvedKey = (key ?? keyResult.key ?? '').trim()

    if (!resolvedKey) {
      throw new Error('Issue key is required')
    }

    return {
      source,
      key: resolvedKey,
      sourceResolution: { method: sourceResolutionMethod, provider: source },
    }
  }

  async execute(): Promise<void> {
    const { args, flags, argv } = await this.parse(WorkStart)
    let projectId = (flags as { project?: string }).project

    // Check for conflicting PR flags
    if (flags['create-pr'] && flags['no-pr']) {
      if (shouldOutputJson(flags)) {
        outputErrorAsJson('CONFLICTING_FLAGS', '--create-pr and --no-pr are mutually exclusive', createMetadata('work start', flags))
        return
      }
      this.error('--create-pr and --no-pr are mutually exclusive');
    }

    // Deprecation guidance for --no-pr
    if (flags['no-pr']) {
      this.warn('--no-pr is deprecated. Omit --create-pr instead (PR creation is off by default). --no-pr will continue to work.')
    }

    // Handle --skip-permissions flag (alias for --permission-mode danger)
    // Check for conflicting flags first
    if (flags['skip-permissions'] && flags['permission-mode']) {
      if (shouldOutputJson(flags)) {
        outputErrorAsJson('CONFLICTING_FLAGS', 'Cannot use both --skip-permissions and --permission-mode flags. Use only one: --skip-permissions OR --permission-mode danger/safe', createMetadata('work start', flags))
        return
      }
      this.error(
        'Cannot use both --skip-permissions and --permission-mode flags.\n' +
        'Use only one: --skip-permissions OR --permission-mode danger/safe'
      )
    }
    // Apply --skip-permissions as --permission-mode danger
    if (flags['skip-permissions']) {
      flags['permission-mode'] = 'danger'
    }

    // Handle --environment flag: normalize to --run-on-host for host mode
    if (flags.environment === 'host') {
      flags['run-on-host'] = true
    }

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)
    const jsonModeConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'work start' } : null

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work start', flags))
        return
      }
      this.error(message)
    }

    // Get workspace info (for agent worktree paths)
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.')
    }

    // Open database for execution storage
    const db = openWorkspaceDatabase(workspaceInfo.path)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Handle batch mode (--all)
      if (flags.all) {
        await this.runBatchMode(workspaceInfo, db, executionStorage, flags)
        return
      }

      // Handle multi-ticket batch spawn: prlt work start TICKET1 TICKET2 TICKET3
      const ticketIdArgs = (argv as string[]).filter(a => !a.startsWith('-'))
      if (ticketIdArgs.length > 1) {
        await this.runMultiTicketBatch(ticketIdArgs, workspaceInfo, db, executionStorage, flags)
        return
      }

      // Get ticketId - prompt if not provided
      let ticketId = args.ticketId
      let externalIssueContextMessage: string | undefined
      let fromIssueMirror: boolean | undefined
      let fromIssueMirrorSource: string | undefined
      let sourceResolutionMeta: { method: string; provider: string } | undefined
      // PRLT-1167: When built from envelope without PMO mirror, holds the in-memory ticket
      let envelopeTicket: Ticket | undefined

      // Handle --from shorthand: parse provider:key into source + key
      let fromFlag = flags.from as string | undefined
      let fromIssueActive = flags['from-issue']

      if (fromFlag) {
        if (flags['from-issue'] || flags.source || flags.key) {
          db.close()
          return handleError('CONFLICTING_FLAGS', '--from cannot be used with --from-issue, --source, or --key. Use either --from provider:key or --from-issue --source X --key Y.')
        }
        fromIssueActive = true
        // Parse provider:key from --from value
        const colonIndex = fromFlag.indexOf(':')
        if (colonIndex !== -1) {
          flags.source = fromFlag.slice(0, colonIndex).toLowerCase()
          flags.key = fromFlag.slice(colonIndex + 1).trim()
        } else {
          // Provider only, no key - will prompt for key
          flags.source = fromFlag.toLowerCase()
        }
      }

      // Auto-detect external issue identifiers: if a positional ticketId is provided
      // that doesn't look like a local PMO ID (TKT-XXX), route through the default source.
      // This allows `prlt work start PRLT-933` to go directly to the configured source.
      if (ticketId && !fromIssueActive && !isLocalTicketId(ticketId)) {
        const defaultSource = loadDefaultWorkSource(db)
        if (defaultSource && isIssueSource(defaultSource.provider)) {
          // Treat the positional arg as an external issue key
          fromIssueActive = true
          flags.source = defaultSource.provider
          flags.key = ticketId
          ticketId = undefined // Clear so it gets set from linked ticket
          if (!jsonMode) {
            this.log(styles.muted(`"${flags.key}" is not a local ticket ID — resolving via default source: ${defaultSource.provider}`))
          }
        } else {
          db.close()
          return handleError(
            'NO_DEFAULT_SOURCE',
            `"${ticketId}" is not a local ticket ID (TKT-XXX) and no default work source is configured. ` +
            `Set one with: prlt work source set <provider[:context]>  (e.g. prlt work source set linear)\n` +
            `Or use: prlt work start --from <provider>:${ticketId}`
          )
        }
      }

      if (fromIssueActive) {
        if (ticketId) {
          db.close()
          return handleError('INVALID_FLAGS', 'Cannot provide a ticket ID positional argument when using --from-issue or --from.')
        }

        const fromBaseCmd = fromFlag ? `prlt work start --from ${fromFlag}` : 'prlt work start --from-issue'
        projectId = projectId || await this.requireProject({
          jsonMode: {
            flags,
            commandName: 'work start',
            baseCommand: fromBaseCmd,
          },
        })

        const sourceAndKey = await this.resolveIssueSourceAndKey({
          source: flags.source,
          key: flags.key,
          db,
        }, jsonMode)
        sourceResolutionMeta = sourceAndKey.sourceResolution

        if (!jsonMode && sourceResolutionMeta.method !== 'flag') {
          this.log(styles.muted(`Source resolved via ${sourceResolutionMeta.method}: ${sourceResolutionMeta.provider}`))
        }

        const envMirrorDefault = parseBooleanSetting(process.env.PRLT_MIRROR_TO_PMO_DEFAULT)
        const configMirrorDefault = getMirrorToPmoDefault(db)
        const mirrorResolution = resolveMirrorToPmo({
          flagValue: flags['mirror-to-pmo'],
          envValue: envMirrorDefault,
          configValue: configMirrorDefault,
        })
        const mirrorToPmo = mirrorResolution.enabled
        fromIssueMirror = mirrorToPmo
        fromIssueMirrorSource = mirrorResolution.source

        if (!jsonMode) {
          this.log(styles.muted(`External issue mirror: ${mirrorToPmo ? 'enabled' : 'disabled'} (${mirrorResolution.source})`))
        }

        let envelope: NormalizedIssueEnvelope | null = null
        try {
          envelope = await this.fetchExternalIssue(sourceAndKey.source, sourceAndKey.key, db)
        } catch (error) {
          if (error instanceof ExternalIssueAdapterError) {
            db.close()
            return handleError(
              `EXTERNAL_ISSUE_${error.code}`,
              `[${sourceAndKey.source}] ${error.message}`
            )
          }
          const message = error instanceof Error ? error.message : 'Failed to fetch external issue.'
          db.close()
          return handleError('EXTERNAL_ISSUE_REQUEST_FAILED', message)
        }

        if (!envelope) {
          db.close()
          return handleError(
            'EXTERNAL_ISSUE_NOT_FOUND',
            `${sourceAndKey.source} issue "${sourceAndKey.key}" was not found.`
          )
        }

        const existingLinkedTicket = await this.findLinkedTicketByEnvelope(projectId, envelope)
        let linkedTicket: Ticket

        if (mirrorToPmo) {
          linkedTicket = await this.createOrUpdateLinkedTicket(projectId, envelope, db)
          await autoExportToBoard(this.pmoPath, this.storage)
        } else if (existingLinkedTicket) {
          envelopeTicket = existingLinkedTicket
          // Existing PMO ticket found — use it (backward compat)
          linkedTicket = existingLinkedTicket
        } else {
          // PRLT-1167: Build Ticket from envelope directly — no PMO mirror
          linkedTicket = buildTicketFromEnvelope(envelope, projectId)
          envelopeTicket = linkedTicket

          // Store in ticket_refs so post-execution and other commands can find it
          const ticketRefStore = new TicketRefStore(db)
          ticketRefStore.upsert({
            id: linkedTicket.id,
            provider: envelope.source.name,
            externalId: envelope.source.externalId,
            externalKey: envelope.source.externalKey,
            externalUrl: envelope.source.url,
            title: envelope.title,
            description: envelope.description,
            status: envelope.status,
            priority: envelope.priority,
            category: envelope.category,
            assignee: envelope.assignee,
            projectId,
          })

          if (!jsonMode) {
            this.log(styles.muted(`Ticket ref stored: ${linkedTicket.id} (no PMO mirror)`))
          }
        }

        ticketId = linkedTicket.id
        externalIssueContextMessage = buildExternalSpawnContextMessage(envelope, flags.message)
      }

      if (!ticketId) {
        // Get all tickets live from provider (Linear, GitHub, etc.) — no local PMO fallback
        const startProvider = this.resolveProjectProvider(projectId || '')
        const startListResult = await startProvider.listTickets(projectId)
        if (!startListResult.success) {
          db.close()
          return handleError('LIST_FAILED', startListResult.error || 'Failed to list tickets from provider.')
        }
        const allTickets = startListResult.tickets

        if (allTickets.length === 0) {
          db.close()
          return handleError('NO_TICKETS', 'No tickets found. Create a ticket first with "prlt ticket create".')
        }

        const selected = await this.selectFromList({
          message: 'Select ticket to work on:',
          items: allTickets,
          getName: (t) => `[${t.priority || 'None'}] ${t.id} - ${t.title} (${t.assignee ? `assignee: ${t.assignee}` : 'unassigned'})`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work start ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work start' } : null,
        })

        if (!selected) {
          db.close()
          return
        }
        ticketId = selected
      }

      // Get ticket from provider — no local PMO fallback
      let ticket = envelopeTicket ?? null
      if (!ticket) {
        const tp = await this.resolveTicketProvider(ticketId!, projectId || '')
        const gr = await tp.getTicket(ticketId!)
        if (gr.success && gr.ticket) {
          ticket = gr.ticket
        }
      }
      if (!ticket) {
        db.close()
        return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`)
      }
      // Use resolved internal ID for all subsequent operations (external keys like PRLT-xxx resolve to TKT-xxx)
      ticketId = ticket.id
      const isExternalOnly = !!envelopeTicket

      // --dry-run: validate environment and report issues without spawning
      if (flags['dry-run']) {
        const dryRunEnvironment = flags['run-on-host'] ? 'host' : 'devcontainer'
        const dryRunExecutor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

        const report = runPreflightChecks({
          environment: dryRunEnvironment,
          executor: dryRunExecutor,
          db,
          ticket: { id: ticket.id, title: ticket.title },
          agentDir: null, // Not yet created during dry-run
        })

        if (jsonMode) {
          const metadata = createMetadata('work start', flags)
          metadata.dryRun = true
          metadata.environment = dryRunEnvironment
          metadata.executor = dryRunExecutor
          const jsonResult = {
            passed: report.passed,
            checks: report.checks.map(c => ({
              name: c.name,
              label: c.label,
              passed: c.passed,
              severity: c.severity,
              message: c.message,
              fix: c.fix ?? null,
            })),
            errors: report.errors.length,
            warnings: report.warnings.length,
          }
          outputExecutionResultAsJson(
            [{ workId: '', ticketId: ticket.id, agent: '', status: report.passed ? 'ready' : 'blocked' }],
            report.passed ? 1 : 0,
            report.passed ? 0 : 1,
            { ...metadata, preflight: jsonResult }
          )
        } else {
          this.log('')
          this.log(styles.header(`Dry-run: preflight validation for ${ticket.id}`))
          this.log(styles.muted(`   Environment: ${dryRunEnvironment}`))
          this.log(styles.muted(`   Executor: ${dryRunExecutor}`))
          this.log('')
          this.log(formatPreflightReport(report))
          this.log('')

          if (report.passed) {
            this.log(styles.success('All preflight checks passed — ready to spawn.'))
          } else {
            this.log(styles.error(`${report.errors.length} error(s) and ${report.warnings.length} warning(s) found.`))
            this.log(styles.muted('Fix the errors above, then run without --dry-run to start work.'))
          }
        }

        db.close()
        return
      }

      // In JSON mode with explicit flags, implement two-step confirm-then-execute protocol
      if (jsonMode) {
        // Check if all required flags for non-interactive execution are provided
        const hasAction = !!(flags.action || flags.prompt)
        const hasDisplay = !!(flags.display || flags['run-on-host'])
        const hasPermissions = !!(flags['permission-mode'] || flags['skip-permissions'])
        const hasAgent = !!(flags.ephemeral || flags.agent)
        const allFlagsProvided = hasAction && hasDisplay && hasPermissions && hasAgent

        if (allFlagsProvided && !flags.yes) {
          // All flags provided but no --yes: return confirmation_needed with plan
          const metadata = createMetadata('work start', flags)
          // Resolve PR mode using same priority as execution: flags > workspace config > default
          const earlyConfigPrDefault = getCreatePrDefault(db)
          const earlyResolvedPr = flags['create-pr'] ? 'create-pr'
            : flags['no-pr'] ? 'no-pr'
            : earlyConfigPrDefault === true ? 'create-pr'
            : earlyConfigPrDefault === false ? 'no-pr'
            : 'no-pr'
          metadata.resolvedPRMode = earlyResolvedPr
          const externalMetadata = getTicketExternalMetadata(ticket)
          if (externalMetadata.source || externalMetadata.key) {
            metadata.externalIssue = {
              source: externalMetadata.source ?? null,
              key: externalMetadata.key ?? null,
              id: externalMetadata.id ?? null,
              url: externalMetadata.url ?? null,
            }
          }
          if (fromIssueActive) {
            metadata.mirrorToPmo = fromIssueMirror ?? null
            metadata.mirrorToPmoSource = fromIssueMirrorSource ?? null
            if (sourceResolutionMeta) {
              metadata.sourceResolution = sourceResolutionMeta
            }
          }

          // Build the confirm command with --yes
          let confirmCmd = `prlt work start ${ticketId}`
          if (flags.action) confirmCmd += ` --action ${flags.action}`
          if (flags.prompt) confirmCmd += ` --prompt "${flags.prompt}"`
          if (flags.display) confirmCmd += ` --display ${flags.display}`
          if (flags['run-on-host']) confirmCmd += ' --run-on-host'
          if (flags['permission-mode']) confirmCmd += ` --permission-mode ${flags['permission-mode']}`
          if (flags['skip-permissions']) confirmCmd += ' --skip-permissions'
          if (flags.ephemeral) confirmCmd += ' --ephemeral'
          if (flags.agent) confirmCmd += ` --agent ${flags.agent}`
          if (flags.executor) confirmCmd += ` --executor ${flags.executor}`
          if (flags.session) confirmCmd += ` --session ${flags.session}`
          if (flags['create-pr']) confirmCmd += ' --create-pr'
          if (flags['no-pr']) confirmCmd += ' --no-pr'
          if (flags.clone) confirmCmd += ' --clone'
          if (flags.focus) confirmCmd += ' --focus'
          if (flags.force) confirmCmd += ' --force'
          confirmCmd += ' --yes'

          const plan = {
            ticket: {
              id: ticket.id,
              title: ticket.title,
              status: ticket.statusName,
            },
            action: flags.action || 'implement',
            display: flags.display || (flags['run-on-host'] ? 'host' : 'devcontainer'),
            permissions: (flags['permission-mode'] || (flags['skip-permissions'] ? 'danger' : 'safe')),
            agent: flags.agent || 'ephemeral',
          }

          db.close()
          outputConfirmationNeededAsJson(
            plan,
            confirmCmd,
            `Ready to start work on ${ticketId}. Run with --yes to execute.`,
            metadata
          )
          return
        }
        // If --yes is set with all flags, continue to execution (don't return)
        // If missing flags, continue and let FlagResolver handle prompts
      }

      // Check if ticket is blocked by dependencies (skip for external-only tickets)
      const isBlocked = isExternalOnly ? false : await this.storage.isTicketBlocked(ticketId!)
      if (isBlocked && !flags.force) {
        const blockers = await this.storage.getTicketBlockers(ticketId!)
        const incompleteBlockers = blockers.filter(b => b.status !== 'done' && b.status !== 'canceled')

        if (!jsonMode) {
          this.log('')
          this.log(styles.warning(`⚠️  ${ticketId} is blocked by:`))
          for (const blocker of incompleteBlockers) {
            this.log(styles.muted(`   - ${blocker.id}: ${blocker.title} (${blocker.status})`))
          }
          this.log('')
        }

        // Use FlagResolver for blocked ticket confirmation
        const blockedResolver = new FlagResolver<{ startAnyway?: string }>({
          commandName: 'work start',
          baseCommand: `prlt work start ${ticketId}`,
          jsonMode,
          flags: {},
          accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
        })

        const jsonBaseBlocked = buildJsonBase(ticketId!, flags as Record<string, unknown>)
        blockedResolver.addPrompt({
          flagName: 'startAnyway',
          type: 'list',
          message: 'Start anyway?',
          default: 'no',
          choices: () => [
            { name: 'No, cancel', value: 'no' },
            { name: 'Yes, start despite blockers', value: 'yes' },
          ],
          getCommand: (value) => {
            if (value === 'yes') return `${jsonBaseBlocked} --force --json`
            return ''
          },
        })

        const blockedResult = await blockedResolver.resolve()
        if (blockedResult.startAnyway !== 'yes') {
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }
      }

      // Check for existing tmux session for this ticket
      const existingSession = getTicketTmuxSession(ticketId!)
      if (existingSession && !flags.force) {
        if (!jsonMode) {
          this.log('')
          this.log(styles.warning(`Ticket ${ticketId} has an active tmux session (${existingSession.agent})`))
        }

        // Use FlagResolver for session action
        const sessionResolver = new FlagResolver<{ 'session-action'?: string }>({
          commandName: 'work start',
          baseCommand: `prlt work start ${ticketId}`,
          jsonMode,
          flags: flags['session-action'] ? { 'session-action': flags['session-action'] } : {},
          accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
        })

        sessionResolver.addPrompt({
          flagName: 'session-action',
          type: 'list',
          message: 'What would you like to do?',
          choices: () => [
            { name: 'Attach to existing session', value: 'attach' },
            { name: 'Spawn new agent (keeps existing session)', value: 'spawn' },
            { name: 'Kill session and respawn', value: 'kill' },
            { name: 'Cancel', value: 'cancel' },
          ],
        })

        const sessionResult = await sessionResolver.resolve()
        const sessionAction = sessionResult['session-action']

        if (sessionAction === 'cancel') {
          db.close()
          this.log(styles.muted('Cancelled.'))
          return
        }

        if (sessionAction === 'attach') {
          // Attach to existing session
          execSync(`tmux attach -d -t "${existingSession.sessionName}"`, { stdio: 'inherit' })
          db.close()
          return
        }

        if (sessionAction === 'kill') {
          killTmuxSession(existingSession.sessionName)
          this.log(styles.success(`Killed session ${existingSession.sessionName}`))
        }
        // For 'spawn', we continue with creating a new agent
      }

      // Check for existing worktree with ticket's branch (dead agent recovery)
      let reusingWorktree = false

      if (ticket.branch && !flags.agent) {
        const existingWorktree = findWorktreeForBranch(workspaceInfo, ticket.branch)
        if (existingWorktree) {
          reusingWorktree = true
          if (!jsonMode) {
            this.log(styles.muted(`Found existing worktree for branch in dead agent "${existingWorktree.agentName}"`))
            this.log(styles.muted(`Reusing worktree at: ${existingWorktree.agentDir}`))
          }
        }
      }

      // Agent selection: ephemeral flag, agent flag, ticket assignee, or prompt
      let agentName: string | undefined
      let agentWorktreePath: string | undefined
      let isEphemeralAgent = flags.ephemeral

      if (reusingWorktree) {
        // Reuse dead agent's worktree — skip creating a new agent
        const existingWorktree = findWorktreeForBranch(workspaceInfo, ticket.branch!)!
        agentName = existingWorktree.agentName
        agentWorktreePath = existingWorktree.agentDir
        isEphemeralAgent = true
        if (!jsonMode) {
          this.log(styles.success(`Reusing agent: ${agentName} (worktree recovery)`))
        }
      } else if (flags.ephemeral) {
        // Create ephemeral agent on-demand
        if (!jsonMode) {
          this.log(styles.muted('Creating ephemeral agent...'))
        }
        const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
          skipDevcontainer: flags['run-on-host'],
          log: (msg) => {
            if (!jsonMode) this.log(msg)
          },
          mountMode: flags.clone ? 'clone' : 'worktree',
        })
        agentName = ephemeralResult.name
        agentWorktreePath = ephemeralResult.worktreePath
        if (!jsonMode) {
          this.log(styles.success(`Created ephemeral agent: ${agentName}`))
        }
      } else if (flags.agent) {
        // Agent specified via flag
        agentName = flags.agent
      } else {
        // Note: We no longer auto-reuse ticket.assignee to enable parallel work
        // (e.g., groom + implement, or multiple implementations on same ticket)
        // No agent specified - default to creating ephemeral agent (new behavior)
        // Or prompt for agent selection if staff agents exist

        // Get staff agents that exist on disk (warns about missing directories)
        const activeStaffAgents = getActiveStaffAgents(workspaceInfo, (msg) => {
          if (!jsonMode) this.log(msg)
        })

        if (activeStaffAgents.length > 0) {
          // Clean up stale executions before checking availability (TKT-604)
          // This fixes agents appearing as "busy" when their sessions have terminated
          const cleanedExecutions = executionStorage.cleanupStaleExecutionsDetailed()
          if (cleanedExecutions.length > 0 && !jsonMode) {
            this.log(styles.muted(`   Cleaned up ${cleanedExecutions.length} stale execution(s)`))
          }

          // Post-execution hook: validate commits and auto-transition tickets that have PRs to Review
          if (cleanedExecutions.length > 0) {
            for (const cleaned of cleanedExecutions) {
              try {
                // Resolve agent directory for commit validation (PRLT-984)
                let agentDir: string | undefined
                let repoWorktrees: string[] | undefined
                if (cleaned.agentName) {
                  try {
                    agentDir = resolveAgentDir(workspaceInfo, cleaned.agentName)
                    repoWorktrees = detectRepoWorktrees(agentDir)
                  } catch {
                    // Agent dir resolution may fail for ephemeral agents that were cleaned up
                  }
                }

                const result = await handlePostExecutionTransition(
                  {
                    ticketId: cleaned.ticketId,
                    agentName: cleaned.agentName,
                    branch: cleaned.branch,
                    agentDir,
                    repoWorktrees,
                  },
                  this.storage,
                  db,
                )
                if (result.blockedByValidation && !jsonMode) {
                  this.log(styles.warning(`   ⚠ ${cleaned.ticketId}: agent completed without meaningful code — ${result.validation?.details}`))
                  // Persist validation failure on the execution record
                  executionStorage.updateStatus(cleaned.executionId, 'failed', undefined, `Commit validation failed: ${result.validation?.details}`)
                } else if (result.transitioned && !jsonMode) {
                  const via = result.provider && result.provider !== 'pmo' ? ` via ${result.provider}` : ''
                  const validationInfo = result.validation ? ` (${result.validation.details})` : ''
                  this.log(styles.muted(`   Auto-transitioned ${cleaned.ticketId}: ${result.fromState} → ${result.toState}${via}${validationInfo}`))
                }
              } catch {
                // Non-fatal — don't block work start for transition failures
              }
            }
          }

          // Get list of busy agents (already running something)
          const busyAgentNames = new Set<string>()
          for (const agent of activeStaffAgents) {
            const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
            if (runningExecutions.length > 0) {
              busyAgentNames.add(agent.name)
            }
          }

          // Build agent choices
          const availableAgents = activeStaffAgents.filter(a => !busyAgentNames.has(a.name))
          const busyAgents = activeStaffAgents.filter(a => busyAgentNames.has(a.name))

          const agentChoiceList: Array<{ name: string; value: string; disabled?: boolean }> = [
            { name: 'Create new ephemeral agent (recommended)', value: '__ephemeral__' },
          ]

          for (const a of availableAgents) {
            agentChoiceList.push({ name: a.name, value: a.name })
          }

          for (const a of busyAgents) {
            const runningExecs = executionStorage.getAgentRunningExecutions(a.name)
            const ticketIds = runningExecs.map(e => e.ticketId).join(', ')
            agentChoiceList.push({ name: `${a.name} (working on ${ticketIds})`, value: a.name, disabled: true })
          }

          // Use FlagResolver for agent selection
          const jsonBaseAgent = buildJsonBase(ticketId!, flags as Record<string, unknown>)
          const agentResolver = new FlagResolver<{ selectedAgent?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
            accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
          })

          agentResolver.addPrompt({
            flagName: 'selectedAgent',
            type: 'list',
            message: `Select agent for ${ticketId}:`,
            default: '__ephemeral__',
            choices: () => agentChoiceList,
            getCommand: (value) => {
              if (value === '__ephemeral__') return `${jsonBaseAgent} --ephemeral --json`
              return `${jsonBaseAgent} --agent "${value}" --json`
            },
          })

          const agentResult = await agentResolver.resolve()
          const selectedAgent = agentResult.selectedAgent

          if (selectedAgent === '__ephemeral__') {
            // Create ephemeral agent
            if (!jsonMode) this.log(styles.muted('Creating ephemeral agent...'))
            const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
              skipDevcontainer: flags['run-on-host'],
              log: (msg) => { if (!jsonMode) this.log(msg) },
              mountMode: flags.clone ? 'clone' : 'worktree',
            })
            agentName = ephemeralResult.name
            agentWorktreePath = ephemeralResult.worktreePath
            isEphemeralAgent = true
            if (!jsonMode) this.log(styles.success(`Created ephemeral agent: ${agentName}`))
          } else {
            agentName = selectedAgent
          }
        } else {
          // No pre-registered agents - create ephemeral agent by default
          if (!jsonMode) this.log(styles.muted('Creating ephemeral agent...'))
          const ephemeralResult = await createEphemeralAgent(workspaceInfo, {
            skipDevcontainer: flags['run-on-host'],
            log: (msg) => { if (!jsonMode) this.log(msg) },
            mountMode: flags.clone ? 'clone' : 'worktree',
          })
          agentName = ephemeralResult.name
          agentWorktreePath = ephemeralResult.worktreePath
          isEphemeralAgent = true
          if (!jsonMode) this.log(styles.success(`Created ephemeral agent: ${agentName}`))
        }
      }

      // At this point agentName is guaranteed to be set
      const assignedAgent = agentName as string

      // Validate agent - for non-ephemeral agents, check if it exists in workspace
      const agentInfo = workspaceInfo.agents.find((a) => a.name === assignedAgent)
      if (!isEphemeralAgent && !agentInfo) {
        db.close()
        return handleError('AGENT_NOT_FOUND',
          `Agent "${assignedAgent}" not found in workspace. Use --ephemeral to create an ephemeral agent, or add a staff agent with "prlt agent add ${assignedAgent}"`
        )
      }

      // Check for running execution on this ticket (warning only, allows parallel work)
      const runningExecution = executionStorage.getRunningExecution(ticketId!)
      if (runningExecution && !jsonMode) {
        this.log(styles.warning(`⚠️  Ticket "${ticketId}" already has work in progress: ${runningExecution.id}`))
        this.log(styles.muted(`   Starting parallel execution. Note: status updates may conflict.`))
      }

      // Check if agent is already working on something else
      // Skip for ephemeral agents - they're created fresh for each spawn
      if (!isEphemeralAgent) {
        const agentRunningExecutions = executionStorage.getAgentRunningExecutions(assignedAgent)
        if (agentRunningExecutions.length > 0 && !flags.force) {
          const execInfo = agentRunningExecutions.map(e => `  ${e.id}: ${e.ticketId}`).join('\n')
          db.close()
          return handleError('AGENT_BUSY',
            `Agent "${assignedAgent}" is already working on other tickets:\n${execInfo}\n\nUse --force to start anyway, or stop existing work first.`
          )
        }
      }

      // Determine worktree path
      // Agent directory structure varies:
      // - Ephemeral: agents/temp/{agent}/ (created on-demand)
      // - Staff HQ: agents/staff/{agent}/{repoName}/ (git worktree per repo)
      // - Workspace-only: {agentsPath}/{agent}/{repoName}/ (git worktree)
      // - HQ without repos: {agentsPath}/{agent}/ (placeholder, use cwd)

      // For ephemeral agents, use the worktree path from creation
      // For existing agents, derive from agentsPath
      let agentDir: string
      if (isEphemeralAgent && agentWorktreePath) {
        agentDir = agentWorktreePath
      } else if (agentInfo?.worktree_path) {
        // Agent has a worktree_path in the database
        agentDir = path.join(workspaceInfo.path, agentInfo.worktree_path)
      } else {
        // Fall back to default path calculation
        agentDir = path.join(workspaceInfo.agentsPath, assignedAgent)
      }

      if (!fs.existsSync(agentDir)) {
        db.close()
        return handleError('AGENT_DIR_NOT_FOUND',
          `Agent directory not found at ${agentDir}. Use --ephemeral to create an ephemeral agent, or create a staff agent with "prlt agent add ${assignedAgent}"`
        )
      }

      // For staff agents, check for uncommitted/unpushed work before starting
      if (!isEphemeralAgent) {
        const { getAgentGitStatus, pushAgentWork } = await import('../../lib/agents/commands.js')
        const gitStatus = getAgentGitStatus(workspaceInfo, assignedAgent)

        if (gitStatus.hasUnsavedWork) {
          if (!jsonMode) {
            this.log(styles.warning(`\n⚠️  Agent "${assignedAgent}" has unsaved work:`))
            for (const wt of gitStatus.worktrees) {
              if (wt.hasUncommittedChanges) {
                this.log(styles.muted(`  ${wt.repoName}: ${wt.uncommittedFiles.length} uncommitted file(s)`))
              }
              if (wt.hasUnpushedCommits) {
                this.log(styles.muted(`  ${wt.repoName}: ${wt.unpushedCount} unpushed commit(s) on ${wt.branch}`))
              }
            }
            this.log('')
          }

          // Use FlagResolver for unsaved work action
          const jsonBaseUnsaved = buildJsonBase(ticketId!, flags as Record<string, unknown>)
          const unsavedResolver = new FlagResolver<{ unsavedAction?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
            accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
          })

          unsavedResolver.addPrompt({
            flagName: 'unsavedAction',
            type: 'list',
            message: 'How would you like to proceed?',
            choices: () => [
              { name: 'Push existing work and continue', value: 'push' },
              { name: 'Continue anyway (existing work may conflict)', value: 'continue' },
              { name: 'Cancel', value: 'cancel' },
            ],
            getCommand: (value) => {
              if (value === 'cancel') return ''
              // Both 'push' and 'continue' advance; use --force to skip re-prompt
              return `${jsonBaseUnsaved} --force --json`
            },
          })

          const unsavedResult = await unsavedResolver.resolve()
          const action = unsavedResult.unsavedAction

          if (action === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          if (action === 'push') {
            const pushed = pushAgentWork(workspaceInfo, assignedAgent, (msg) => this.log(styles.muted(`  ${msg}`)))
            if (!pushed) {
              this.log(styles.warning('Some work could not be pushed. Please resolve manually.'))
            }
          }
        }
      }

      // Detect repository worktrees within agent directory
      const repoWorktrees = detectRepoWorktrees(agentDir)
      const worktreePath = resolveWorktreePath(agentDir, repoWorktrees)

      if (repoWorktrees.length > 1) {
        this.log(styles.muted(`   Repos: ${repoWorktrees.join(', ')}`))
      } else if (repoWorktrees.length === 0) {
        this.log(styles.muted(`   No git worktree found for agent, using current directory`))
      }

      // Use ticket's existing branch or generate a new one
      // When ticket was imported from an external source, use the external key
      // (e.g. PRLT-962) instead of the internal PMO ID (e.g. TKT-134) for branch naming
      const externalMeta = getTicketExternalMetadata(ticket)
      const branchTicketId = externalMeta.key || ticket.id
      const branch = ticket.branch || generateBranchName(
        branchTicketId,
        ticket.title,
        ticket.category
      )
      const isExistingBranch = !!ticket.branch

      // Get epic info if linked
      let epicTitle: string | undefined
      if (ticket.epicId) {
        const epic = await this.storage.getEpic(ticket.epicId)
        epicTitle = epic?.title
      }

      // Determine action for this work session
      // The --action flag is hidden/internal — used by dedicated commands (work groom, work review, etc.)
      // When called directly, work start always uses 'implement'
      let selectedAction: WorkAction | null = null
      let customPrompt: string | undefined

      if (flags.prompt) {
        // Custom prompt overrides everything
        customPrompt = flags.prompt
      } else {
        // Use specified action (internal routing) or default to 'implement'
        const actionId = flags.action || 'implement'
        selectedAction = await this.storage.getAction(actionId)
        if (!selectedAction) {
          db.close()
          return handleError('ACTION_NOT_FOUND', `Action not found: ${actionId}`)
        }
      }

      // Build execution context with full ticket details
      // HQ path comes from workspaceInfo (not derived from pmoPath since pmo can be nested in repos)
      const hqPath = workspaceInfo.path

      // Build structured workspace repo info (PRLT-1088)
      const workspaceRepos = buildWorkspaceRepos(agentDir, repoWorktrees)

      const context: ExecutionContext = {
        ticketId: ticket.id,
        externalTicketId: branchTicketId !== ticket.id ? branchTicketId : undefined,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
        ticketPriority: ticket.priority,
        ticketCategory: ticket.category,
        epicTitle,
        agentName: assignedAgent,
        agentDir,         // Agent directory (contains .devcontainer)
        worktreePath,     // Worktree path (may be subdirectory of agentDir)
        branch,
        hqPath,
        pmoPath: this.pmoPath,          // PMO path for container mounting
        repoWorktrees,
        workspaceRepos,   // Structured workspace repo info (PRLT-1088)
        isEphemeral: isEphemeralAgent,
        // Tool policy (TKT-083)
        toolPolicy: flags['tool-policy'],
        // Action context
        actionId: selectedAction?.id,
        actionName: selectedAction?.name || (customPrompt ? 'Custom' : undefined),
        actionPrompt: customPrompt || selectedAction?.prompt,
        actionEndPrompt: customPrompt ? undefined : selectedAction?.endPrompt,
        modifiesCode: customPrompt ? true : selectedAction?.modifiesCode ?? true,
        networkAllowlist: mergeAllowlists(selectedAction?.networkAllowlist, flags['allow-network']),
        // Additional instructions from --message flag
        customMessage: externalIssueContextMessage ?? flags.message,
        // Connected integrations for prompt injection
        connectedIntegrations: getConnectedIntegrations(db),
      }

      // Check if agent has devcontainer config
      const hasDevcontainer = hasDevcontainerConfig(agentDir)

      // Use devcontainer by default if available, unless --run-on-host is set
      // --environment devcontainer explicitly requests devcontainer mode
      const useDevcontainer = (hasDevcontainer && !flags['run-on-host']) || flags.environment === 'devcontainer'

      // Determine execution environment and display mode
      let environment: ExecutionEnvironment = 'host'
      let displayMode: DisplayMode = 'terminal'
      let permissionMode: PermissionMode = 'danger'

      if (hasDevcontainer && !flags.display && !flags['run-on-host'] && !flags.environment) {
        // Agent has devcontainer - prompt for environment choice
        const devcontainerLabel = '🐳 devcontainer (isolated, recommended)'

        const envChoices = [
          { name: devcontainerLabel, value: 'devcontainer' },
          { name: '💻 host (runs directly on your machine)', value: 'host' },
          { name: '✗  cancel', value: 'cancel' },
        ]

        // In JSON mode, use FlagResolver (outputs prompt and exits)
        if (jsonMode) {
          const jsonBaseEnv = buildJsonBase(ticketId!, flags as Record<string, unknown>)
          const envResolver = new FlagResolver<{ environment?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
            accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
          })

          envResolver.addPrompt({
            flagName: 'environment',
            type: 'list',
            message: 'Where should the agent run?',
            default: 'devcontainer',
            choices: () => envChoices,
            getCommand: (value) => {
              if (value === 'host') return `${jsonBaseEnv} --run-on-host --json`
              if (value === 'cancel') return ''
              // Explicit --environment devcontainer so the command advances past this prompt
              return `${jsonBaseEnv} --environment devcontainer --json`
            },
          })

          await envResolver.resolve()
          // FlagResolver exits in JSON mode, so we never reach here
          db.close()
          return
        }

        // Loop to allow re-selection if Docker isn't running
        let environmentSelected = false
        while (!environmentSelected) {
          // eslint-disable-next-line no-await-in-loop -- Interactive loop with retry on Docker check
          const { selectedEnvironment } = await this.prompt<{ selectedEnvironment: string }>([
            {
              type: 'list',
              name: 'selectedEnvironment',
              message: 'Where should the agent run?',
              choices: envChoices,
              default: 'devcontainer',
            },
          ], jsonModeConfig)

          if (selectedEnvironment === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          if (selectedEnvironment === 'devcontainer') {
            // Dynamically check Docker when selected (user may have started it)
            if (!isDockerRunning()) {
              this.log('')
              this.warn('Docker is not running. Please start Docker and try again.')
              this.log('')
              continue  // Re-prompt for environment selection
            }

            // Check devcontainer CLI is installed
            if (!isDevcontainerCliInstalled()) {
              this.log('')
              this.warn(
                'devcontainer CLI is not installed.\n' +
                'Install with: npm install -g @devcontainers/cli\n' +
                'Or select "host" to run directly on your machine.'
              )
              this.log('')
              continue  // Re-prompt for environment selection
            }

            // Check GitHub token is available for git push operations
            if (!isGitHubTokenAvailable()) {
              const tokenMessage = 'GitHub token not found. Git push may fail. Continue without token?'

              // Use FlagResolver for token action prompt
              const jsonBaseToken = buildJsonBase(ticketId!, flags as Record<string, unknown>)
              const tokenResolver = new FlagResolver<{ tokenAction?: string }>({
                commandName: 'work start',
                baseCommand: `prlt work start ${ticketId}`,
                jsonMode,
                flags: {},
                accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
              })

              tokenResolver.addPrompt({
                flagName: 'tokenAction',
                type: 'list',
                message: tokenMessage,
                default: 'continue',
                choices: () => [
                  { name: 'Yes, continue anyway (git push may fail)', value: 'continue' },
                  { name: 'No, let me run gh auth login first', value: 'cancel' },
                  { name: 'Switch to host mode instead', value: 'host' },
                ],
                getCommand: (value) => {
                  if (value === 'cancel') return ''
                  if (value === 'host') return `${jsonBaseToken} --run-on-host --json`
                  // 'continue' — re-run with environment devcontainer explicit
                  return `${jsonBaseToken} --environment devcontainer --json`
                },
              })

              // In JSON mode, this will output prompt and exit
              // In interactive mode, show warning first then prompt
              if (!jsonMode) {
                this.log('')
                this.warn(
                  'GitHub token not found.\n' +
                  'Git push operations may fail inside the container.\n' +
                  'Run `gh auth login` to authenticate, or continue without token.'
                )
                this.log('')
              }

              // eslint-disable-next-line no-await-in-loop -- Interactive user prompt in loop
              const resolved = await tokenResolver.resolve()
              const tokenAction = resolved.tokenAction

              if (tokenAction === 'cancel') {
                db.close()
                this.log(styles.muted('Run `gh auth login` and try again.'))
                return
              }

              if (tokenAction === 'host') {
                environment = 'host'
                // Skip to host mode prompts
                // eslint-disable-next-line no-await-in-loop -- Follow-up prompt after user selection
                const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
                  {
                    type: 'list',
                    name: 'selectedDisplay',
                    message: 'How should the agent output be displayed?',
                    choices: [
                      { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: `prlt work start ${ticketId} --display terminal --run-on-host --json` },
                      { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground', command: `prlt work start ${ticketId} --display foreground --run-on-host --json` },
                      { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background', command: `prlt work start ${ticketId} --display background --run-on-host --json` },
                    ],
                    default: 'terminal',
                  },
                ], jsonModeConfig)
                displayMode = selectedDisplay as DisplayMode
                environmentSelected = true
                continue
              }
              // tokenAction === 'continue' - fall through to devcontainer setup
            }

            environment = 'devcontainer'
            // Pick display mode for devcontainer
            // eslint-disable-next-line no-await-in-loop -- Follow-up prompt after selection
            const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
              {
                type: 'list',
                name: 'selectedDisplay',
                message: 'How should the agent output be displayed?',
                choices: [
                  { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: `prlt work start ${ticketId} --display terminal --json` },
                  { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground', command: `prlt work start ${ticketId} --display foreground --json` },
                  { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background', command: `prlt work start ${ticketId} --display background --json` },
                ],
                default: 'terminal',
              },
            ], jsonModeConfig)
            displayMode = selectedDisplay as DisplayMode
            environment = 'devcontainer'
            environmentSelected = true
          } else {
            // User chose host
            environment = 'host'
            // eslint-disable-next-line no-await-in-loop -- Follow-up prompt after selection
            const { selectedDisplay } = await this.prompt<{ selectedDisplay: string }>([
              {
                type: 'list',
                name: 'selectedDisplay',
                message: 'How should the agent output be displayed?',
                choices: [
                  { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal', command: `prlt work start ${ticketId} --display terminal --run-on-host --json` },
                  { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground', command: `prlt work start ${ticketId} --display foreground --run-on-host --json` },
                  { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background', command: `prlt work start ${ticketId} --display background --run-on-host --json` },
                ],
                default: 'terminal',
              },
            ], jsonModeConfig)
            displayMode = selectedDisplay as DisplayMode
            environmentSelected = true
          }
        }
      } else if (useDevcontainer) {
        // Devcontainer with explicit display flag
        environment = 'devcontainer'
        if (flags.display) {
          displayMode = flags.display as DisplayMode
        } else {
          // Default to terminal for devcontainer (opens new tab instead of blocking current terminal)
          displayMode = 'terminal'
        }
      } else {
        // No devcontainer or --run-on-host - host mode selection
        environment = 'host'
        if (flags.display) {
          displayMode = flags.display as DisplayMode
        } else {
          const warningMsg = flags['run-on-host']
            ? 'Select display mode (--run-on-host: bypassing devcontainer):'
            : 'Select display mode (no devcontainer - running on host):'

          // Use FlagResolver for display mode selection
          const displayResolver = new FlagResolver<{ display?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
            accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
          })

          displayResolver.addPrompt({
            flagName: 'display',
            type: 'list',
            message: warningMsg,
            default: 'terminal',
            choices: () => [
              { name: '🖥️  New tab      - Opens in new terminal tab (recommended)', value: 'terminal' },
              { name: '▶️  Foreground  - Run in current terminal (blocking)', value: 'foreground' },
              { name: '📦 Background  - Runs detached, reattach with: prlt session attach', value: 'background' },
            ],
          })

          const displayResult = await displayResolver.resolve()
          displayMode = displayResult.display as DisplayMode
        }
      }

      const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor

      // Default to interactive output mode (streaming UI)
      // Can be overridden via --output flag if needed
      const outputMode: OutputMode = flags.output as OutputMode || DEFAULT_EXECUTION_CONFIG.outputMode

      // Track whether user explicitly chose to use API key instead of OAuth
      let useApiKey = flags['use-api-key'] || false

      // Auth method resolution for devcontainer environment
      // Only needed for Claude Code executor - other executors handle auth differently
      if (environment === 'devcontainer' && !useApiKey && isClaudeExecutor(executor)) {
        // First, verify Docker daemon is actually running before checking credentials.
        // dockerCredentialsExist() runs a Docker command that fails silently when the daemon
        // is down, which would trigger a misleading OAuth credentials warning.
        if (!isDockerRunning()) {
          this.log('')
          this.log(styles.warning('Docker daemon is not running. Start Docker Desktop or use --run-on-host.'))
          this.log('')

          if (flags.yes || !process.stdout.isTTY) {
            // Non-interactive mode: error instead of silently falling back to host
            db.close()
            this.error(
              'Cannot start in Docker — Docker daemon is not running.\n' +
              'Start Docker Desktop, or use --run-on-host to explicitly run on host.'
            )
          } else {
            const dockerChoices: Array<{ name: string; value: string }> = [
              { name: '💻 Switch to host environment', value: 'host' },
              { name: '✗  Cancel', value: 'cancel' },
            ]
            const dockerMessage = 'Docker is not running. What would you like to do?'

            const jsonBaseDocker = buildJsonBase(ticketId!, flags as Record<string, unknown>)
            const dockerResolver = new FlagResolver<{ dockerAction?: string }>({
              commandName: 'work start',
              baseCommand: `prlt work start ${ticketId}`,
              jsonMode,
              flags: {},
              accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
            })

            dockerResolver.addPrompt({
              flagName: 'dockerAction',
              type: 'list',
              message: dockerMessage,
              choices: () => dockerChoices,
              getCommand: (value) => {
                if (value === 'host') return `${jsonBaseDocker} --run-on-host --json`
                return ''
              },
            })

            const dockerResult = await dockerResolver.resolve()
            const dockerAction = dockerResult.dockerAction

            if (dockerAction === 'cancel') {
              db.close()
              this.log(styles.muted('Cancelled.'))
              return
            }

            environment = 'host'
            this.log(styles.muted('Switched to host environment.'))
          }
        }

        // Only check credentials if Docker is running and still using devcontainer
        if (environment === 'devcontainer') {
        // Check for saved auth method preference
        const savedAuthMethod = getAuthMethod(db)
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY

        if (savedAuthMethod === 'apikey') {
          // Saved preference: API key — validate it's still set
          if (!hasApiKey) {
            this.log('')
            this.log(styles.warning('⚠️  Saved auth method is "apikey" but ANTHROPIC_API_KEY is not set in your environment.'))
            this.log(styles.muted('   Set the env var or run "' + this.config.bin + ' agent auth" to switch to OAuth.'))
            db.close()
            return
          }
          useApiKey = true
        } else if (savedAuthMethod === 'oauth') {
          // Saved preference: OAuth — validate credentials exist
          const hasCredentials = dockerCredentialsExist()
          if (!hasCredentials) {
            if (flags.yes || !process.stdout.isTTY) {
              // Non-interactive mode: error instead of silently falling back to host
              db.close()
              this.error(
                'Cannot start in Docker — OAuth credentials not found.\n' +
                `Run \`${this.config.bin} agent auth\` to set up credentials, or use --run-on-host to explicitly run on host.`
              )
            } else {
              this.log('')
              this.log(styles.warning('⚠️  Saved auth method is "oauth" but no OAuth credentials found.'))
              this.log(styles.muted('   Run "' + this.config.bin + ' agent auth" to authenticate.'))
              db.close()
              return
            }
          }
          // OAuth credentials valid — continue (useApiKey stays false)
        } else {
          // No saved preference — show auth method menu
          const hasCredentials = dockerCredentialsExist()

          if (hasCredentials) {
            // OAuth credentials exist, use them silently (no menu needed)
            // useApiKey stays false
          } else {
            // No saved preference and no OAuth credentials — prompt user
            if (flags.yes || !process.stdout.isTTY) {
              // Non-interactive mode: error instead of silently falling back to host
              db.close()
              this.error(
                'Cannot start in Docker — OAuth credentials not found.\n' +
                `Run \`${this.config.bin} agent auth\` to set up credentials, or use --run-on-host to explicitly run on host.`
              )
            } else {
              this.log('')
              this.log(styles.warning('⚠️  No Claude Code OAuth credentials found for Docker containers'))
              this.log(styles.muted('   Agents need credentials to authenticate with Claude.'))
              this.log('')

              // Build auth method choices
              const authChoices: Array<{ name: string; value: string }> = [
                { name: `🔐 OAuth (recommended — uses Max subscription)`, value: 'oauth' },
              ]
              if (hasApiKey) {
                authChoices.push({ name: '🔑 API key (uses API credits, not Max subscription)', value: 'apikey' })
              }
              authChoices.push(
                { name: '💻 Switch to host environment instead', value: 'host' },
                { name: '✗  Cancel', value: 'cancel' },
              )

              // Use FlagResolver for auth method selection
              const jsonBaseAuth = buildJsonBase(ticketId!, flags as Record<string, unknown>)
              const authResolver = new FlagResolver<{ authAction?: string }>({
                commandName: 'work start',
                baseCommand: `prlt work start ${ticketId}`,
                jsonMode,
                flags: {},
                accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
              })

              authResolver.addPrompt({
                flagName: 'authAction',
                type: 'list',
                message: 'How should the agent authenticate with Claude?',
                choices: () => authChoices,
                getCommand: (value) => {
                  if (value === 'apikey') return `${jsonBaseAuth} --use-api-key --json`
                  if (value === 'host') return `${jsonBaseAuth} --run-on-host --json`
                  if (value === 'cancel') return ''
                  // oauth — re-run with environment devcontainer (requires interactive auth flow)
                  return `${jsonBaseAuth} --environment devcontainer --json`
                },
              })

              const authResult = await authResolver.resolve()
              const authAction = authResult.authAction

              if (authAction === 'cancel') {
                db.close()
                this.log(styles.muted('Cancelled.'))
                return
              }

              if (authAction === 'host') {
                environment = 'host'
                this.log(styles.muted('Switched to host environment.'))
              } else if (authAction === 'apikey') {
                useApiKey = true
                this.log(styles.warning('Using ANTHROPIC_API_KEY — this will consume API credits.'))
                this.log(styles.muted(`Run "${this.config.bin} agent auth" to set up OAuth and use your Max subscription instead.`))
                this.log('')
              } else if (authAction === 'oauth') {
                this.log('')
                this.log(styles.primary(`Opening ${this.config.bin} agent auth in new tab...`))
                this.log('')

                // Open auth in a new terminal tab
                const authCmd = `${process.argv[1]} agent auth`
                try {
                  execSync(`osascript -e '
                    tell application "iTerm"
                      tell current window
                        create tab with default profile
                        tell current session
                          write text "${authCmd}"
                        end tell
                      end tell
                    end tell
                  '`)
                } catch {
                  // Fallback: try Terminal.app
                  try {
                    execSync(`osascript -e 'tell application "Terminal" to do script "${authCmd}"'`)
                  } catch {
                    this.log(styles.warning('Could not open new terminal tab.'))
                    this.log(styles.muted(`Please run manually: ${authCmd}`))
                  }
                }

                this.log(styles.muted('Complete the /login flow in the new tab, then press Enter here...'))
                this.log('')

                // Wait for user to complete auth
                await this.prompt<{ done: string }>([{
                  type: 'input',
                  name: 'done',
                  message: 'Press Enter when authentication is complete:',
                }])

                // Check if credentials now exist
                if (!dockerCredentialsExist()) {
                  this.log('')
                  this.log(styles.warning('Authentication did not complete. No credentials found.'))
                  db.close()
                  return
                }
                const info = getDockerCredentialInfo()
                this.log('')
                this.log(styles.success('✓ Credentials configured'))
                if (info) {
                  this.log(styles.muted(`   Subscription: ${info.subscriptionType || 'unknown'}`))
                  this.log(styles.muted(`   Expires: ${info.expiresAt.toLocaleDateString()}`))
                }
                this.log('')
              }

              // Prompt "Save as default?" after a successful auth method choice
              // (only if they chose oauth or apikey, not host/cancel)
              if (authAction === 'oauth' || authAction === 'apikey') {
                const saveChoices = [
                  { name: 'Yes — skip this menu next time', value: true },
                  { name: 'No — ask me each time', value: false },
                ]
                const saveMessage = 'Save as default auth method?'

                const saveResolver = new FlagResolver<{ saveDefault?: boolean }>({
                  commandName: 'work start',
                  baseCommand: `prlt work start ${ticketId}`,
                  jsonMode,
                  flags: {},
                  accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
                })

                saveResolver.addPrompt({
                  flagName: 'saveDefault',
                  type: 'list',
                  message: saveMessage,
                  default: true,
                  choices: () => saveChoices,
                })

                const saveResult = await saveResolver.resolve()
                if (saveResult.saveDefault) {
                  const methodToSave = authAction === 'apikey' ? 'apikey' as const : 'oauth' as const
                  saveAuthMethod(db, methodToSave)
                  this.log(styles.muted(`Auth method saved: ${methodToSave}. Will skip this menu next time.`))
                  this.log('')
                }
              }
            }
          }
        }
        }
      }

      // Pass API key preference to execution context
      if (useApiKey) {
        context.useApiKey = true
      }

      // Prompt for permissions mode (all environments)
      // Use FlagResolver to handle both JSON mode and interactive prompts consistently
      // Non-code-modifying actions (review, groom) default to safe mode
      // to prevent agents from performing destructive operations like merging PRs
      const actionModifiesCode = context.modifiesCode !== false
      const defaultPermissionMode = actionModifiesCode ? 'danger' : 'safe'

      if (flags['permission-mode']) {
        permissionMode = (flags['permission-mode'] || 'danger') as PermissionMode
      } else if (!actionModifiesCode) {
        // Non-code-modifying actions automatically use safe mode
        permissionMode = 'safe'
      } else {
        const containerNote = environment === 'devcontainer'
          ? ' (container provides additional isolation)'
          : ''

        // Create resolver for permission-mode flag
        const permissionResolver = new FlagResolver<{ 'permission-mode'?: string }>({
          commandName: 'work start',
          baseCommand: `prlt work start ${ticketId}`,
          jsonMode,
          flags: { 'permission-mode': flags['permission-mode'] },
          accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
        })

        const executorName = getExecutorDisplayName(executor)
        permissionResolver.addPrompt({
          flagName: 'permission-mode',
          type: 'list',
          message: `Permission mode for ${executorName}${containerNote}:`,
          default: defaultPermissionMode,
          choices: () => [
            { name: '⚠️  danger - Skip permission checks (faster, container provides isolation)', value: 'danger' },
            { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
          ],
          when: (ctx) => !ctx.flags['permission-mode'],
        })

        const resolvedPermission = await permissionResolver.resolve()
        permissionMode = (resolvedPermission['permission-mode'] || 'danger') as PermissionMode
      }

      // Prompt for PR creation when work is complete
      // Resolution order: explicit flags > workspace config default > interactive prompt
      let createPR = false
      let prModeSource = 'default' // Track where PR mode was resolved from for display
      const ghInstalled = isGHInstalled()
      const ghAuthenticated = ghInstalled && isGHAuthenticated()
      const ghAvailable = ghInstalled && ghAuthenticated
      const configPrDefault = getCreatePrDefault(db)

      if (flags['create-pr']) {
        createPR = true
        prModeSource = 'flag --create-pr'
      } else if (flags['no-pr']) {
        createPR = false
        prModeSource = 'flag --no-pr'
      } else if (context.modifiesCode === false) {
        // Non-code-modifying actions (groom, review, resolve) default to no PR
        createPR = false
        prModeSource = 'action (non-code-modifying)'
      } else if (configPrDefault !== null) {
        // Workspace config default is set - use it deterministically
        createPR = configPrDefault
        prModeSource = 'workspace config (execution.create_pr_default)'
      } else if (ghAvailable) {
        if (jsonMode && flags.yes) {
          // In JSON mode with --yes, default to creating PR for code-modifying actions
          createPR = true
          prModeSource = 'default (--json --yes)'
        } else {
          // Use FlagResolver for PR choice
          const jsonBasePr = buildJsonBase(ticketId!, flags as Record<string, unknown>)
          const prResolver = new FlagResolver<{ prChoice?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
            accumulatedFlags: getAccumulatedFlags(flags as Record<string, unknown>),
          })

          prResolver.addPrompt({
            flagName: 'prChoice',
            type: 'list',
            message: 'Create a pull request when work is ready?',
            default: 'yes',
            choices: () => [
              { name: '✓ Yes - Create PR when running `prlt work ready`', value: 'yes' },
              { name: '✗ No  - Just move ticket to review (can create PR later)', value: 'no' },
            ],
            getCommand: (value) => {
              if (value === 'yes') return `${jsonBasePr} --create-pr --json`
              return `${jsonBasePr} --json`
            },
          })

          const prResult = await prResolver.resolve()
          createPR = prResult.prChoice === 'yes'
          prModeSource = 'interactive prompt'
        }
      } else {
        prModeSource = ghInstalled
          ? 'default (gh auth required — run `gh auth login`)'
          : 'default (gh CLI not installed)'
      }

      // R1: Show clear PR mode in preflight summary
      // R2: Show strong warning when --no-pr is active
      if (!jsonMode) {
        this.log('')
        this.log(styles.header(`🚀 Starting work: ${ticket.id}: ${ticket.title}`))
        this.log(styles.muted(`   Agent: ${assignedAgent}`))
        this.log(styles.muted(`   Action: ${context.actionName || 'None'}`))
        this.log(styles.muted(`   Executor: ${executor}`))

        // Environment info
        const envIcon = environment === 'devcontainer' ? '🐳' : '💻'
        this.log(styles.muted(`   Environment: ${envIcon} ${environment}`))
        this.log(styles.muted(`   Display: ${displayMode}`))

        // Permissions info
        if (permissionMode === 'safe') {
          this.log(styles.success(`   Permissions: 🔒 safe`))
        } else {
          this.log(styles.warning(`   Permissions: ⚠️  danger (--dangerously-skip-permissions)`))
        }

        this.log(styles.muted(`   Output: ${outputMode === 'interactive' ? `streaming (watch ${getExecutorDisplayName(executor)} work)` : 'print (final result only)'}`))

        // PR mode with clear source indication
        if (createPR) {
          this.log(styles.success(`   PR mode: create-pr (${prModeSource})`))
        } else {
          this.log(styles.warning(`   PR mode: no-pr (${prModeSource})`))
        }

        // Strong warning when no-pr is active
        if (!createPR && context.modifiesCode !== false) {
          this.log('')
          this.log(styles.warning(`   ⚠️  WARNING: PR creation is DISABLED. Branch will be pushed but NO pull request will be created.`))
          this.log(styles.warning(`   To create a PR later: prlt pr create ${ticketId}`))
        }

        // Review gate mode display (shows after PR mode, before worktree)
        // Deferred to after context is built since reviewGate is resolved below

        this.log(styles.muted(`   Worktree: ${worktreePath}`))
        this.log(styles.muted(`   Branch: ${branch}`))
        this.log('')
      }

      // R2: Include PR mode warning in JSON metadata
      if (jsonMode && !createPR && context.modifiesCode !== false) {
        // This will be included in the metadata of the JSON output at the end
        // We log a warning here for non-JSON consumers that may be watching stderr
        this.warn(`PR creation is DISABLED (${prModeSource}). Branch will be pushed without a PR. To create later: prlt pr create ${ticketId}`)
      }

      // Add createPR to context
      context.createPR = createPR

      // Resolve verify-ci: flag > workspace config > default false
      // Only meaningful when createPR is true (need a PR to poll CI on)
      let verifyCi = false
      if (flags['verify-ci']) {
        verifyCi = true
      } else {
        const configVerifyCi = getVerifyCiDefault(db)
        if (configVerifyCi !== null) {
          verifyCi = configVerifyCi
        }
      }
      context.verifyCi = verifyCi

      // Resolve review gate mode (most specific wins: spawn flag > action config > workspace default)
      const reviewGate = resolveReviewGate(
        flags['review-gate'] as ReviewGateMode | undefined,
        selectedAction?.reviewGate,
        db,
      )
      context.reviewGate = reviewGate

      // Auto mode implies no PR (ships directly to main)
      if (reviewGate === 'auto') {
        context.createPR = false
      }
      // Post mode implies PR creation (will be auto-merged)
      if (reviewGate === 'post') {
        context.createPR = true
      }

      // Display review gate mode in preflight summary
      if (!jsonMode && reviewGate !== 'required') {
        const gateDescriptions: Record<string, string> = {
          auto: 'ships directly — no human approval needed',
          post: 'ships immediately — human reviews after merge',
        }
        this.log(styles.warning(`   Review gate: ${reviewGate} (${gateDescriptions[reviewGate]})`))
      }

      // Display verify-ci status
      if (!jsonMode && verifyCi && context.createPR) {
        this.log(styles.success(`   CI verify: enabled — agent will poll CI and fix failures before exiting`))
      }

      // Handle git operations
      let finalBranch = branch

      // Set up repo paths (needed for all action types)
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]
      const primaryRepo = gitRepos[0]

      // Always fetch latest from origin (regardless of action type)
      // This ensures groom and other non-code-modifying actions see current code
      for (const repoPath of gitRepos) {
        if (isGitRepo(repoPath)) {
          tryGitCommand('git fetch origin', repoPath)
        }
      }

      // Branch handling - only if action modifies code
      if (context.modifiesCode !== false) {
        if (isExistingBranch) {
          // Ticket already has a branch linked - just use it
          this.log(styles.muted(`Using existing branch: ${branch}`))
        } else if (flags.action || flags.force || jsonMode) {
          // Non-interactive / JSON mode - auto-create branch
          // JSON mode agents can't interactively enter branch names
          finalBranch = branch
          this.log(styles.muted(`Branch: ${finalBranch}`))
        } else {
          // No branch in DB - ask user if one already exists
          // Use FlagResolver for branch choice
          const branchResolver = new FlagResolver<{ branchChoice?: string }>({
            commandName: 'work start',
            baseCommand: `prlt work start ${ticketId}`,
            jsonMode,
            flags: {},
          })

          branchResolver.addPrompt({
            flagName: 'branchChoice',
            type: 'list',
            message: `Does a branch already exist for ${ticket.id}?`,
            default: 'create',
            choices: () => [
              { name: 'No, create new branch (Recommended)', value: 'create' },
              { name: 'Yes, I\'ll enter the branch name', value: 'enter' },
              { name: 'Search for matching branches', value: 'search' },
            ],
          })

          const branchResult = await branchResolver.resolve()
          const branchChoice = branchResult.branchChoice

          if (branchChoice === 'enter') {
            // User enters existing branch name
            const { enteredBranch } = await this.prompt<{ enteredBranch: string }>([
              {
                type: 'input',
                name: 'enteredBranch',
                message: 'Enter branch name:',
                validate: (input: unknown) => (input as string).trim() ? true : 'Branch name required',
              },
            ], jsonModeConfig)
            finalBranch = enteredBranch.trim()

            // Validate branch exists (locally or in origin)
            try {
              execSync(`git rev-parse --verify ${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
              this.log(styles.muted(`   Found local branch: ${finalBranch}`))
            } catch {
              // Try fetching from origin
              try {
                execSync(`git fetch origin ${finalBranch}:${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
                this.log(styles.muted(`   Fetched from origin: ${finalBranch}`))
              } catch {
                this.warn(`Branch "${finalBranch}" not found locally or in origin. Will create it.`)
              }
            }
          } else if (branchChoice === 'search') {
            // Search for matching branches
            let remoteBranches: string[] = []
            try {
              execSync('git fetch --prune', { cwd: primaryRepo, stdio: 'pipe' })
              const branchOutput = execSync(`git branch -r`, { cwd: primaryRepo, encoding: 'utf-8' })
              remoteBranches = branchOutput
                .split('\n')
                .map(b => b.trim())
                .filter(b => b && !b.includes('HEAD') && b.toLowerCase().includes(ticket.id.toLowerCase()))
            } catch {
              // Ignore fetch errors
            }

            if (remoteBranches.length > 0) {
              const branchChoices = [
                ...remoteBranches.map(b => ({ name: b, value: b.replace('origin/', ''), command: `prlt work start ${ticketId} --json` })),
                { name: '── None of these, create new branch ──', value: '__create__', command: `prlt work start ${ticketId} --json` },
              ]

              const { selectedBranch } = await this.prompt<{ selectedBranch: string }>([
                {
                  type: 'list',
                  name: 'selectedBranch',
                  message: `Found ${remoteBranches.length} matching branch(es):`,
                  choices: branchChoices,
                },
              ], jsonModeConfig)

              if (selectedBranch !== '__create__') {
                finalBranch = selectedBranch
                // Fetch and checkout the selected branch
                try {
                  execSync(`git fetch origin ${finalBranch}:${finalBranch}`, { cwd: primaryRepo, stdio: 'pipe' })
                  this.log(styles.muted(`   Fetched: ${finalBranch}`))
                } catch {
                  // Branch might already exist locally
                }
              }
            } else {
              this.log(styles.muted(`   No matching branches found for "${ticket.id}". Creating new.`))
            }
          }
          // branchChoice === 'create' uses the generated branch name (default)

          this.log(styles.muted(`Branch: ${finalBranch}`))
        }

        // Handle branch in each repo
        for (const repoPath of gitRepos) {
          const repoName = path.basename(repoPath)

          if (!isGitRepo(repoPath)) {
            continue
          }

          // Note: fetch already happened above (unconditionally for all action types)

          if (reusingWorktree) {
            // Branch already checked out in this worktree — just fetch latest
            this.log(styles.muted(`   ${repoName}: reusing existing branch (worktree recovery)`))
          } else {
            // Prune stale worktree references before branch operations
            pruneWorktrees(repoPath)

            const baseBranch = findBaseBranch(repoPath)
            const checkoutError = checkoutBranchSafe(finalBranch, baseBranch, repoPath)
            if (checkoutError) {
              this.warn(`${repoName}: ${checkoutError}`)
            } else {
              this.log(styles.muted(`   ${repoName}: branch ready`))
            }
          }
        }

        // Save branch to ticket (skip for external-only tickets — no PMO record)
        if (!isExternalOnly && (!isExistingBranch || finalBranch !== branch)) {
          await this.storage.updateTicket(ticket.id, { branch: finalBranch })
        }

        // Update context with final branch
        context.branch = finalBranch
      } else {
        // Non-code-modifying action (e.g., groom) - checkout main/latest to see current code
        this.log(styles.muted('Skipping branch creation (action does not modify code)'))

        for (const repoPath of gitRepos) {
          const repoName = path.basename(repoPath)

          if (!isGitRepo(repoPath)) {
            continue
          }

          try {
            // Checkout the latest main/master branch
            const baseBranch = findBaseBranch(repoPath)
            // Extract local branch name from origin/main -> main
            const localBranch = baseBranch.replace('origin/', '')
            execSync(`git checkout ${localBranch}`, { cwd: repoPath, stdio: 'pipe' })
            // Pull latest changes
            tryGitCommand(`git pull origin ${localBranch}`, repoPath)
            this.log(styles.muted(`   ${repoName}: checked out ${localBranch} (latest)`))
          } catch (error) {
            this.warn(`Could not checkout main in ${repoName}: ${error instanceof Error ? error.message : error}`)
          }
        }
      }

      // Resolve cleanup policy from flags (PRLT-1061)
      const cleanupPolicy: CleanupPolicy = flags['keep-alive']
        ? 'persistent'
        : (flags.cleanup as CleanupPolicy) || getCleanupPolicy(db, context.actionId)

      // Create execution record
      const ticketExternalMetadata = getTicketExternalMetadata(ticket)
      const execution = executionStorage.createExecution({
        ticketId: ticket.id,
        agentName: assignedAgent,
        executor,
        environment,
        displayMode,
        permissionMode,
        cleanupPolicy,
        branch,
        externalSource: ticketExternalMetadata.source,
        externalKey: ticketExternalMetadata.key,
        externalId: ticketExternalMetadata.id,
        externalUrl: ticketExternalMetadata.url,
      })

      if (!jsonMode) {
        this.log(styles.muted(`   Work ID: ${execution.id}`))
        this.log('')
      }

      // Note: Ticket status update moved to after successful spawn (see below)

      // Load execution config from database
      const executionConfig = loadExecutionConfig(db)

      // If terminal display mode, ensure terminal and shell preferences are set (prompts on first use)
      // Also re-prompt if --reconfigure flag is set
      const needsTerminalConfig = displayMode === 'terminal'
      if (needsTerminalConfig) {
        const needsTerminal = !hasTerminalPreference(db)
        const needsShell = !hasShellPreference(db)

        // First-time setup: prompt for both together
        if ((needsTerminal || needsShell) && !flags.reconfigure) {
          this.log(styles.header('First-time execution setup'))
          this.log('')
        }

        let terminalApp: TerminalApp
        let shell: Shell

        if (flags.reconfigure) {
          terminalApp = await promptTerminalPreference(db)
          shell = await promptShellPreference(db)
          this.log(styles.success(`   Terminal: ${terminalApp}`))
          this.log(styles.success(`   Shell: ${shell}`))
        } else {
          terminalApp = await getTerminalApp(db)
          shell = await getShell(db)
          this.log(styles.muted(`   Terminal: ${terminalApp}`))
          this.log(styles.muted(`   Shell: ${shell}`))
        }

        executionConfig.terminal.app = terminalApp
        executionConfig.shell = shell
      }

      // Set output mode from user selection
      executionConfig.outputMode = outputMode

      // Set permission mode (determines whether --dangerously-skip-permissions is used)
      executionConfig.permissionMode = permissionMode

      // Handle --focus flag: when set, bring terminal to foreground instead of opening in background
      if (flags.focus) {
        executionConfig.terminal.openInBackground = false
      }

      // Run execution
      if (!jsonMode) {
        this.log(styles.muted('Starting agent...'))
      }
      const sessionManager = (flags.session || 'tmux') as SessionManager
      const result = await runExecution(environment, context, executor, executionConfig, {
        host: flags['vm-host'],
        displayMode,
        sessionManager: environment === 'devcontainer' ? sessionManager : undefined,
      })

      if (result.success) {
        // Track agent spawn analytics
        trackAgentSpawned({
          executor,
          environment,
          action: context.actionId || 'implement',
          ephemeral: isEphemeralAgent,
          provider: ticketExternalMetadata.source || undefined,
        })

        // Enrich telemetry bridge session so agent_completed/agent_errored
        // events report the correct action name
        if (result.sessionId) {
          enrichAgentSession(result.sessionId, context.actionId || 'implement')
        }

        // Register in machine-wide agent registry
        try {
          registerAgent({
            agentName: context.agentName,
            projectPath: workspaceInfo.path,
            sessionId: result.sessionId,
            ticketId: context.ticketId,
          })
        } catch {
          // Non-fatal — registry is best-effort
        }

        // Update execution record with process info
        executionStorage.updateStatus(execution.id, 'running')
        executionStorage.updateProcessInfo(execution.id, {
          pid: result.pid,
          containerId: result.containerId,
          sessionId: result.sessionId,
          logPath: result.logPath,
        })

        // Track container in containers table (for devcontainer environment)
        // PRLT-1077: Only store infrastructure metadata, not lifecycle status.
        // Agent lifecycle state comes from agent_work, not the containers table.
        if (environment === 'devcontainer' && result.containerId) {
          const containerStorage = new ContainerStorage(db)
          containerStorage.upsertContainer({
            agentName: context.agentName,
            dockerId: result.containerId,
            currentExecutionId: execution.id,
          })
        }

        // Update ticket assignee ONLY after successful spawn
        // For external-only tickets, update ticket_ref instead of PMO storage
        if (!ticket.assignee || ticket.assignee !== assignedAgent) {
          if (isExternalOnly) {
            // Update ticket_ref with assignee
            const ticketRefStore = new TicketRefStore(db)
            ticketRefStore.upsert({ id: ticket.id, title: ticket.title, assignee: assignedAgent })
          } else {
            await this.storage.updateTicket(ticket.id, { assignee: assignedAgent })
          }
          this.log(styles.muted(`   Assigned to: ${assignedAgent}`))
        }

        // Move ticket to target column based on action's toState or default 'started' intent
        // Skip PMO board operations for external-only tickets (no PMO record to move)
        if (!isExternalOnly) {
        // If action has a to_state, try direct match first; otherwise use intent resolution
        const targetStateName = selectedAction?.toState

        const board = ticket.projectId ? await this.storage.getProjectBoard(ticket.projectId) : null
        const columnNames = board ? board.columns.map(col => col.name) : []

        let targetColumnName: string | null = null
        if (targetStateName) {
          // Try direct state name match first (backward compat with action toState)
          targetColumnName = findColumnByName(columnNames, targetStateName)
        }

        if (!targetColumnName) {
          // Use intent-based resolution — 'started' intent
          const transition = await moveTicketByIntent({
            db,
            storage: this.storage,
            ticket,
            intent: 'started',
            providerName: 'pmo',
            resolveProvider: (tid, pid) => this.resolveTicketProvider(tid, pid),
            log: (msg) => this.log(styles.muted(`   ${msg}`)),
          })
          if (transition.moved) {
            this.log(styles.muted(`   Moved to: ${transition.targetColumn}`))
          }
        } else if (targetColumnName && ticket.statusName !== targetColumnName) {
          try {
            await this.storage.moveTicket(ticket.projectId!, ticket.id, targetColumnName)
            this.log(styles.muted(`   Moved to: ${targetColumnName}`))
          } catch (moveError) {
            // Non-fatal - work can proceed even if column move fails
            this.warn(`Could not move ticket to "${targetColumnName}": ${moveError instanceof Error ? moveError.message : moveError}`)
          }

          // Sync to external provider (e.g., Linear) if ticket was imported from one
          try {
            const provider = await this.resolveTicketProvider(ticket.id, ticket.projectId!)
            if (provider.name !== 'pmo') {
              const result = await provider.moveTicket(ticket.id, targetColumnName)
              if (result.success) {
                this.log(styles.muted(`   Synced to ${result.provider}: ${targetColumnName}`))
              }
            }
          } catch {
            // Non-fatal — don't block work start for provider sync failures
          }
        }

        await autoExportToBoard(this.pmoPath, this.storage, (msg) => {
          if (!jsonMode) {
            this.log(styles.muted(msg))
          }
        })
        } // end if (!isExternalOnly)

        // Output results
        if (jsonMode) {
          // Output JSON execution result with resolved PR mode and source
          const metadata = createMetadata('work start', flags)
          metadata.resolvedPRMode = createPR ? 'create-pr' : 'no-pr'
          metadata.prModeSource = prModeSource
          if (!createPR && context.modifiesCode !== false) {
            metadata.prWarning = `PR creation is DISABLED (${prModeSource}). Branch will be pushed without a PR. To create later: prlt pr create ${ticketId}`
          }
          outputExecutionResultAsJson(
            [{
              workId: execution.id,
              ticketId: ticket.id,
              agent: assignedAgent,
              sessionId: result.sessionId,
              containerId: result.containerId,
              status: 'running',
            }],
            1,
            0,
            metadata
          )
        } else {
          this.log('')
          this.log(styles.success(`✓ Work started (${execution.id})`))
          this.log('')
          this.log(styles.muted('Commands:'))
          this.log(styles.muted(`  prlt work status              View work status`))
          this.log(styles.muted(`  prlt work ready ${ticketId}     Mark ready for review`))
          this.log(styles.muted(`  prlt work stop ${execution.id}    Stop work`))

          // R5: Post-run reminder when branch is pushed without PR
          if (!createPR && context.modifiesCode !== false) {
            this.log('')
            this.log(styles.warning(`Note: No PR will be auto-created. To create one later:`))
            this.log(styles.warning(`  prlt pr create ${ticketId}`))
          }
        }
      } else {
        executionStorage.updateStatus(execution.id, 'failed')

        // Track primitive spawn failure
        trackPrimitiveExecuted({
          primitive: context.actionId || 'implement',
          durationMs: Date.now() - (((globalThis as Record<string, unknown>).__prlt_command_start as number) || Date.now()),
          success: false,
          errorType: 'spawn_failure',
        })

        // Run post-failure diagnostics to give user actionable info
        const failureDiag = runPreflightChecks({
          environment,
          executor,
          db,
          ticket: { id: ticket.id, title: ticket.title },
          agentDir: context.agentDir,
        })
        const diagErrors = failureDiag.errors

        if (jsonMode) {
          // Output JSON failure result with resolved PR mode and diagnostics
          const failMetadata = createMetadata('work start', flags)
          failMetadata.resolvedPRMode = createPR ? 'create-pr' : 'no-pr'
          failMetadata.prModeSource = prModeSource
          failMetadata.spawnError = result.error || 'Unknown error'
          if (diagErrors.length > 0) {
            failMetadata.diagnostics = diagErrors.map(e => ({
              check: e.name,
              message: e.message,
              fix: e.fix ?? null,
            }))
          }
          outputExecutionResultAsJson(
            [{
              workId: execution.id,
              ticketId: ticket.id,
              agent: assignedAgent,
              status: 'failed',
              error: result.error || 'Unknown error',
            }],
            0,
            1,
            failMetadata
          )
        } else {
          // Build a detailed error message with the spawn error and any diagnostic findings
          const spawnError = result.error || 'Unknown error'
          const errorLines = [`Failed to start work on ${ticket.id}: ${spawnError}`]

          if (diagErrors.length > 0) {
            errorLines.push('')
            errorLines.push('Diagnostics found these issues:')
            for (const diag of diagErrors) {
              errorLines.push(`  ✗ ${diag.label}: ${diag.message}`)
              if (diag.fix) {
                errorLines.push(`    → Fix: ${diag.fix}`)
              }
            }
          }

          errorLines.push('')
          errorLines.push('Tip: Run with --dry-run to validate your environment before spawning.')

          return handleError('START_FAILED', errorLines.join('\n'))
        }
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Run multi-ticket batch spawn: prlt work start TICKET1 TICKET2 TICKET3
   * Spawns agents in parallel with optional --max-parallel concurrency limit.
   */
  private async runMultiTicketBatch(
    ticketIds: string[],
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    db: Database.Database,
    executionStorage: ExecutionStorage,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const jsonMode = shouldOutputJson(flags as { json?: boolean })
    const maxParallel = (flags['max-parallel'] as number | undefined) || ticketIds.length

    if (!jsonMode) {
      this.log('')
      this.log(styles.header(`Batch spawn: ${ticketIds.length} ticket(s)${maxParallel < ticketIds.length ? ` (max ${maxParallel} concurrent)` : ''}`))
      this.log('')
    }

    // Resolve project ID (needed for ticket lookups)
    let projectId = (flags as { project?: string }).project
    projectId = projectId || await this.requireProject({
      jsonMode: jsonMode ? { flags, commandName: 'work start', baseCommand: `prlt work start ${ticketIds.join(' ')}` } : undefined,
    })

    // Resolve all ticket IDs to tickets via provider (handles external IDs like PRLT-xxx)
    type TicketResult = Exclude<Awaited<ReturnType<typeof this.storage.getTicket>>, null>
    const tickets: Array<{ ticket: TicketResult; originalId: string }> = []
    for (const rawId of ticketIds) {
      // Look up ticket through provider — no local PMO fallback
      // eslint-disable-next-line no-await-in-loop
      const tp = await this.resolveTicketProvider(rawId, projectId || '')
      // eslint-disable-next-line no-await-in-loop
      const gr = await tp.getTicket(rawId)
      let ticket = (gr.success && gr.ticket) ? gr.ticket : null

      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket "${rawId}" not found.`, createMetadata('work start', flags))
          db.close()
          return
        }
        this.error(`Ticket "${rawId}" not found.`)
        return // unreachable but helps TS narrowing
      }

      tickets.push({ ticket, originalId: rawId })
    }

    // Build start args that apply to all tickets (same flags for all)
    const buildStartArgs = (ticketId: string, projId: string): string[] => {
      const startArgs: string[] = [ticketId, '--project', projId, '--ephemeral']

      if (flags.action) startArgs.push('--action', flags.action as string)
      if (flags.prompt) startArgs.push('--prompt', flags.prompt as string)
      if (flags.message) startArgs.push('--message', flags.message as string)
      if (flags.display) startArgs.push('--display', flags.display as string)
      if (flags['run-on-host']) startArgs.push('--run-on-host')
      if (flags.executor) startArgs.push('--executor', flags.executor as string)
      if (flags['permission-mode']) startArgs.push('--permission-mode', flags['permission-mode'] as string)
      if (flags['skip-permissions']) startArgs.push('--skip-permissions')
      if (flags['create-pr']) startArgs.push('--create-pr')
      if (flags['no-pr']) startArgs.push('--no-pr')
      if (flags['verify-ci']) startArgs.push('--verify-ci')
      if (flags.session) startArgs.push('--session', flags.session as string)
      if (flags.force) startArgs.push('--force')
      if (flags.focus) startArgs.push('--focus')
      if (flags.clone) startArgs.push('--clone')
      if (flags['review-gate']) startArgs.push('--review-gate', flags['review-gate'] as string)
      if (flags['tool-policy']) startArgs.push('--tool-policy', flags['tool-policy'] as string)
      if (flags['keep-alive']) startArgs.push('--keep-alive')
      if (flags.cleanup) startArgs.push('--cleanup', flags.cleanup as string)
      if (flags['allow-network']) startArgs.push('--allow-network', flags['allow-network'] as string)
      if (flags['use-api-key']) startArgs.push('--use-api-key')
      if (flags.yes) startArgs.push('--yes')

      return startArgs
    }

    let successCount = 0
    let failCount = 0
    const executionResults: Array<{
      workId: string
      ticketId: string
      agent: string
      status: string
      error?: string
    }> = []

    // Spawn agents with concurrency control
    const spawnOne = async (entry: typeof tickets[0]): Promise<void> => {
      const { ticket, originalId } = entry
      try {
        if (!jsonMode) {
          this.log(styles.muted(`Starting ${ticket.id}...`))
        }

        const startArgs = buildStartArgs(ticket.id, ticket.projectId || projectId)
        await this.config.runCommand('work:start', startArgs)

        successCount++
        executionResults.push({
          workId: `WORK-${ticket.id}`,
          ticketId: ticket.id,
          agent: 'ephemeral',
          status: 'running',
        })
      } catch (error) {
        failCount++
        if (!jsonMode) {
          this.log(styles.error(`Failed to start ${originalId}: ${error instanceof Error ? error.message : error}`))
        }
        executionResults.push({
          workId: '',
          ticketId: ticket.id,
          agent: '',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Run with concurrency limit
    if (maxParallel >= tickets.length) {
      // Unlimited: spawn all in parallel
      await Promise.all(tickets.map(entry => spawnOne(entry)))
    } else {
      // Limited concurrency: process in batches
      for (let i = 0; i < tickets.length; i += maxParallel) {
        const batch = tickets.slice(i, i + maxParallel)
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch.map(entry => spawnOne(entry)))
      }
    }

    await autoExportToBoard(this.pmoPath, this.storage, () => {})
    db.close()

    // Output results
    if (jsonMode) {
      const metadata = createMetadata('work start', flags)
      outputExecutionResultAsJson(executionResults, successCount, failCount, metadata)
    } else {
      this.log('')
      this.log(styles.success(`Batch complete: ${successCount} started, ${failCount} failed`))
    }
  }

  /**
   * Run batch mode: spawn work for all unassigned backlog tickets
   */
  private async runBatchMode(
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    db: Database.Database,
    executionStorage: ExecutionStorage,
    flags: { display?: string; executor?: string; 'vm-host'?: string; 'run-on-host': boolean; force: boolean; 'permission-mode'?: string; json?: boolean }
  ): Promise<void> {
    const batchJsonMode = shouldOutputJson(flags as { json?: boolean })
    const batchJsonModeConfig = batchJsonMode ? { flags: flags as Record<string, unknown>, commandName: 'work start' } : null

    // Get all tickets from provider — no local PMO fallback
    const batchProvider = this.resolveProjectProvider('')
    const batchListResult = await batchProvider.listTickets(undefined)
    if (!batchListResult.success) {
      db.close()
      this.log(styles.muted(`Failed to list tickets: ${batchListResult.error}`))
      return
    }
    const allTickets = batchListResult.tickets
    const backlogTickets = allTickets.filter(t =>
      t.statusCategory === 'backlog' || t.statusCategory === 'unstarted' || !t.statusCategory
    )

    if (backlogTickets.length === 0) {
      db.close()
      this.log(styles.muted('No backlog tickets to start.'))
      return
    }

    this.log('')
    this.log(styles.header(`🚀 Batch Start: ${backlogTickets.length} backlog tickets`))
    this.log('')

    // Get staff agents that exist on disk (warns about missing directories)
    const activeStaffAgents = getActiveStaffAgents(workspaceInfo, (msg) => this.log(msg))

    // Clean up stale executions before checking availability (TKT-604)
    const batchCleanedExecutions = executionStorage.cleanupStaleExecutionsDetailed()
    if (batchCleanedExecutions.length > 0) {
      this.log(styles.muted(`   Cleaned up ${batchCleanedExecutions.length} stale execution(s)`))

      // Post-execution hook: validate commits and auto-transition tickets that have PRs to Review
      for (const cleaned of batchCleanedExecutions) {
        try {
          // Resolve agent directory for commit validation (PRLT-984)
          let agentDir: string | undefined
          let repoWorktrees: string[] | undefined
          if (cleaned.agentName) {
            try {
              agentDir = resolveAgentDir(workspaceInfo, cleaned.agentName)
              repoWorktrees = detectRepoWorktrees(agentDir)
            } catch {
              // Agent dir resolution may fail for ephemeral agents that were cleaned up
            }
          }

          const result = await handlePostExecutionTransition(
            {
              ticketId: cleaned.ticketId,
              agentName: cleaned.agentName,
              branch: cleaned.branch,
              agentDir,
              repoWorktrees,
            },
            this.storage,
            db,
          )
          if (result.blockedByValidation) {
            this.log(styles.warning(`   ⚠ ${cleaned.ticketId}: agent completed without meaningful code — ${result.validation?.details}`))
            // Persist validation failure on the execution record
            executionStorage.updateStatus(cleaned.executionId, 'failed', undefined, `Commit validation failed: ${result.validation?.details}`)
          } else if (result.transitioned) {
            const via = result.provider && result.provider !== 'pmo' ? ` via ${result.provider}` : ''
            const validationInfo = result.validation ? ` (${result.validation.details})` : ''
            this.log(styles.muted(`   Auto-transitioned ${cleaned.ticketId}: ${result.fromState} → ${result.toState}${via}${validationInfo}`))
          }
        } catch {
          // Non-fatal
        }
      }
    }

    const busyAgentNames = new Set<string>()
    for (const agent of activeStaffAgents) {
      const runningExecutions = executionStorage.getAgentRunningExecutions(agent.name)
      if (runningExecutions.length > 0) {
        busyAgentNames.add(agent.name)
      }
    }

    const availableAgents = activeStaffAgents.filter(a => !busyAgentNames.has(a.name))

    if (availableAgents.length === 0) {
      db.close()
      if (batchJsonMode) {
        outputErrorAsJson('NO_AVAILABLE_AGENTS', 'No available agents. All agents are busy with other work.', createMetadata('work start', flags as Record<string, unknown>))
        return
      }
      this.error('No available agents. All agents are busy with other work.')
    }

    this.log(styles.muted(`Available agents: ${availableAgents.map(a => a.name).join(', ')}`))
    this.log(styles.muted(`Tickets to spawn: ${backlogTickets.map(t => t.id).join(', ')}`))
    this.log('')

    // Confirm before batch spawning
    const { confirm } = await this.prompt<{ confirm: boolean }>([
      {
        type: 'list',
        name: 'confirm',
        message: `Start work on ${backlogTickets.length} tickets using ${availableAgents.length} available agents?`,
        choices: [
          { name: 'Yes', value: true, command: 'prlt work start --all --json' },
          { name: 'No', value: false, command: '' },
        ],
      },
    ], batchJsonModeConfig)

    if (!confirm) {
      db.close()
      this.log(styles.muted('Cancelled.'))
      return
    }

    // Prompt for permissions mode once for all tickets (TKT-513)
    const batchExecutor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor
    const batchExecutorName = getExecutorDisplayName(batchExecutor)
    let batchPermissionMode: 'danger' | 'safe' = flags['permission-mode'] as 'danger' | 'safe'
    if (!batchPermissionMode) {
      const { permissionMode } = await this.prompt<{ permissionMode: string }>([
        {
          type: 'list',
          name: 'permissionMode',
          message: `Permission mode for ${batchExecutorName}:`,
          choices: [
            { name: '⚠️  danger - Skip permission checks (faster, container provides isolation)', value: 'danger', command: 'prlt work start --all --permission-mode danger --json' },
            { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: 'prlt work start --all --permission-mode safe --json' },
          ],
          default: 'danger',
        },
      ], batchJsonModeConfig)
      batchPermissionMode = permissionMode as 'danger' | 'safe'
    }

    // Check Docker credentials if any agents use devcontainers
    const anyUseDevcontainer = availableAgents.some(agent => {
      const agentDir = resolveAgentDir(workspaceInfo, agent.name)
      return hasDevcontainerConfig(agentDir) && !flags['run-on-host']
    })

    // Track whether user explicitly chose to use API key instead of OAuth
    let batchUseApiKey = false

    // Credential check only applies to Claude Code executor
    if (anyUseDevcontainer && isClaudeExecutor(batchExecutor)) {
      // First, verify Docker daemon is actually running before checking credentials.
      // dockerCredentialsExist() runs a Docker command that fails silently when the daemon
      // is down, which would trigger a misleading OAuth credentials warning.
      if (!isDockerRunning()) {
        this.log('')
        this.log(styles.warning('Docker daemon is not running. Start Docker Desktop or use --run-on-host.'))
        this.log('')

        if (!process.stdout.isTTY) {
          // Non-interactive mode: error instead of silently falling back to host
          db.close()
          this.error(
            'Cannot start in Docker — Docker daemon is not running.\n' +
            'Start Docker Desktop, or use --run-on-host to explicitly run on host.'
          )
        } else {
          const { dockerAction } = await this.prompt<{ dockerAction: string }>([
            {
              type: 'list',
              name: 'dockerAction',
              message: 'Docker is not running. What would you like to do?',
              choices: [
                { name: '💻 Run all agents on host instead (--run-on-host)', value: 'host', command: 'prlt work start --all --run-on-host --json' },
                { name: '✗  Cancel', value: 'cancel', command: '' },
              ],
            },
          ], batchJsonModeConfig)

          if (dockerAction === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          flags['run-on-host'] = true
          this.log(styles.muted('All agents will run on host.'))
        }
      }

      if (!flags['run-on-host']) {
      const hasCredentials = dockerCredentialsExist()
      if (!hasCredentials) {
        if (!process.stdout.isTTY) {
          // Non-interactive mode: error instead of silently falling back to host
          db.close()
          this.error(
            'Cannot start in Docker — OAuth credentials not found.\n' +
            `Run \`${this.config.bin} agent auth\` to set up credentials, or use --run-on-host to explicitly run on host.`
          )
        } else {
          const hasApiKey = !!process.env.ANTHROPIC_API_KEY

          this.log('')
          this.log(styles.warning('⚠️  No Claude Code OAuth credentials found for Docker containers'))
          this.log(styles.muted('   Agents need credentials to authenticate with Claude.'))
          this.log('')

          // Build choices based on available options
          const batchAuthChoices: Array<{ name: string; value: string; command?: string }> = [
            { name: `🔐 Run ${this.config.bin} agent auth now (recommended — uses Max subscription)`, value: 'auth', command: `${this.config.bin} agent auth` },
          ]
          if (hasApiKey) {
            batchAuthChoices.push({ name: '🔑 Use ANTHROPIC_API_KEY (⚠️  uses API credits, not Max subscription)', value: 'apikey', command: '' })
          }
          batchAuthChoices.push(
            { name: '💻 Run all agents on host instead (--run-on-host)', value: 'host', command: 'prlt work start --all --run-on-host --json' },
            { name: '✗  Cancel', value: 'cancel', command: '' },
          )

          const { authAction } = await this.prompt<{ authAction: string }>([
            {
              type: 'list',
              name: 'authAction',
              message: 'What would you like to do?',
              choices: batchAuthChoices,
            },
          ], batchJsonModeConfig)

          if (authAction === 'cancel') {
            db.close()
            this.log(styles.muted('Cancelled.'))
            return
          }

          if (authAction === 'host') {
            flags['run-on-host'] = true
            this.log(styles.muted('All agents will run on host.'))
          } else if (authAction === 'apikey') {
            batchUseApiKey = true
            this.log(styles.warning('Using ANTHROPIC_API_KEY — this will consume API credits.'))
            this.log(styles.muted(`Run "${this.config.bin} agent auth" to set up OAuth and use your Max subscription instead.`))
            this.log('')
          } else if (authAction === 'auth') {
            this.log('')
            this.log(styles.primary(`Opening ${this.config.bin} agent auth in new tab...`))
            this.log('')

            // Open auth in a new terminal tab
            const authCmd = `${process.argv[1]} agent auth`
            try {
              execSync(`osascript -e '
                tell application "iTerm"
                  tell current window
                    create tab with default profile
                    tell current session
                      write text "${authCmd}"
                    end tell
                  end tell
                end tell
              '`)
            } catch {
              // Fallback: try Terminal.app
              try {
                execSync(`osascript -e 'tell application "Terminal" to do script "${authCmd}"'`)
              } catch {
                this.log(styles.warning('Could not open new terminal tab.'))
                this.log(styles.muted(`Please run manually: ${authCmd}`))
              }
            }

            this.log(styles.muted('Complete the /login flow in the new tab, then press Enter here...'))
            this.log('')

            // Wait for user to complete auth
            await this.prompt<{ done: string }>([{
              type: 'input',
              name: 'done',
              message: 'Press Enter when authentication is complete:',
            }], batchJsonModeConfig)

            // Check if credentials now exist
            if (!dockerCredentialsExist()) {
              this.log('')
              this.log(styles.warning('Authentication did not complete. No credentials found.'))
              db.close()
              return
            }
            const info = getDockerCredentialInfo()
            this.log('')
            this.log(styles.success('✓ Credentials configured'))
            if (info) {
              this.log(styles.muted(`   Subscription: ${info.subscriptionType || 'unknown'}`))
              this.log(styles.muted(`   Expires: ${info.expiresAt.toLocaleDateString()}`))
            }
            this.log('')
          }
        }
      }
      }
    }

    // Assign tickets to agents (round-robin)
    const assignments: Array<{ ticket: typeof backlogTickets[0]; agent: typeof availableAgents[0] }> = []
    for (let i = 0; i < backlogTickets.length; i++) {
      const agent = availableAgents[i % availableAgents.length]
      assignments.push({ ticket: backlogTickets[i], agent })
    }

    // Spawn each ticket
    let successCount = 0
    let failCount = 0

    for (const { ticket, agent } of assignments) {
      try {
        this.log(styles.muted(`Starting ${ticket.id} with ${agent.name}...`))

        // Use the work:start command for each ticket
        // Pass --project from ticket to avoid re-prompting for project selection
        // Pass --permission-mode to skip prompts in recursive calls (TKT-513)
        // eslint-disable-next-line no-await-in-loop -- Sequential spawning with user feedback
        await this.config.runCommand('work:start', [
          ticket.id,
          ...(ticket.projectId ? ['--project', ticket.projectId] : []),
          '--display', flags.display || 'background',
          ...(flags.executor ? ['--executor', flags.executor] : []),
          ...(flags['run-on-host'] ? ['--run-on-host'] : []),
          ...(batchUseApiKey ? ['--use-api-key'] : []),
          ...(flags.force ? ['--force'] : []),
          '--permission-mode', batchPermissionMode,
          ...((flags as { clone?: boolean }).clone ? ['--clone'] : []),
        ])

        successCount++
      } catch (error) {
        failCount++
        this.log(styles.error(`Failed to start ${ticket.id}: ${error instanceof Error ? error.message : error}`))
      }
    }

    db.close()

    this.log('')
    this.log(styles.success(`✓ Batch complete: ${successCount} started, ${failCount} failed`))

    const remaining = backlogTickets.length - assignments.length
    if (remaining > 0) {
      this.log(styles.muted(`   ${remaining} ticket(s) remain in backlog (no available agents)`))
    }
  }

  /**
   * Spawn work on a single ticket with non-interactive defaults.
   */
  private async spawnSingleTicket(
    ticket: { id: string; title: string; description?: string; assignee?: string; status?: string; priority?: string; category?: string; branch?: string; epicId?: string; specId?: string; projectId?: string; subtasks?: Array<{ title: string; done: boolean }>; metadata?: Record<string, string> },
    agent: { name: string },
    workspaceInfo: ReturnType<typeof getWorkspaceInfo>,
    executionStorage: ExecutionStorage,
    db: Database.Database,
    flags: {
      force?: boolean
      'run-on-host'?: boolean
      'permission-mode'?: string
      'create-pr'?: boolean
      'no-pr'?: boolean
      'review-gate'?: string
      executor?: string
      session?: string
      'tool-policy'?: string
    }
  ): Promise<void> {
    const agentName = agent.name

    // Note: Ticket assignee update moved to after successful spawn

    // Find agent directory and worktree (handles staff and temp agents)
    const agentDir = resolveAgentDir(workspaceInfo, agentName)
    if (!fs.existsSync(agentDir)) {
      throw new Error(`Agent directory not found: ${agentDir}`)
    }

    // Detect repository worktrees within agent directory
    const repoWorktrees = detectRepoWorktrees(agentDir)
    const worktreePath = resolveWorktreePath(agentDir, repoWorktrees)

    // Get coder name for branch naming (prompts on first use)
    // Use ticket's existing branch or generate a new one
    // Prefer external provider key (e.g. PRLT-1065) over internal TKT ID for branch naming
    const branchTicketId = resolveExternalTicketId(ticket)
    const branch = ticket.branch || generateBranchName(branchTicketId, ticket.title, ticket.category)
    const isExistingBranch = !!ticket.branch

    // Get epic info
    let epicTitle: string | undefined
    if (ticket.epicId) {
      const epic = await this.storage.getEpic(ticket.epicId)
      epicTitle = epic?.title
    }

    // Get default action for batch mode (use 'implement')
    const defaultAction = await this.storage.getAction('implement')

    // Build structured workspace repo info (PRLT-1088)
    const workspaceRepos = buildWorkspaceRepos(agentDir, repoWorktrees)

    // Build context
    const context: ExecutionContext = {
      ticketId: ticket.id,
      externalTicketId: branchTicketId !== ticket.id ? branchTicketId : undefined,
      ticketTitle: ticket.title,
      ticketDescription: ticket.description,
      ticketSubtasks: ticket.subtasks?.map(s => ({ title: s.title, done: s.done })),
      ticketPriority: ticket.priority,
      ticketCategory: ticket.category,
      epicTitle,
      agentName,
      agentDir,
      worktreePath,
      branch,
      hqPath: workspaceInfo.path,
      pmoPath: this.pmoPath,
      repoWorktrees,
      workspaceRepos,   // Structured workspace repo info (PRLT-1088)
      isEphemeral: workspaceInfo.agents.find(a => a.name === agentName)?.type === 'ephemeral',
      createPR: flags['create-pr'] || false,
      reviewGate: resolveReviewGate(
        flags['review-gate'] as ReviewGateMode | undefined,
        defaultAction?.reviewGate,
        db,
      ),
      toolPolicy: flags['tool-policy'],
      // Use 'implement' action for batch mode
      actionId: defaultAction?.id,
      actionName: defaultAction?.name,
      actionPrompt: defaultAction?.prompt,
      actionEndPrompt: defaultAction?.endPrompt,
      modifiesCode: defaultAction?.modifiesCode ?? true,
      networkAllowlist: defaultAction?.networkAllowlist,
      // Connected integrations for prompt injection
      connectedIntegrations: getConnectedIntegrations(db),
    }

    // Use devcontainer by default if available
    const hasDevcontainer = hasDevcontainerConfig(agentDir)
    const useDevcontainer = hasDevcontainer && !flags['run-on-host']

    // Non-interactive defaults
    // Non-code-modifying actions default to safe mode to prevent destructive operations
    const environment: ExecutionEnvironment = useDevcontainer ? 'devcontainer' : 'host'
    const displayMode: DisplayMode = 'terminal'
    const actionModifiesCode = context.modifiesCode !== false
    const permissionMode: PermissionMode = (flags['permission-mode'] as PermissionMode) || (!actionModifiesCode ? 'safe' : 'danger')
    const executor = (flags.executor as ExecutorType) || DEFAULT_EXECUTION_CONFIG.defaultExecutor
    const outputMode: OutputMode = 'interactive'

    // Handle git branch - only if action modifies code
    if (context.modifiesCode !== false) {
      const gitRepos = repoWorktrees.length > 0
        ? repoWorktrees.map(r => path.join(agentDir, r))
        : [worktreePath]

      for (const repoPath of gitRepos) {
        if (!isGitRepo(repoPath)) {
          continue
        }

        // Fetch latest from origin (best-effort, may fail if offline)
        tryGitCommand('git fetch origin', repoPath)

        // Prune stale worktree references before branch operations
        pruneWorktrees(repoPath)

        const baseBranch = findBaseBranch(repoPath)
        const checkoutError = checkoutBranchSafe(branch, baseBranch, repoPath)
        if (checkoutError) {
          this.log(styles.warning(`   ${path.basename(repoPath)}: ${checkoutError}`))
        }
      }

      // Save branch to ticket if newly created
      if (!isExistingBranch) {
        await this.storage.updateTicket(ticket.id, { branch })
      }
    }

    // Resolve cleanup policy (PRLT-1061)
    const cleanupPolicy: CleanupPolicy = getCleanupPolicy(db, context.actionId)

    // Create execution record
    const ticketExternalMetadata = getTicketExternalMetadata(ticket)
    const execution = executionStorage.createExecution({
      ticketId: ticket.id,
      agentName,
      executor,
      environment,
      displayMode,
      permissionMode,
      cleanupPolicy,
      branch,
      externalSource: ticketExternalMetadata.source,
      externalKey: ticketExternalMetadata.key,
      externalId: ticketExternalMetadata.id,
      externalUrl: ticketExternalMetadata.url,
    })

    // Note: Ticket status update moved to after successful spawn

    // Load execution config
    const executionConfig = loadExecutionConfig(db)
    executionConfig.outputMode = outputMode
    executionConfig.permissionMode = permissionMode

    // Run execution
    this.log(styles.muted(`   Starting ${ticket.id} → ${agentName}...`))

    const batchSessionManager = (flags.session || 'tmux') as SessionManager
    const result = await runExecution(environment, context, executor, executionConfig, {
      displayMode,
      sessionManager: environment === 'devcontainer' ? batchSessionManager : undefined,
    })

    if (result.success) {
      executionStorage.updateStatus(execution.id, 'running')
      executionStorage.updateProcessInfo(execution.id, {
        pid: result.pid,
        containerId: result.containerId,
        sessionId: result.sessionId,
        logPath: result.logPath,
      })

      // Register in machine-wide agent registry
      try {
        registerAgent({
          agentName: context.agentName,
          projectPath: workspaceInfo.path,
          sessionId: result.sessionId,
          ticketId: context.ticketId,
        })
      } catch {
        // Non-fatal — registry is best-effort
      }

      // Update ticket assignee ONLY after successful spawn
      if (!ticket.assignee || ticket.assignee !== agentName) {
        await this.storage.updateTicket(ticket.id, { assignee: agentName })
      }

      // Move ticket to In Progress column ONLY after successful spawn — via intent resolution
      const transition = await moveTicketByIntent({
        db,
        storage: this.storage,
        ticket,
        intent: 'started',
        providerName: 'pmo',
        resolveProvider: (tid, pid) => this.resolveTicketProvider(tid, pid),
      })

      await autoExportToBoard(this.pmoPath, this.storage, () => {})

      this.log(styles.success(`   ✓ ${ticket.id} started (${execution.id})`))
    } else {
      executionStorage.updateStatus(execution.id, 'failed')
      // Include diagnostic details in the error message
      const spawnError = result.error || 'Unknown error'
      const diag = runPreflightChecks({
        environment,
        executor,
        db,
        ticket: { id: ticket.id, title: ticket.title },
        agentDir: context.agentDir,
      })
      const diagIssues = diag.errors
      if (diagIssues.length > 0) {
        const details = diagIssues.map(e => `${e.label}: ${e.message}`).join('; ')
        throw new Error(`${spawnError} [${details}]`)
      }
      throw new Error(spawnError)
    }
  }
}
