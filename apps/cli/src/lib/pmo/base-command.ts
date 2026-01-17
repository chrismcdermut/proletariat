import { Command, Flags } from '@oclif/core';
import inquirer from 'inquirer';
import { getPMOContext, type PMOContext } from './pmo-context.js';
import { styles } from '../styles.js';

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
   * 3. If multiple projects exist, prompts user to select one
   *
   * @param options.filterEmptyProjects - Only show projects with tickets
   * @returns The selected project ID - pass this to storage operations
   */
  protected async requireProject(options?: { filterEmptyProjects?: boolean }): Promise<string> {
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

    // Multiple projects - prompt for selection
    // Sort projects by leading number in name (e.g., "1. MVP" before "10. Infra")
    const sortedProjects = [...filteredProjects].sort((a, b) => {
      const numA = parseInt(a.name.match(/^(\d+)/)?.[1] || '999', 10);
      const numB = parseInt(b.name.match(/^(\d+)/)?.[1] || '999', 10);
      return numA - numB;
    });

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
