import { Command, Flags } from '@oclif/core';
import { getPMOContext, type PMOContext, type GetPMOContextOptions } from './pmo-context.js';
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

  /**
   * Skip project selection entirely.
   * Use this for commands that work with globally unique IDs (like ticket IDs)
   * and don't need project context.
   * Default: false
   */
  skipProjectSelection?: boolean;
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
      const contextOptions: GetPMOContextOptions = {
        projectId: projectFlag,
        logger: (msg) => this.pmoLogger(msg),
        promptIfMultiple: options.promptIfMultiple ?? true,
        skipProjectSelection: options.skipProjectSelection ?? false,
      };

      this.pmoContext = await getPMOContext(contextOptions);
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

/**
 * Base command class for ticket operations that work with ticket IDs.
 *
 * This class extends PMOCommand with special initialization logic:
 * - If a ticket ID argument is provided, skips project selection (since ticket IDs are globally unique)
 * - If no ticket ID is provided, prompts for project selection first (so user can pick from project's tickets)
 *
 * Usage:
 * ```typescript
 * import { TicketCommand, pmoBaseFlags } from '../../lib/pmo/base-command.js';
 *
 * export default class TicketView extends TicketCommand {
 *   static args = {
 *     ticketId: Args.string({
 *       description: 'Ticket ID to view',
 *       required: false,
 *     }),
 *   };
 *
 *   static flags = { ...pmoBaseFlags };
 *
 *   // Must implement to tell the base class which arg is the ticket ID
 *   protected getTicketIdArg(): string | undefined {
 *     return this.argv[0];
 *   }
 *
 *   async execute(): Promise<void> {
 *     // this.storage is available - works without project context
 *     const ticket = await this.storage.getTicket('TKT-123');
 *   }
 * }
 * ```
 */
export abstract class TicketCommand extends PMOCommand {
  /**
   * Get the ticket ID argument value before execute() runs.
   * Override this to provide the raw ticket ID from argv.
   *
   * Note: This is called during init() before args are fully parsed,
   * so it should return the raw string from argv.
   */
  protected getTicketIdArg(): string | undefined {
    // Default implementation: first positional argument
    // Subclasses can override if their ticket ID is in a different position
    return this.argv[0];
  }

  /**
   * Override getPMOOptions to skip project selection when ticket ID is provided.
   * When no ticket ID is given, we need project context to list tickets for selection.
   */
  protected getPMOOptions(): PMOCommandOptions {
    const ticketId = this.getTicketIdArg();

    // If a ticket ID was provided, skip project selection
    // (ticket IDs are globally unique, so we don't need project context)
    if (ticketId) {
      return { skipProjectSelection: true };
    }

    // No ticket ID provided - need project context to show ticket picker
    return { promptIfMultiple: true };
  }
}
