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
    description: 'Project ID (default: auto-detected)',
  }),
};

/**
 * Base command class for PMO commands
 *
 * Provides automatic PMO context initialization and cleanup:
 * - Initializes storage before run() executes (no project selection required)
 * - Ensures storage.close() is called even if errors occur
 * - Provides common PMO flags (--project)
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
 *     // Storage is always available
 *     const ticket = await this.storage.getTicket('TKT-123');
 *
 *     // If you need project context, request it explicitly:
 *     const projectId = await this.requireProject();
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
   * Initializes PMO context with storage access (no project selection)
   */
  async init(): Promise<void> {
    await super.init();

    // Parse flags to get project ID if provided
    const { flags } = await this.parse(this.constructor as typeof Command);
    this.projectFlag = (flags as { project?: string }).project;

    try {
      this.pmoContext = await getPMOContext({
        projectId: this.projectFlag,
        logger: (msg) => this.pmoLogger(msg),
      });
      this.contextInitialized = true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Require a project to be selected.
   * If a project was provided via -P flag, uses that.
   * If only one project exists, uses that.
   * If multiple projects exist, prompts user to select one.
   *
   * @param options.filterEmptyProjects - Only show projects with tickets
   * @returns The selected project ID
   */
  protected async requireProject(options?: { filterEmptyProjects?: boolean }): Promise<string> {
    // If project already selected, return it
    if (this.pmoContext.projectId && this.pmoContext.projectId !== 'default') {
      return this.pmoContext.projectId;
    }

    // If -P flag was provided, use it
    if (this.projectFlag) {
      this.storage.setCurrentProject(this.projectFlag);
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
        const tickets = await this.storage.listTickets({ projectId: p.id });
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
      const projectId = filteredProjects[0].id;
      this.storage.setCurrentProject(projectId);
      return projectId;
    }

    // Multiple projects - prompt for selection
    const { selectedProjectId } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedProjectId',
      message: 'Select project:',
      choices: filteredProjects.map(p => ({
        name: `${p.name} (${p.id})`,
        value: p.id,
      })),
    }]);

    this.storage.setCurrentProject(selectedProjectId);
    return selectedProjectId;
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

  /** Available columns (requires project) */
  protected get columns() {
    return this.pmoContext.columns;
  }

  /** Current project ID (may be 'default' if not selected) */
  protected get projectId() {
    return this.pmoContext.projectId;
  }

  /** Current project name */
  protected get projectName() {
    return this.pmoContext.projectName;
  }
}
