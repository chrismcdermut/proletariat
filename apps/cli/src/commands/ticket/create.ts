import { Flags } from '@oclif/core';
import * as fs from 'node:fs';
import inquirer from 'inquirer';
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
// Note: inquirer import kept for inquirer.Separator usage in interactive mode
import { styles } from '../../lib/styles.js';
import { updateEpicTicketsSection } from '../../lib/pmo/epic-files.js';
import { TicketTemplate } from '../../lib/pmo/types.js';
import { getWorkspacePriorities } from '../../lib/pmo/utils.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputDryRunSuccessAsJson,
  outputDryRunErrorsAsJson,
  outputPromptAsJson,
  buildPromptConfig,
  createMetadata,
} from '../../lib/prompt-json.js';
import { FlagResolver } from '../../lib/flags/index.js';
import { multiLineInput } from '../../lib/multiline-input.js';
import { isLinearConfigured, loadLinearConfig, getLinearApiKey, LinearClient } from '../../lib/linear/index.js';
import { LinearMapper } from '../../lib/linear/mapper.js';
import { PMO_PRIORITY_TO_LINEAR, LINEAR_PRIORITY_TO_PMO } from '../../lib/linear/types.js';
import { getRegisteredWorkSources } from '../../lib/work-source/config.js';

export default class TicketCreate extends PMOCommand {
  static description = 'Create a new ticket on the PMO board';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --title "Fix login bug" --column Backlog',
    '<%= config.bin %> <%= command.id %> -t "Add feature" -c "In Progress" -p P1',
    '<%= config.bin %> <%= command.id %> --project mobile-app -t "New feature"',
    '<%= config.bin %> <%= command.id %> --epic EPIC-001 -t "Implement auth flow"',
    '<%= config.bin %> <%= command.id %> --title "My ticket" --description-file ./ticket-desc.md',
    '<%= config.bin %> <%= command.id %> --title "My ticket" --description-file -  # Read from stdin',
    '<%= config.bin %> <%= command.id %> --json  # Output column choices as JSON',
    '<%= config.bin %> <%= command.id %> --title "Test" -P PROJ-001 --dry-run --json  # Validate without creating',
    '<%= config.bin %> <%= command.id %> --source linear -t "Fix bug" --team ENG',
    '<%= config.bin %> <%= command.id %> --source pmo -t "Local task" -c Backlog',
  ];

  static flags = {
    ...pmoBaseFlags,
    title: Flags.string({
      char: 't',
      description: 'Ticket title [required for non-interactive]',
    }),
    column: Flags.string({
      char: 'c',
      description: 'Column to place the ticket in',
    }),
    priority: Flags.string({
      char: 'p',
      description: 'Ticket priority (uses workspace priority scale)',
    }),
    category: Flags.string({
      description: 'Ticket category (e.g., bug, feature, refactor)',
    }),
    description: Flags.string({
      char: 'd',
      description: 'Ticket description',
    }),
    'description-file': Flags.string({
      char: 'D',
      description: 'Path to a markdown file for the ticket description (use - for stdin)',
      exclusive: ['description'],
    }),
    id: Flags.string({
      description: 'Custom ticket ID (auto-generated if not provided)',
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: false,
    }),
    epic: Flags.string({
      char: 'e',
      description: 'Link ticket to an epic (e.g., EPIC-001)',
    }),
    template: Flags.string({
      char: 'T',
      description: 'Create from a template (e.g., bug-report, feature-request)',
    }),
    labels: Flags.string({
      char: 'l',
      aliases: ['label'],
      description: 'Labels (comma-separated)',
    }),
    'dry-run': Flags.boolean({
      description: 'Validate inputs without creating ticket (use with --json for structured output)',
      default: false,
    }),
    source: Flags.string({
      description: 'Ticket source: "pmo" for local DB, "linear" for Linear API, or "auto" to detect (default: auto)',
      options: ['auto', 'pmo', 'linear'],
      default: 'auto',
    }),
    team: Flags.string({
      description: 'Linear team key (fallback: PRLT_LINEAR_TEAM)',
    }),
  };

  async execute(): Promise<void> {
    const { flags } = await this.parse(TicketCreate);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Determine ticket source (pmo, linear, or prompt user)
    const resolvedSource = await this.resolveSource(flags, jsonMode);

    // If Linear source is selected, delegate to the Linear creation path
    if (resolvedSource === 'linear') {
      return this.createLinearIssue(flags, jsonMode);
    }

    // PMO path — existing flow
    // Get project and board info (pass JSON mode config for AI agents)
    const projectId = await this.requireProject({
      jsonMode: {
        flags,
        commandName: 'ticket create',
        baseCommand: 'prlt ticket create',
      },
    });
    const board = await this.storage.getBoard(projectId);
    const columns = board.columns.map(c => c.name);
    const projectName = await this.getProjectName(projectId);

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket create', flags));
        return
      }
      this.error(message);
    };

    // Read description from file if --description-file is provided
    if (flags['description-file']) {
      const filePath = flags['description-file'];
      try {
        if (filePath === '-') {
          // Guard: prevent hanging when no input is piped
          if (process.stdin.isTTY) {
            return handleError('DESCRIPTION_FILE_ERROR', 'Cannot read from stdin: no input piped. Use --description-file <path> with a file path instead, or pipe content via: echo "desc" | prlt ticket create --description-file -');
          }
          // Read from stdin
          flags.description = fs.readFileSync(0, 'utf-8');
        } else {
          flags.description = fs.readFileSync(filePath, 'utf-8');
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return handleError('DESCRIPTION_FILE_ERROR', `Failed to read description file "${filePath}": ${errMsg}`);
      }
    }

    // Validate epic if provided
    if (flags.epic) {
      const epic = await this.storage.getEpic(flags.epic);
      if (!epic) {
        return handleError('EPIC_NOT_FOUND', `Epic not found: ${flags.epic}. Use 'prlt epic list' to see available epics.`);
      }
    }

    // Load template if specified
    let template: TicketTemplate | null = null;
    if (flags.template) {
      template = await this.storage.getTicketTemplate(flags.template);
      if (!template) {
        return handleError('TEMPLATE_NOT_FOUND', `Template not found: ${flags.template}. Run 'prlt ticket template list' to see available templates.`);
      }
    }

    // Parse labels from flag
    const labelsFromFlag = flags.labels
      ? flags.labels.split(',').map(l => l.trim()).filter(Boolean)
      : undefined;

    // Get ticket data (interactive or from flags)
    let ticketData: {
      title: string;
      statusName: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
      epicId?: string;
      labels?: string[];
    };

    // Use FlagResolver to handle both JSON mode and interactive prompts
    // This unifies the two code paths into one pattern
    if (!flags.interactive) {
      // In JSON mode, default column to first backlog status if not provided
      // This prevents prompting for column in non-interactive mode
      if (jsonMode && !flags.column) {
        // Prefer "Backlog" column, fall back to first column
        const backlogColumn = columns.find(c => c.toLowerCase() === 'backlog') || columns[0];
        flags.column = backlogColumn;
      }

      const resolver = new FlagResolver<typeof flags>({
        commandName: 'ticket create',
        baseCommand: 'prlt ticket create',
        jsonMode,
        flags,
        context: { projectId },
      });

      // Column selection - prompted first if missing
      resolver.addPrompt({
        flagName: 'column',
        type: 'list',
        message: 'Select column to place the ticket in:',
        choices: () => columns.map(c => ({ name: c, value: c })),
        when: (ctx) => !ctx.flags.column,
      });

      // Title input - prompted after column is set
      resolver.addPrompt({
        flagName: 'title',
        type: 'input',
        message: 'Enter ticket title:',
        when: (ctx) => !ctx.flags.title && ctx.flags.column !== undefined,
        validate: (value) => (value as string).trim() ? true : 'Title cannot be empty',
        context: (ctx) => ({
          hint: `Provide title with: ${ctx.baseCommand}${ctx.projectId ? ` -P ${ctx.projectId}` : ''} --column "${ctx.flags.column}" --title "Your title here"`,
          requiredFields: ['--title'],
          optionalFields: ['--priority', '--category', '--description', '--epic', '--labels'],
          example: `${ctx.baseCommand}${ctx.projectId ? ` -P ${ctx.projectId}` : ''} --column "${ctx.flags.column}" --title "Fix login bug" --priority P1 --category bug`,
        }),
      });

      // Resolve missing flags (in JSON mode, outputs prompt and exits; in interactive mode, prompts user)
      const resolvedFlags = await resolver.resolve();

      // If we get here, we have both column and title
      if (!resolvedFlags.title && !template?.titlePattern) {
        return handleError('TITLE_REQUIRED', 'Title is required. Use --title or -t flag, or use --interactive mode.');
      }

      ticketData = {
        title: resolvedFlags.title || template?.titlePattern || '',
        statusName: resolvedFlags.column || columns[0],
        priority: resolvedFlags.priority || template?.defaultPriority,
        category: resolvedFlags.category || template?.defaultCategory,
        description: resolvedFlags.description || template?.descriptionTemplate,
        id: resolvedFlags.id,
        epicId: resolvedFlags.epic,
        labels: labelsFromFlag || template?.defaultLabels,
      };
    } else {
      // Full interactive mode - use the detailed prompts
      ticketData = await this.promptTicketData(flags, this.storage, template, columns);
    }

    // Validate status/column
    if (!columns.includes(ticketData.statusName)) {
      if (flags['dry-run']) {
        if (jsonMode) {
          outputDryRunErrorsAsJson(
            [{ field: 'column', error: `Invalid column "${ticketData.statusName}". Available: ${columns.join(', ')}` }],
            createMetadata('ticket create', flags)
          );
          return
        }
        this.error(`Invalid column "${ticketData.statusName}". Available columns: ${columns.join(', ')}`);
      }
      return handleError('INVALID_COLUMN', `Invalid column "${ticketData.statusName}". Available columns: ${columns.join(', ')}`);
    }

    // Handle dry-run: show what would be created without actually creating
    if (flags['dry-run']) {
      const wouldCreate = {
        title: ticketData.title,
        project: projectId,
        column: ticketData.statusName,
        ...(ticketData.priority && { priority: ticketData.priority }),
        ...(ticketData.category && { category: ticketData.category }),
        ...(ticketData.description && { description: ticketData.description }),
        ...(ticketData.epicId && { epic: ticketData.epicId }),
        ...(ticketData.labels && ticketData.labels.length > 0 && { labels: ticketData.labels }),
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('ticket', wouldCreate, createMetadata('ticket create', flags));
        return
      }

      // Human-readable dry-run output
      this.log(styles.warning('\n[DRY RUN] Would create ticket:'));
      this.log(styles.muted(`   Title: ${ticketData.title}`));
      this.log(styles.muted(`   Project: ${projectName}`));
      this.log(styles.muted(`   Column: ${ticketData.statusName}`));
      if (ticketData.priority) {
        this.log(styles.muted(`   Priority: ${ticketData.priority}`));
      }
      if (ticketData.category) {
        this.log(styles.muted(`   Category: ${ticketData.category}`));
      }
      if (ticketData.epicId) {
        this.log(styles.muted(`   Epic: ${ticketData.epicId}`));
      }
      if (ticketData.labels && ticketData.labels.length > 0) {
        this.log(styles.muted(`   Labels: ${ticketData.labels.join(', ')}`));
      }
      if (template) {
        this.log(styles.muted(`   Template: ${template.name}`));
        if (template.suggestedSubtasks.length > 0) {
          this.log(styles.muted(`   Subtasks: ${template.suggestedSubtasks.length} would be created`));
        }
      }
      this.log(styles.muted('\n(No ticket was created)'));
      return;
    }

    // Create ticket through the provider (routes to configured backend)
    const provider = this.resolveProjectProvider(projectId, 'pmo');
    const createResult = await provider.createTicket(projectId, {
      id: ticketData.id,
      title: ticketData.title,
      statusName: ticketData.statusName,
      priority: ticketData.priority,
      category: ticketData.category,
      description: ticketData.description,
      epicId: ticketData.epicId,
      labels: ticketData.labels,
    });

    if (!createResult.success || !createResult.ticket) {
      return handleError('CREATE_FAILED', `Failed to create ticket: ${createResult.error}`);
    }

    const ticket = createResult.ticket;

    // Add subtasks from template if applicable
    if (template && template.suggestedSubtasks.length > 0) {
      // Sequential subtask creation for consistent ordering
      for (const subtask of template.suggestedSubtasks) {
        // eslint-disable-next-line no-await-in-loop
        await this.storage.addSubtask(ticket.id, subtask.title);
      }
    }

    // Auto-export to board.md after write
    await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));

    // If linked to an epic, update the epic's markdown file with ticket list
    if (ticketData.epicId) {
      const epic = await this.storage.getEpic(ticketData.epicId);
      if (epic) {
        const epicTickets = await this.storage.getTicketsForEpic(projectId, ticketData.epicId);
        const ticketInfos = epicTickets.map(t => ({
          id: t.id,
          title: t.title,
          status: t.statusName || 'Unknown',
          priority: t.priority,
        }));
        updateEpicTicketsSection(this.pmoPath, ticketData.epicId, epic.status, ticketInfos, projectId);
      }
    }

    // JSON output mode - match MCP tool response shape
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        ticket: {
          id: ticket.id,
          title: ticket.title,
          priority: ticket.priority,
          category: ticket.category,
          statusName: ticket.statusName,
          statusCategory: ticket.statusCategory,
          projectId: ticket.projectId,
          assignee: ticket.assignee,
          owner: ticket.owner,
          branch: ticket.branch,
          epicId: ticket.epicId,
          position: ticket.position,
        },
      }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Created ticket ${styles.emphasis(ticket.id)} in project ${styles.emphasis(projectName)}`));
    if (template) {
      this.log(styles.muted(`   Template: ${template.name}`));
    }
    this.log(styles.muted(`   Title: ${ticket.title}`));
    this.log(styles.muted(`   Status: ${ticket.statusName}`));
    if (ticket.priority) {
      this.log(styles.muted(`   Priority: ${ticket.priority}`));
    }
    if (ticket.category) {
      this.log(styles.muted(`   Category: ${ticket.category}`));
    }
    if (ticketData.epicId) {
      this.log(styles.muted(`   Epic: ${ticketData.epicId}`));
    }
    if (ticketData.labels && ticketData.labels.length > 0) {
      this.log(styles.muted(`   Labels: ${ticketData.labels.join(', ')}`));
    }
    if (template && template.suggestedSubtasks.length > 0) {
      this.log(styles.muted(`   Subtasks: ${template.suggestedSubtasks.length} created`));
    }
    this.log(styles.muted(`\n   View board: prlt board`));
    this.log(styles.muted(`   List tickets: prlt ticket list`));
  }

  /**
   * Determine whether to route through Linear or PMO based on --source flag
   * and workspace config. When multiple providers are configured and source is
   * 'auto', prompts the user (or outputs JSON for agents) to choose.
   */
  private async resolveSource(
    flags: { source?: string; json?: boolean },
    jsonMode: boolean
  ): Promise<'pmo' | 'linear'> {
    const source = flags.source || 'auto';

    if (source === 'pmo') return 'pmo';
    if (source === 'linear') return 'linear';

    // auto: check configured providers
    let providerTypes: string[];
    try {
      const db = this.storage.getDatabase();
      const registeredSources = getRegisteredWorkSources(db);
      providerTypes = [...new Set(registeredSources.map(s => s.provider))];
    } catch {
      // workspace_settings table may not exist in older/test databases
      return 'pmo';
    }

    // If only PMO is available, use it directly
    if (providerTypes.length <= 1) return 'pmo';

    // Multiple providers configured — prompt user to select
    const choices = providerTypes.map(p => ({
      name: p === 'pmo' ? 'PMO (local)' : `${p.charAt(0).toUpperCase() + p.slice(1)}`,
      value: p,
    }));
    const message = 'Multiple ticket providers configured. Where should this ticket be created?';

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'source', message, choices),
        createMetadata('ticket create', flags as Record<string, unknown>)
      );
      return 'pmo'
    }

    const { selectedSource } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedSource',
      message,
      choices,
    }]);

    // Only 'linear' gets the special path; everything else falls through to PMO
    return selectedSource === 'linear' ? 'linear' : 'pmo';
  }

  /**
   * Create an issue in Linear instead of the local PMO database.
   * Also creates a local PMO mirror ticket with external metadata
   * and a mapping record for future sync operations.
   */
  private async createLinearIssue(
    flags: Record<string, unknown>,
    jsonMode: boolean
  ): Promise<void> {
    const db = this.storage.getDatabase();

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket create', flags));
        return
      }
      this.error(message);
    };

    // Resolve Linear API key
    const apiKey = getLinearApiKey(db);
    if (!apiKey) {
      return handleError(
        'LINEAR_NOT_CONFIGURED',
        'Linear is not configured. Run "prlt linear setup" first, or configure a Linear provider source.'
      );
    }

    const client = new LinearClient(apiKey);

    // Resolve team
    const linearConfig = loadLinearConfig(db);
    const teamKey = (flags.team as string) || linearConfig?.defaultTeamKey || process.env.PRLT_LINEAR_TEAM;
    if (!teamKey) {
      return handleError(
        'LINEAR_TEAM_REQUIRED',
        'Linear team key is required. Use --team flag or set PRLT_LINEAR_TEAM.'
      );
    }

    const team = await client.getTeamByKey(teamKey);
    if (!team) {
      return handleError('LINEAR_TEAM_NOT_FOUND', `Linear team "${teamKey}" not found.`);
    }

    // Collect title (required)
    let title = flags.title as string | undefined;
    if (!title) {
      if (jsonMode) {
        outputPromptAsJson(
          buildPromptConfig('input', 'title', 'Enter ticket title:', undefined, undefined),
          createMetadata('ticket create', flags)
        );
        return
        // unreachable
      }

      const { inputTitle } = await inquirer.prompt([{
        type: 'input',
        name: 'inputTitle',
        message: 'Enter ticket title:',
        validate: (input: string) => input.trim() ? true : 'Title cannot be empty',
      }]);
      title = inputTitle;
    }

    // Read description from file if --description-file is provided
    let description = flags.description as string | undefined;
    if (flags['description-file']) {
      const filePath = flags['description-file'] as string;
      try {
        if (filePath === '-') {
          if (process.stdin.isTTY) {
            return handleError('DESCRIPTION_FILE_ERROR', 'Cannot read from stdin: no input piped.');
          }
          description = fs.readFileSync(0, 'utf-8');
        } else {
          description = fs.readFileSync(filePath, 'utf-8');
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return handleError('DESCRIPTION_FILE_ERROR', `Failed to read description file "${filePath}": ${errMsg}`);
      }
    }

    // Map PMO priority to Linear priority number
    const pmoPriority = flags.priority as string | undefined;
    const linearPriority = pmoPriority ? PMO_PRIORITY_TO_LINEAR[pmoPriority] : undefined;

    // Resolve labels to Linear label IDs
    const labelsInput = flags.labels as string | undefined;
    const labelNames = labelsInput
      ? labelsInput.split(',').map(l => l.trim()).filter(Boolean)
      : [];
    let resolvedLabelIds: string[] | undefined;
    if (labelNames.length > 0) {
      const availableLabels = await client.listLabels(team.id);
      resolvedLabelIds = [];
      for (const name of labelNames) {
        const match = availableLabels.find(l => l.name.toLowerCase() === name.toLowerCase());
        if (match) {
          resolvedLabelIds.push(match.id);
        } else if (!jsonMode) {
          this.log(styles.warning(`   Warning: Label "${name}" not found in Linear — skipping.`));
        }
      }
      if (resolvedLabelIds.length === 0) resolvedLabelIds = undefined;
    }

    const category = flags.category as string | undefined;

    // Handle dry-run
    if (flags['dry-run']) {
      const wouldCreate = {
        source: 'linear',
        team: teamKey,
        title: title!,
        ...(description && { description }),
        ...(pmoPriority && { priority: pmoPriority, linearPriority }),
        ...(labelNames.length > 0 && { labels: labelNames }),
        ...(category && { category }),
        localMirror: true,
      };

      if (jsonMode) {
        outputDryRunSuccessAsJson('ticket', wouldCreate, createMetadata('ticket create', flags));
        return
      }

      this.log(styles.warning('\n[DRY RUN] Would create Linear issue:'));
      this.log(styles.muted(`   Team: ${teamKey}`));
      this.log(styles.muted(`   Title: ${title}`));
      if (pmoPriority) {
        this.log(styles.muted(`   Priority: ${pmoPriority} (Linear: ${linearPriority})`));
      }
      if (labelNames.length > 0) {
        this.log(styles.muted(`   Labels: ${labelNames.join(', ')}`));
      }
      if (category) {
        this.log(styles.muted(`   Category: ${category}`));
      }
      if (description) {
        const shortDesc = description.split('\n')[0].substring(0, 60);
        this.log(styles.muted(`   Description: ${shortDesc}${description.length > 60 ? '...' : ''}`));
      }
      this.log(styles.muted(`   Local mirror: yes (PMO ticket will be created)`));
      this.log(styles.muted('\n(No issue was created)'));
      return;
    }

    // Create the issue in Linear
    const issue = await client.createIssue({
      teamId: team.id,
      title: title!,
      description,
      priority: linearPriority,
      labelIds: resolvedLabelIds,
    });

    // Create a local PMO mirror ticket with external metadata
    let pmoTicketId: string | undefined;
    try {
      const projectId = await this.requireProject({
        jsonMode: {
          flags,
          commandName: 'ticket create',
          baseCommand: 'prlt ticket create',
        },
      });

      // Build description with Linear reference
      const mirrorDescription = [
        description || '',
        '',
        '---',
        `_Created in Linear: [${issue.identifier}](${issue.url})_`,
      ].join('\n').trim();

      // Map Linear priority back to PMO priority
      const mirrorPriority = pmoPriority || LINEAR_PRIORITY_TO_PMO[issue.priority] || undefined;

      const pmoTicket = await this.storage.createTicket(projectId, {
        title: issue.title,
        description: mirrorDescription,
        priority: mirrorPriority,
        category,
        labels: labelNames.length > 0 ? labelNames : issue.labels.map(l => l.name),
        metadata: {
          'external_source': 'linear',
          'external_id': issue.id,
          'external_key': issue.identifier,
          'external_url': issue.url,
          'linear.issue_id': issue.id,
          'linear.identifier': issue.identifier,
          'linear.url': issue.url,
          'linear.team': issue.team.key,
          'linear.state': issue.state.name,
        },
      });

      pmoTicketId = pmoTicket.id;

      // Create mapping record for sync operations
      const mapper = new LinearMapper(db);
      mapper.createMapping({
        pmoTicketId: pmoTicket.id,
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        linearTeamKey: issue.team.key,
        linearUrl: issue.url,
        syncDirection: 'outbound',
        createdAt: new Date(),
      });

      // Auto-export to board.md
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)));
    } catch (error: unknown) {
      // Linear issue was created successfully — log a warning but don't fail
      if (!jsonMode) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.log(styles.warning(`   Warning: Linear issue created but local PMO mirror failed: ${errMsg}`));
      }
    }

    // JSON output
    if (jsonMode) {
      this.log(JSON.stringify({
        success: true,
        source: 'linear',
        issue: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          state: issue.state.name,
          team: issue.team.key,
          priority: issue.priority,
        },
        ...(pmoTicketId && { pmoTicketId }),
      }, null, 2));
      return;
    }

    this.log(styles.success(`\n✅ Created Linear issue ${styles.emphasis(issue.identifier)}`));
    this.log(styles.muted(`   Title: ${issue.title}`));
    this.log(styles.muted(`   Team: ${issue.team.name} (${issue.team.key})`));
    this.log(styles.muted(`   State: ${issue.state.name}`));
    if (issue.url) {
      this.log(styles.muted(`   URL: ${issue.url}`));
    }
    if (pmoTicketId) {
      this.log(styles.muted(`   Local mirror: ${pmoTicketId}`));
    }
  }

  private async promptTicketData(
    flags: {
      title?: string;
      column?: string;
      priority?: string;
      category?: string;
      description?: string;
      id?: string;
      epic?: string;
      template?: string;
      labels?: string;
    },
    storage: { listTicketTemplates: () => Promise<TicketTemplate[]> },
    existingTemplate: TicketTemplate | null,
    columns: string[]
  ): Promise<{
    title: string;
    statusName: string;
    priority?: string;
    category?: string;
    description?: string;
    id?: string;
    epicId?: string;
    labels?: string[];
  }> {
    // If no template was specified via flag, offer to select one
    let template = existingTemplate;
    if (!template && !flags.template) {
      const templates = await storage.listTicketTemplates();
      if (templates.length > 0) {
        const { selectedTemplate } = await this.prompt<{ selectedTemplate: string }>([
          {
            type: 'list',
            name: 'selectedTemplate',
            message: 'Start from a template?',
            choices: [
              { name: 'No template (blank ticket)', value: '' },
              new inquirer.Separator('── Templates ──'),
              ...templates.map(t => ({
                name: `${t.name}${t.isBuiltin ? '' : ' [custom]'} - ${t.description || ''}`,
                value: t.id,
              })),
            ],
          },
        ], null);

        if (selectedTemplate) {
          template = templates.find(t => t.id === selectedTemplate) || null;
        }
      }
    }

    // Prompt for title
    const { title: answerTitle } = await this.prompt<{ title: string }>([
      {
        type: 'input',
        name: 'title',
        message: 'Ticket title:',
        default: flags.title || template?.titlePattern,
        validate: (input: unknown) => (input as string).trim() ? true : 'Title cannot be empty',
      },
    ], null);

    // Prompt for column
    const { column: answerColumn } = await this.prompt<{ column: string }>([
      {
        type: 'list',
        name: 'column',
        message: 'Column:',
        choices: columns.map(c => ({ name: c, value: c })),
        default: flags.column || columns[0],
      },
    ], null);

    // Prompt for priority (using workspace priority scale)
    const db = this.storage.getDatabase();
    const workspacePriorities = getWorkspacePriorities(db);
    const { priority: answerPriority } = await this.prompt<{ priority?: string }>([
      {
        type: 'list',
        name: 'priority',
        message: 'Priority:',
        choices: [
          { name: 'None', value: undefined },
          ...workspacePriorities.map(p => ({ name: p, value: p })),
        ],
        default: flags.priority || template?.defaultPriority,
      },
    ], null);

    // Prompt for category
    const { categoryChoice } = await this.prompt<{ categoryChoice: string }>([
      {
        type: 'list',
        name: 'categoryChoice',
        message: 'Category:',
        choices: [
          { name: 'Skip (none)', value: '' },
          new inquirer.Separator('── Conventional Commits ──'),
          { name: 'feature     - New feature or capability', value: 'feature' },
          { name: 'bug         - Bug fix', value: 'bug' },
          { name: 'refactor    - Code refactoring', value: 'refactor' },
          { name: 'docs        - Documentation', value: 'docs' },
          { name: 'test        - Test additions/fixes', value: 'test' },
          { name: 'chore       - Maintenance tasks', value: 'chore' },
          { name: 'performance - Performance improvements', value: 'performance' },
          { name: 'ci          - CI/CD changes', value: 'ci' },
          { name: 'build       - Build system changes', value: 'build' },
          new inquirer.Separator('── Extended Types ──'),
          { name: 'security    - Security fixes', value: 'security' },
          { name: 'database    - Database migrations', value: 'database' },
          { name: 'release     - Release preparation', value: 'release' },
          new inquirer.Separator('── 5Tool Founder ──'),
          { name: 'ship        - Shipping and deployment', value: 'ship' },
          { name: 'growth      - Growth and marketing', value: 'growth' },
          { name: 'support     - Customer experience', value: 'support' },
          { name: 'strategy    - Strategy and planning', value: 'strategy' },
          { name: 'ops         - Business operations', value: 'ops' },
          new inquirer.Separator('───────────────────'),
          { name: 'Custom...', value: '__custom__' },
        ],
        default: flags.category || template?.defaultCategory || '',
      },
    ], null);

    // Custom category prompt if needed
    let customCategory: string | undefined;
    if (categoryChoice === '__custom__') {
      const result = await this.prompt<{ customCategory: string }>([{
        type: 'input',
        name: 'customCategory',
        message: 'Enter custom category:',
        validate: (input: unknown) => (input as string).trim() ? true : 'Category cannot be empty',
      }], null);
      customCategory = result.customCategory;
    }

    const answers = { title: answerTitle, column: answerColumn, priority: answerPriority, categoryChoice, customCategory };

    // Resolve category from choice or custom input
    const category = answers.categoryChoice === '__custom__'
      ? answers.customCategory
      : answers.categoryChoice || undefined;

    // Prompt for structured description (use template description if available)
    const description = await this.promptStructuredDescription(
      flags.description || template?.descriptionTemplate
    );

    // Parse labels from flag or use template defaults
    const labels = flags.labels
      ? flags.labels.split(',').map(l => l.trim()).filter(Boolean)
      : template?.defaultLabels;

    return {
      title: answers.title,
      statusName: answers.column,
      priority: answers.priority || undefined,
      category,
      description: description || undefined,
      id: flags.id,
      epicId: flags.epic,
      labels,
    };
  }

  private async promptStructuredDescription(existingDescription?: string): Promise<string> {
    // If description already provided via flag, use it
    if (existingDescription) {
      return existingDescription;
    }

    this.log(styles.muted('\n─── Ticket Description (for agent execution) ───'));

    // Prompt for "What" - the main outcome
    const { what } = await this.prompt<{ what: string }>([
      {
        type: 'input',
        name: 'what',
        message: 'What is the concrete outcome? (one sentence):',
        validate: (input: unknown) => (input as string).trim() ? true : 'Outcome cannot be empty - what does success look like?',
      },
    ], null);

    // Prompt for acceptance criteria using multiline input
    const doneWhenResult = await multiLineInput({
      message: 'Done when (acceptance criteria):',
      hint: 'Enter each criterion on a new line. Ctrl+D to finish, Ctrl+C to cancel',
    });

    if (doneWhenResult.cancelled) {
      throw new Error('Ticket creation cancelled');
    }

    // Continue with remaining prompts
    const { context } = await this.prompt<{ context: string }>([
      {
        type: 'input',
        name: 'context',
        message: 'Context (files, patterns, hints - optional):',
        default: '',
      },
    ], null);

    const { notInScope } = await this.prompt<{ notInScope: string }>([
      {
        type: 'input',
        name: 'notInScope',
        message: 'Not in scope (explicit exclusions - optional):',
        default: '',
      },
    ], null);

    // Build structured description
    const parts: string[] = [];

    parts.push(`## What\n${what}`);

    if (doneWhenResult.value.trim()) {
      // Ensure each line in doneWhen starts with - [ ] if it doesn't already
      const criteria = doneWhenResult.value
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          if (line.startsWith('- [ ]') || line.startsWith('- [x]')) {
            return line;
          }
          if (line.startsWith('-')) {
            return `- [ ]${line.slice(1)}`;
          }
          return `- [ ] ${line}`;
        })
        .join('\n');
      parts.push(`## Done when\n${criteria}`);
    }

    if (context.trim()) {
      parts.push(`## Context\n${context}`);
    }

    if (notInScope.trim()) {
      parts.push(`## Not in scope\n${notInScope}`);
    }

    return parts.join('\n\n');
  }

}
