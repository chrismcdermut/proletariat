import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, type PMOContext } from './pmo-context.js';
import { styles } from '../styles.js';
import { RuntimeCommand } from '../runtime-command.js';
import {
  shouldOutputJson,
  isNonTTY,
  outputPromptAsJson,
  createMetadata,
  type JsonFlags,
} from '../prompt-json.js';
import { withSignalSafePrompt } from '../signal-handler.js';
import { resolveTicketProvider, resolveProjectProvider } from '../providers/resolver.js';
import type { TicketProvider, ProviderStorage } from '../providers/types.js';

// Re-export machineOutputFlags from RuntimeCommand for backward compatibility.
// New code should import from '../runtime-command.js' directly.
export { machineOutputFlags } from '../runtime-command.js';

/**
 * Base flags for JSON/agent mode support
 * Include these in your command's flags by spreading: ...jsonModeFlags
 * @deprecated Use machineOutputFlags instead
 */
export const jsonModeFlags = {
  json: Flags.boolean({
    description: 'Output as JSON for AI agents/scripts',
    default: false,
  }),
  machine: Flags.boolean({
    char: 'm',
    description: 'Output as JSON for AI agents/scripts',
    default: false,
  }),
};

/**
 * Base flags shared by all PMO commands
 * Include these in your command's flags by spreading: ...pmoBaseFlags
 */
export const pmoBaseFlags = {
  project: Flags.string({
    char: 'P',
    description: 'Project ID (uses first project if only one exists)',
  }),
  json: Flags.boolean({
    description: 'Output as JSON for AI agents/scripts',
    default: false,
  }),
  machine: Flags.boolean({
    char: 'm',
    description: 'Output as JSON for AI agents/scripts',
    default: false,
  }),
};

/**
 * Base command class for PMO commands.
 *
 * Extends RuntimeCommand (which provides workspace.db, SettingsStore, HQ resolution)
 * and adds PMO-specific context: ticket storage, provider resolution, project selection.
 *
 * Hierarchy: PromptCommand → RuntimeCommand → PMOCommand
 *
 * Usage:
 * ```typescript
 * import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/base-command.js';
 *
 * export default class MyCommand extends PMOCommand {
 *   static flags = {
 *     ...pmoBaseFlags,
 *     // additional flags...
 *   };
 *
 *   async execute(): Promise<void> {
 *     // Runtime context (this.hqPath, this.db, this.settings) inherited from RuntimeCommand
 *     // PMO context (this.storage, this.pmoPath) added by PMOCommand
 *
 *     // For project-agnostic operations:
 *     const ticket = await this.storage.getTicketById('TKT-123');
 *
 *     // For project-scoped operations:
 *     const projectId = await this.requireProject();
 *     const board = await this.storage.getBoard(projectId);
 *   }
 * }
 * ```
 */
export abstract class PMOCommand extends RuntimeCommand {
  /**
   * PMO context with storage, pmoPath, etc.
   * Available after init() runs (before execute())
   */
  protected pmoContext!: PMOContext;

  /**
   * Flag to track if PMO context was successfully initialized
   */
  private pmoContextInitialized = false;

  /**
   * Cached project ID from -P flag
   */
  private projectFlag?: string;

  /**
   * Logger function for PMO context
   * Can be overridden to customize logging behavior
   */
  protected pmoLogger(msg: string): void {
    this.log(styles.muted(msg));
  }

  /**
   * oclif init hook - runs before the command executes.
   * Calls RuntimeCommand.init() for workspace.db, then initializes PMO context.
   */
  async init(): Promise<void> {
    await super.init();

    // Parse flags to get project ID if provided
    const { flags } = await this.parse(this.constructor as typeof Command);
    this.projectFlag = (flags as { project?: string }).project;

    this.pmoContext = await getPMOContext({
      logger: (msg) => this.pmoLogger(msg),
    });
    this.pmoContextInitialized = true;
  }

  /**
   * Require a project to be selected.
   * Returns projectId that should be passed to storage operations.
   *
   * Priority:
   * 1. If -P flag was provided, uses that
   * 2. If only one project exists, uses that
   * 3. If multiple projects exist, prompts user to select one (or outputs JSON if jsonMode)
   *
   * @param options.filterEmptyProjects - Only show projects with tickets
   * @param options.jsonMode - JSON mode configuration for AI agents
   * @returns The selected project ID - pass this to storage operations
   */
  protected async requireProject(options?: {
    filterEmptyProjects?: boolean;
    jsonMode?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
      baseCommand: string;
    };
  }): Promise<string> {
    // If -P flag was provided, use it
    if (this.projectFlag) {
      return this.projectFlag;
    }

    // Get all projects
    const projects = await this.storage.listProjects();

    if (projects.length === 0) {
      throw new Error('No projects found. Create a project first or connect a provider (e.g., prlt linear connect).');
    }

    // Note: filterEmptyProjects is no longer supported since tickets live in
    // the provider (Linear, Jira, etc.), not local storage.
    let filteredProjects = projects;

    // If only one project, use it
    if (filteredProjects.length === 1) {
      return filteredProjects[0].id;
    }

    // Multiple projects - check for JSON mode
    // Sort projects by leading number in name (e.g., "1. MVP" before "10. Infra")
    const sortedProjects = [...filteredProjects].sort((a, b) => {
      const numA = parseInt(a.name.match(/^(\d+)/)?.[1] || '999', 10);
      const numB = parseInt(b.name.match(/^(\d+)/)?.[1] || '999', 10);
      return numA - numB;
    });

    // Auto-detect non-TTY: switch to JSON mode when no TTY present
    const effectiveJsonMode = options?.jsonMode ?? (isNonTTY()
      ? {
          flags: { json: true } as JsonFlags & Record<string, unknown>,
          commandName: this.id ?? 'unknown',
          baseCommand: `prlt ${(this.id ?? 'unknown').replace(/:/g, ' ')}`,
        }
      : null);

    // If JSON mode is active, output project choices as JSON
    if (effectiveJsonMode && shouldOutputJson(effectiveJsonMode.flags)) {
      const choices = sortedProjects.map(p => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
        command: `${effectiveJsonMode.baseCommand} -P ${p.id} --json`,
      }));
      outputPromptAsJson(
        {
          type: 'list',
          name: 'project',
          message: 'Select project:',
          choices,
        },
        createMetadata(effectiveJsonMode.commandName, effectiveJsonMode.flags)
      );
      return '';
    }

    // Interactive mode - prompt for selection
    const { selectedProjectId } = await withSignalSafePrompt(() =>
      inquirer.prompt([{
        type: 'list',
        name: 'selectedProjectId',
        message: 'Select project:',
        choices: sortedProjects.map(p => ({
          name: `${p.name} (${p.id})`,
          value: p.id,
        })),
      }])
    );

    return selectedProjectId;
  }

  /**
   * Get project name by ID
   */
  protected async getProjectName(projectId: string): Promise<string> {
    const project = await this.storage.getProject(projectId);
    return project?.name || projectId;
  }

  /**
   * Cleanup handler - ensures PMO storage is closed.
   * Calls RuntimeCommand.cleanup() for workspace.db cleanup.
   */
  protected async cleanup(): Promise<void> {
    if (this.pmoContextInitialized && this.pmoContext?.storage) {
      try {
        await this.pmoContext.storage.close();
      } catch {
        // Ignore close errors - storage might already be closed
      }
    }
    await super.cleanup();
  }

  // Convenience getters for common context properties

  /** PMO storage instance */
  protected get storage() {
    return this.pmoContext.storage;
  }

  /** PMO directory path */
  protected get pmoPath() {
    return this.pmoContext.pmoPath;
  }

  /**
   * Resolve the correct ticket provider for a specific ticket.
   * Uses the ticket's metadata to determine whether to route through
   * Linear, Jira, etc. or use local PMO.
   *
   * @param ticketId - The ticket ID to resolve the provider for
   * @param projectId - The project the ticket belongs to
   * @returns The appropriate TicketProvider
   */
  protected async resolveTicketProvider(ticketId: string, projectId: string): Promise<TicketProvider> {
    const db = this.storage.getDatabase();

    // Build metadata from ticket ID pattern. The provider (Linear, Jira, etc.)
    // is the source of truth — no local ticket lookup needed.
    let metadata: Record<string, string> | null = null;
    if (/^[A-Z]+-\d+$/i.test(ticketId)) {
      metadata = {
        external_source: 'linear',
        external_key: ticketId,
      };
    }

    return resolveTicketProvider(
      ticketId,
      projectId,
      db,
      this.storage as unknown as ProviderStorage,
      metadata,
    );
  }

  /**
   * Resolve the correct provider for project-level operations (list, create).
   * Uses workspace configuration to determine the active provider.
   *
   * @param projectId - The project ID
   * @param source - Optional source hint ('pmo', 'linear', or 'auto')
   * @returns The appropriate TicketProvider
   */
  protected resolveProjectProvider(projectId: string, source?: string): TicketProvider {
    const db = this.storage.getDatabase();
    return resolveProjectProvider(
      db,
      this.storage as unknown as ProviderStorage,
      projectId,
      source,
    );
  }
}
