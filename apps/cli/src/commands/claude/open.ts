import { Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { PromptCommand } from '../../lib/prompt-command.js';
import { machineOutputFlags } from '../../lib/pmo/index.js';
import { findHQRoot } from '../../lib/workspace.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';
import { styles } from '../../lib/styles.js';
import {
  OutputMode,
  ExecutionContext,
  DEFAULT_EXECUTION_CONFIG,
} from '../../lib/execution/types.js';
import { runExecution } from '../../lib/execution/runners.js';
import {
  loadExecutionConfig,
  getTerminalApp,
  promptTerminalPreference,
  getShell,
  promptShellPreference,
  hasTerminalPreference,
  hasShellPreference,
} from '../../lib/execution/config.js';

export default class Open extends PromptCommand {
  static description = 'Open Claude Code in a new terminal tab (side-by-side workflow)';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --agent altman',
    '<%= config.bin %> <%= command.id %> --directory /path/to/project',
    '<%= config.bin %> <%= command.id %> --prompt "help me debug the auth flow"',
  ];

  static flags = {
    ...machineOutputFlags,
    agent: Flags.string({
      char: 'a',
      description: 'Open in an agent\'s workspace directory',
    }),
    directory: Flags.string({
      char: 'C',
      description: 'Directory to open in (default: current directory)',
    }),
    prompt: Flags.string({
      char: 'p',
      description: 'Initial prompt for Claude Code',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Open);
    const jsonMode = shouldOutputJson(flags);

    // Resolve the target directory
    let workDir: string;
    let label: string;

    if (flags.agent) {
      // Resolve agent workspace directory
      let workspaceInfo;
      try {
        workspaceInfo = getWorkspaceInfo();
      } catch {
        if (jsonMode) {
          outputErrorAsJson('NO_WORKSPACE', 'Not in an HQ or workspace. --agent requires an HQ.', createMetadata('open', flags));
          return
        }
        this.error('Not in an HQ or workspace. --agent requires an HQ.');
      }

      const agent = workspaceInfo.agents.find(a => a.name === flags.agent);
      if (!agent) {
        const available = workspaceInfo.agents.map(a => a.name).join(', ');
        const msg = `Agent "${flags.agent}" not found. Available: ${available || 'none'}`;
        if (jsonMode) {
          outputErrorAsJson('AGENT_NOT_FOUND', msg, createMetadata('open', flags));
          return
        }
        this.error(msg);
      }

      workDir = agent.type === 'ephemeral'
        ? path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, flags.agent)
        : path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, flags.agent);
      label = flags.agent;
    } else if (flags.directory) {
      workDir = path.resolve(flags.directory);
      label = path.basename(workDir);
    } else {
      workDir = process.cwd();
      label = path.basename(workDir);
    }

    // Validate directory exists
    if (!fs.existsSync(workDir)) {
      if (jsonMode) {
        outputErrorAsJson('DIRECTORY_NOT_FOUND', `Directory not found: ${workDir}`, createMetadata('open', flags));
        return
      }
      this.error(`Directory not found: ${workDir}`);
    }

    // Build execution context
    const sessionName = `open-${label}`;
    const context: ExecutionContext = {
      ticketId: 'OPEN',
      ticketTitle: `Open: ${label}`,
      agentName: label,
      agentDir: workDir,
      worktreePath: workDir,
      branch: 'main',
      actionName: 'open',
      actionPrompt: flags.prompt,
      modifiesCode: false,
    };

    // Try to find HQ for execution config, fall back to home dir config
    const hqPath = findHQRoot(workDir);
    if (hqPath) {
      context.hqPath = hqPath;
    }

    // Load execution config
    const executionConfig = { ...DEFAULT_EXECUTION_CONFIG };
    executionConfig.outputMode = 'interactive' as OutputMode;
    executionConfig.permissionMode = 'danger'; // Default to danger mode for quick open

    // Try to load saved preferences from workspace DB or home dir
    const dbPath = hqPath
      ? path.join(hqPath, '.proletariat', 'workspace.db')
      : path.join(process.env.HOME || '', '.proletariat', 'adhoc.db');

    let db: SqliteDatabase | null = null;
    try {
      if (fs.existsSync(dbPath)) {
        db = new SqliteDatabase(dbPath);
        const savedConfig = loadExecutionConfig(db);
        executionConfig.terminal = savedConfig.terminal;
        executionConfig.shell = savedConfig.shell;
        executionConfig.tmux = savedConfig.tmux;
      }
    } catch {
      // Ignore config loading errors, use defaults
    }

    // If no terminal preference saved, prompt for it (first run only)
    if (!jsonMode && db) {
      if (!hasTerminalPreference(db)) {
        executionConfig.terminal.app = await promptTerminalPreference(db);
      } else {
        executionConfig.terminal.app = await getTerminalApp(db);
      }

      if (!hasShellPreference(db)) {
        executionConfig.shell = await promptShellPreference(db);
      } else {
        executionConfig.shell = await getShell(db);
      }
    }

    if (db) {
      db.close();
    }

    // Show what we're doing
    if (!jsonMode) {
      this.log('');
      this.log(styles.muted(`   Opening Claude Code in new tab...`));
      this.log(styles.muted(`   Directory: ${workDir}`));
      if (flags.prompt) {
        this.log(styles.muted(`   Prompt: "${flags.prompt.substring(0, 60)}${flags.prompt.length > 60 ? '...' : ''}"`));
      }
      this.log('');
    }

    // Launch Claude Code in a new terminal tab
    const result = await runExecution('host', context, 'claude-code', executionConfig, {
      displayMode: 'terminal',
    });

    if (result.success) {
      if (jsonMode) {
        outputSuccessAsJson({
          directory: workDir,
          sessionId: result.sessionId,
          sessionName,
        }, createMetadata('open', flags as Record<string, unknown>));
        return
      }

      this.log(styles.success(`✓ Claude Code opened in new tab`));
      if (result.sessionId) {
        this.log(styles.muted(`   Session: ${result.sessionId}`));
      }
    } else {
      if (jsonMode) {
        outputErrorAsJson('EXECUTION_FAILED', `Failed to open: ${result.error}`, createMetadata('open', flags));
        return
      }
      this.error(`Failed to open: ${result.error}`);
    }
  }
}
