import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, type PMOContext } from './pmo-context.js';
import { styles } from '../styles.js';
import {
  shouldOutputJson,
  outputPromptAsJson,
  createMetadata,
  type JsonFlags,
} from '../prompt-json.js';

/**
 * Base flags shared by all PMO commands
 * Include these in your command's flags by spreading: ...PMOCommand.baseFlags
 */
export const pmoBaseFlags = {
  project: Flags.string({
    char: 'P',
    description: 'Project ID (uses first project if only one exists)',
  }),
};

/**
 * Base command class for PMO commands
 *
 * Provides automatic PMO context initialization and cleanup:
 * - Initializes storage before run() executes
 * - Ensures storage.close() is called even if errors occur
 * - Provides common PMO flags (--project)
 *
 * Storage is project-agnostic - projectId is passed explicitly to operations.
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
 *     // For project-agnostic operations (e.g., get ticket by ID):
 *     const ticket = await this.storage.getTicketById('TKT-123');
 *
 *     // For project-scoped operations, get projectId first:
 *     const projectId = await this.requireProject();
 *     const board = await this.storage.getBoard(projectId);
 *
 *     // Or derive from an entity:
 *     const projectId = ticket.projectId;
 *     await this.storage.moveTicket(projectId, ticket.id, 'Done');
 *   }
 * }
 * ```
 */
export abstract class PMOCommand extends Command {
  /**
   * PMO context with storage, pmoPath, etc.
   * Available after init() runs (before execute())
   */
  protected pmoContext!: PMOContext;

  /**
   * Flag to track if context was successfully initialized
   */
  private contextInitialized = false;

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
   * oclif init hook - runs before the command executes
   * Initializes PMO context with storage access
   */
  async init(): Promise<void> {
    await super.init();

    // Parse flags to get project ID if provided
    const { flags } = await this.parse(this.constructor as typeof Command);
    this.projectFlag = (flags as { project?: string }).project;

    try {
      this.pmoContext = await getPMOContext({
        logger: (msg) => this.pmoLogger(msg),
      });
      this.contextInitialized = true;
    } catch (error) {
      throw error;
    }
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
      throw new Error('No projects found. Run "prlt pmo init" first.');
    }

    // Filter to projects with tickets if requested
    let filteredProjects = projects;
    if (options?.filterEmptyProjects) {
      const projectsWithTickets: typeof projects = [];
      for (const p of projects) {
        const tickets = await this.storage.listTickets(p.id);
        if (tickets.length > 0) {
          projectsWithTickets.push(p);
        }
      }
      filteredProjects = projectsWithTickets;

      if (filteredProjects.length === 0) {
        throw new Error('No projects with tickets found. Create a ticket first.');
      }
    }

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

    // If JSON mode is active, output project choices as JSON
    if (options?.jsonMode && shouldOutputJson(options.jsonMode.flags)) {
      const choices = sortedProjects.map(p => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
        command: `${options.jsonMode!.baseCommand} -P ${p.id} --json`,
      }));
      outputPromptAsJson(
        {
          type: 'list',
          name: 'project',
          message: 'Select project:',
          choices,
        },
        createMetadata(options.jsonMode.commandName, options.jsonMode.flags)
      );
      // outputPromptAsJson calls process.exit, so this is unreachable
      return '';
    }

    // Interactive mode - prompt for selection
    const { selectedProjectId } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedProjectId',
      message: 'Select project:',
      choices: sortedProjects.map(p => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
      })),
    }]);

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
   * Select from a list of items with JSON mode support for AI agents.
   *
   * In JSON mode: outputs choices as JSON with command field and exits
   * In interactive mode: shows prompt and returns selected value
   *
   * @param options Configuration for the selection
   * @returns The selected value (only in interactive mode)
   *
   * @example
   * ```typescript
   * const ticketId = await this.selectFromList({
   *   message: 'Select ticket:',
   *   items: tickets,
   *   getName: (t) => `${t.id}: ${t.title}`,
   *   getValue: (t) => t.id,
   *   getCommand: (t) => `prlt ticket view ${t.id} --json`,
   *   jsonMode: { flags, commandName: 'ticket view' },
   * });
   * ```
   */
  protected async selectFromList<T>(options: {
    /** Prompt message shown to user */
    message: string;
    /** Items to select from */
    items: T[];
    /** Extract display name from item */
    getName: (item: T) => string;
    /** Extract value from item */
    getValue: (item: T) => string;
    /** Build command string for item (should include --json) */
    getCommand: (item: T) => string;
    /** JSON mode config - if provided and flags indicate JSON mode, outputs JSON */
    jsonMode?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
    } | null;
    /** Optional: include a Cancel option */
    allowCancel?: boolean;
    /** Optional: custom cancel value (default: null returned) */
    cancelValue?: string;
  }): Promise<string | null> {
    const {
      message,
      items,
      getName,
      getValue,
      getCommand,
      jsonMode,
      allowCancel = false,
      cancelValue,
    } = options;

    // Build choices with command field
    const choices = items.map(item => ({
      name: getName(item),
      value: getValue(item),
      command: getCommand(item),
    }));

    // Check for JSON mode
    if (jsonMode && shouldOutputJson(jsonMode.flags)) {
      outputPromptAsJson(
        {
          type: 'list',
          name: 'selection',
          message,
          choices,
        },
        createMetadata(jsonMode.commandName, jsonMode.flags)
      );
      // outputPromptAsJson exits, so this is unreachable
      return null;
    }

    // Interactive mode
    const interactiveChoices = choices.map(c => ({
      name: c.name,
      value: c.value,
    }));

    if (allowCancel) {
      interactiveChoices.push(
        { name: '─'.repeat(20), value: '__separator__' } as typeof interactiveChoices[0],
        { name: 'Cancel', value: cancelValue ?? '__cancel__' }
      );
    }

    const { selection } = await inquirer.prompt([{
      type: 'list',
      name: 'selection',
      message,
      choices: interactiveChoices,
    }]);

    if (selection === '__cancel__' || selection === '__separator__') {
      return null;
    }

    return selection;
  }

  /**
   * Prompt for input with JSON mode support for AI agents.
   *
   * In JSON mode: outputs field info as JSON and exits
   * In interactive mode: shows prompt and returns input value
   *
   * @param options Configuration for the input
   * @returns The input value (only in interactive mode)
   */
  protected async promptForInput(options: {
    /** Prompt message shown to user */
    message: string;
    /** Field name for the prompt */
    fieldName: string;
    /** Default value */
    defaultValue?: string;
    /** Validation function */
    validate?: (input: string) => boolean | string;
    /** JSON mode config */
    jsonMode?: {
      flags: JsonFlags & Record<string, unknown>;
      commandName: string;
      /** Hint for how to provide this value */
      commandHint: string;
      /** Example command */
      example?: string;
    } | null;
  }): Promise<string> {
    const { message, fieldName, defaultValue, validate, jsonMode } = options;

    // Check for JSON mode
    if (jsonMode && shouldOutputJson(jsonMode.flags)) {
      outputPromptAsJson(
        {
          type: 'input',
          name: fieldName,
          message,
          default: defaultValue,
          context: {
            hint: jsonMode.commandHint,
            example: jsonMode.example,
          },
        },
        createMetadata(jsonMode.commandName, jsonMode.flags)
      );
      // outputPromptAsJson exits, so this is unreachable
      return '';
    }

    // Interactive mode
    const { value } = await inquirer.prompt([{
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
      validate,
    }]);

    return value;
  }

  /**
   * Override run() to delegate to execute() and ensure cleanup
   * Subclasses should implement execute() instead of run()
   */
  async run(): Promise<void> {
    try {
      await this.execute();
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Main command logic - implement this instead of run()
   * PMO context is available via this.pmoContext
   */
  protected abstract execute(): Promise<void>;

  /**
   * Cleanup handler - ensures storage is closed
   * Called automatically after execute() completes or throws
   */
  protected async cleanup(): Promise<void> {
    if (this.contextInitialized && this.pmoContext?.storage) {
      try {
        await this.pmoContext.storage.close();
      } catch {
        // Ignore close errors - storage might already be closed
      }
    }
  }

  /**
   * oclif catch hook - called when an error occurs
   * Ensures cleanup even on errors
   */
  async catch(error: Error & { exitCode?: number }): Promise<void> {
    await this.cleanup();
    throw error;
  }

  /**
   * oclif finally hook - called after run() completes
   */
  async finally(_: Error | undefined): Promise<void> {
    await this.cleanup();
  }

  // Convenience getters for common context properties

  /** Storage instance */
  protected get storage() {
    return this.pmoContext.storage;
  }

  /** PMO directory path */
  protected get pmoPath() {
    return this.pmoContext.pmoPath;
  }
}
