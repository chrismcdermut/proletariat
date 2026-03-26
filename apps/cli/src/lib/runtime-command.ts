/**
 * RuntimeCommand - Base class for commands that need workspace.db access.
 *
 * Hierarchy: PromptCommand → RuntimeCommand → PMOCommand
 *
 * Provides:
 * - HQ workspace resolution (this.hqPath)
 * - workspace.db lifecycle (this.db, auto-close on cleanup)
 * - SettingsStore for workspace_settings (this.settings)
 * - execute()/cleanup() lifecycle pattern
 * - Generic prompt utilities (selectFromList, promptForInput, handleError)
 *
 * Use this base class for commands that need workspace database access
 * but do NOT require a ticket provider (PMO, Linear, etc.). For commands
 * that need ticket/project operations, use PMOCommand which extends this.
 *
 * Commands that don't need workspace.db should extend PromptCommand directly.
 *
 * @example
 * ```typescript
 * import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js';
 *
 * export default class MyCommand extends RuntimeCommand {
 *   static flags = { ...runtimeBaseFlags };
 *
 *   async execute(): Promise<void> {
 *     // HQ path and workspace.db are available
 *     const hqPath = this.requireHQ();
 *     const db = this.requireDB();
 *     const apiKey = this.settings?.get('linear.api_key');
 *   }
 * }
 * ```
 */

import { Flags } from '@oclif/core';
import type Database from 'better-sqlite3';
import inquirer from 'inquirer';
import { PromptCommand } from './prompt-command.js';
import { findHQRoot } from './workspace.js';
import { openWorkspaceDatabase, type WorkspaceConfig, getWorkspaceConfig } from './database/index.js';
import { SettingsStore } from './database/settings-store.js';
import {
  shouldOutputJson,
  isNonTTY,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  type JsonFlags,
} from './prompt-json.js';
import { withSignalSafePrompt } from './signal-handler.js';

/**
 * Base flags for machine-readable output mode.
 * Include these in your command's flags by spreading: ...machineOutputFlags
 */
export const machineOutputFlags = {
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
 * Base flags for RuntimeCommand subclasses.
 * Includes machine output flags. Add command-specific flags alongside.
 */
export const runtimeBaseFlags = {
  ...machineOutputFlags,
};

export abstract class RuntimeCommand extends PromptCommand {
  /**
   * Workspace database connection.
   * Available after init() runs. May be null if no HQ found or DB failed to open.
   */
  private _db: Database.Database | null = null;

  /**
   * Settings store for workspace_settings table.
   * Available after init() runs. May be null if no DB available.
   */
  private _settings: SettingsStore | null = null;

  /**
   * HQ workspace root path.
   * Available after init() runs. May be null if not in an HQ workspace.
   */
  private _hqPath: string | null = null;

  /**
   * Workspace configuration from workspace.db.
   * Available after init() runs. May be null if no DB available.
   */
  private _workspaceConfig: WorkspaceConfig | null = null;

  /**
   * Flag to track if runtime context was successfully initialized
   */
  private _runtimeInitialized = false;

  /**
   * oclif init hook - runs before the command executes.
   * Resolves HQ workspace and opens workspace.db.
   */
  async init(): Promise<void> {
    await super.init();

    this._hqPath = findHQRoot(process.cwd());
    if (!this._hqPath) {
      return; // No HQ found — subclass decides whether to error
    }

    try {
      this._db = openWorkspaceDatabase(this._hqPath);
      this._settings = new SettingsStore(this._db);
      this._workspaceConfig = getWorkspaceConfig(this._hqPath);
      this._runtimeInitialized = true;
    } catch {
      // Database open failed — subclass decides how to handle
    }
  }

  /**
   * Override run() to delegate to execute() and ensure cleanup.
   * Subclasses should implement execute() instead of run().
   */
  async run(): Promise<void> {
    try {
      await this.execute();
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Main command logic — implement this instead of run().
   * Runtime context (hqPath, db, settings) is available via getters.
   */
  protected abstract execute(): Promise<void>;

  /**
   * Cleanup handler — ensures database connections are closed.
   * Called automatically after execute() completes or throws.
   * Override in subclasses to add additional cleanup (call super.cleanup()).
   */
  protected async cleanup(): Promise<void> {
    if (this._runtimeInitialized && this._db) {
      try {
        this._db.close();
      } catch {
        // Ignore close errors — database might already be closed
      }
      this._db = null;
    }
  }

  /**
   * oclif catch hook — called when an error occurs.
   * Ensures cleanup even on errors.
   */
  async catch(error: Error & { exitCode?: number }): Promise<void> {
    await this.cleanup();
    throw error;
  }

  /**
   * oclif finally hook — called after run() completes.
   */
  async finally(_: Error | undefined): Promise<void> {
    await this.cleanup();
  }

  // ─── Getters ────────────────────────────────────────────────

  /** HQ workspace root path, or null if not in an HQ workspace. */
  protected get hqPath(): string | null {
    return this._hqPath;
  }

  /** Workspace database connection, or null if not available. */
  protected get db(): Database.Database | null {
    return this._db;
  }

  /** Settings store for workspace_settings, or null if not available. */
  protected get settings(): SettingsStore | null {
    return this._settings;
  }

  /** Workspace configuration, or null if not available. */
  protected get workspaceConfig(): WorkspaceConfig | null {
    return this._workspaceConfig;
  }

  /** Whether the runtime context was successfully initialized. */
  protected get runtimeInitialized(): boolean {
    return this._runtimeInitialized;
  }

  // ─── Require helpers (throw if missing) ─────────────────────

  /**
   * Require HQ workspace to be available. Throws with a helpful
   * error message if no HQ was found.
   */
  protected requireHQ(): string {
    if (!this._hqPath) {
      throw new Error('Not in an HQ workspace. Run "prlt new" first.');
    }
    return this._hqPath;
  }

  /**
   * Require workspace database to be available. Throws with a helpful
   * error message if the DB could not be opened.
   */
  protected requireDB(): Database.Database {
    if (!this._db) {
      throw new Error('Workspace database not available. Run "prlt new" first.');
    }
    return this._db;
  }

  /**
   * Require settings store to be available.
   */
  protected requireSettings(): SettingsStore {
    if (!this._settings) {
      throw new Error('Workspace settings not available. Run "prlt new" first.');
    }
    return this._settings;
  }

  // ─── Prompt utilities ───────────────────────────────────────

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
    /** JSON mode config — if provided and flags indicate JSON mode, outputs JSON */
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

    // Auto-detect non-TTY: switch to JSON mode when no TTY present
    const effectiveJsonMode = jsonMode ?? (isNonTTY()
      ? { flags: { json: true } as JsonFlags & Record<string, unknown>, commandName: this.id ?? 'unknown' }
      : null);

    // Build choices with command field
    const choices = items.map(item => ({
      name: getName(item),
      value: getValue(item),
      command: getCommand(item),
    }));

    // Check for JSON mode
    if (effectiveJsonMode && shouldOutputJson(effectiveJsonMode.flags)) {
      outputPromptAsJson(
        {
          type: 'list',
          name: 'selection',
          message,
          choices,
        },
        createMetadata(effectiveJsonMode.commandName, effectiveJsonMode.flags)
      );
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

    const { selection } = await withSignalSafePrompt(() =>
      inquirer.prompt([{
        type: 'list',
        name: 'selection',
        message,
        choices: interactiveChoices,
      }])
    );

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

    // Auto-detect non-TTY: switch to JSON mode when no TTY present
    const effectiveJsonMode = jsonMode ?? (isNonTTY()
      ? { flags: { json: true } as JsonFlags & Record<string, unknown>, commandName: this.id ?? 'unknown', commandHint: '', example: undefined as string | undefined }
      : null);

    // Check for JSON mode
    if (effectiveJsonMode && shouldOutputJson(effectiveJsonMode.flags)) {
      outputPromptAsJson(
        {
          type: 'input',
          name: fieldName,
          message,
          default: defaultValue,
          context: {
            hint: effectiveJsonMode.commandHint,
            example: effectiveJsonMode.example,
          },
        },
        createMetadata(effectiveJsonMode.commandName, effectiveJsonMode.flags)
      );
      return '';
    }

    // Interactive mode
    const { value } = await withSignalSafePrompt(() =>
      inquirer.prompt([{
        type: 'input',
        name: 'value',
        message,
        default: defaultValue,
        validate,
      }])
    );

    return value;
  }

  /**
   * Unified error handler for JSON/interactive modes.
   *
   * Consolidates error handling to avoid message drift between JSON and interactive modes.
   * In JSON mode: outputs structured error JSON and exits
   * In interactive mode: calls this.error() with the message
   */
  protected handleError(
    code: string,
    message: string,
    options: {
      jsonMode: boolean;
      commandName: string;
      flags: Record<string, unknown>;
    }
  ): void {
    if (options.jsonMode) {
      outputErrorAsJson(code, message, createMetadata(options.commandName, options.flags));
      return
    }
    this.error(message);
  }
}
