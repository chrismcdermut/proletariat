import { Command, Flags } from '@oclif/core';
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
 * Options for PMOCommand initialization
 */
export interface PMOCommandOptions {
  /**
   * Whether to prompt user to select project if multiple exist
   * Default: true
   */
  promptIfMultiple?: boolean;
}

/**
 * Base command class for PMO commands
 *
 * Provides automatic PMO context initialization and cleanup:
 * - Initializes storage and pmoPath before run() executes
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
 *     // Access this.pmoContext.storage, this.pmoContext.pmoPath, etc.
 *     const tickets = await this.pmoContext.storage.listTickets();
 *   }
 * }
 * ```
 *
 * For commands that need different initialization behavior (e.g., no prompting),
 * override getPMOOptions():
 * ```typescript
 * protected getPMOOptions(): PMOCommandOptions {
 *   return { promptIfMultiple: false };
 * }
 * ```
 */
export abstract class PMOCommand extends Command {
  /**
   * PMO context with storage, pmoPath, columns, etc.
   * Available after init() runs (before execute())
   */
  protected pmoContext!: PMOContext;

  /**
   * Flag to track if context was successfully initialized
   */
  private contextInitialized = false;

  /**
   * Get PMO initialization options
   * Override in subclass to customize behavior
   */
  protected getPMOOptions(): PMOCommandOptions {
    return { promptIfMultiple: true };
  }

  /**
   * Logger function for PMO context
   * Can be overridden to customize logging behavior
   */
  protected pmoLogger(msg: string): void {
    this.log(styles.muted(msg));
  }

  /**
   * oclif init hook - runs before the command executes
   * Initializes PMO context automatically
   */
  async init(): Promise<void> {
    await super.init();

    // Parse flags to get project ID
    const { flags } = await this.parse(this.constructor as typeof Command);
    const projectFlag = (flags as { project?: string }).project;

    const options = this.getPMOOptions();

    try {
      this.pmoContext = await getPMOContext(
        projectFlag,
        (msg) => this.pmoLogger(msg),
        options.promptIfMultiple ?? true
      );
      this.contextInitialized = true;
    } catch (error) {
      // Let the error propagate - run() won't execute
      throw error;
    }
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
    // Cleanup is already handled by run()'s finally block,
    // but we keep this for safety in case init() fails
    await this.cleanup();
    throw error;
  }

  /**
   * oclif finally hook - called after run() completes
   * Additional cleanup opportunity (though run() already handles it)
   */
  async finally(_: Error | undefined): Promise<void> {
    // Cleanup already handled by run(), but double-check
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

  /** Available columns */
  protected get columns() {
    return this.pmoContext.columns;
  }

  /** Current project ID */
  protected get projectId() {
    return this.pmoContext.projectId;
  }

  /** Current project name */
  protected get projectName() {
    return this.pmoContext.projectName;
  }
}
