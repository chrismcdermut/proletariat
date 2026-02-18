import { Args, Flags } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/index.js';
import {
  getWorkspaceInfo,
  getAgentTmuxSessions,
  formatAgentList,
} from '../lib/agents/commands.js';
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js';
import { styles } from '../lib/styles.js';
import {
  DisplayMode,
  OutputMode,
  ExecutionContext,
} from '../lib/execution/types.js';
import {
  runExecution,
  buildTmuxAttachCommand,
  shouldUseControlMode,
} from '../lib/execution/runners.js';
import {
  loadExecutionConfig,
  getTerminalApp,
  promptTerminalPreference,
  getShell,
  promptShellPreference,
  hasTerminalPreference,
  hasShellPreference,
} from '../lib/execution/config.js';

export default class Open extends PMOCommand {
  static description = 'Open Claude Code (or another AI assistant) in an existing agent\'s workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --editor cursor',
    '<%= config.bin %> <%= command.id %> altman --prompt "help me debug the auth flow"',
  ];

  static args = {
    agent: Args.string({
      description: 'Agent name to open',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
    editor: Flags.string({
      description: 'AI assistant to launch (default: claude)',
      options: ['claude', 'cursor', 'windsurf'],
      default: 'claude',
    }),
    prompt: Flags.string({
      description: 'Initial prompt to pass to Claude Code',
    }),
    'display-mode': Flags.string({
      char: 'd',
      description: 'How to display output',
      options: ['terminal', 'background', 'foreground'],
      default: 'foreground',
    }),
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Open);

    const jsonMode = shouldOutputJson(flags);
    const errorConfig = { jsonMode, commandName: 'open', flags: flags as Record<string, unknown> };

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      this.handleError('NO_AGENTS', 'No agents found. Add agents with "prlt agent add"', errorConfig);
    }

    let agentName = args.agent;
    const agentConfig = jsonMode ? { flags: flags as Record<string, unknown>, commandName: 'open' } : null;

    // Interactive agent selection if no agent specified
    if (!agentName) {
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      const choices: Array<{ name: string; value: string; command: string }> = [];

      for (const agent of staffAgents) {
        choices.push({ name: `👔 ${agent.name}`, value: agent.name, command: `prlt open ${agent.name} --machine` });
      }

      for (const agent of tempAgents) {
        choices.push({ name: `⏱️  ${agent.name}`, value: agent.name, command: `prlt open ${agent.name} --machine` });
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select agent to open:',
        choices,
      }], agentConfig);

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      this.handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available: ${formatAgentList(workspaceInfo.agents)}`, errorConfig);
    }

    // Resolve agent workspace directory
    const agentDir = agent!.type === 'ephemeral'
      ? path.join(workspaceInfo.path, 'agents', workspaceInfo.ephemeralAgentsDir, agentName!)
      : path.join(workspaceInfo.path, 'agents', workspaceInfo.persistentAgentsDir, agentName!);

    // Validate workspace directory exists on disk
    if (!fs.existsSync(agentDir)) {
      this.handleError('WORKSPACE_NOT_FOUND', `Agent workspace directory not found: ${agentDir}`, errorConfig);
    }

    // Check for existing tmux sessions
    const existingSessions = getAgentTmuxSessions(agentName!);
    if (existingSessions.length > 0 && !jsonMode) {
      this.log(styles.warning(`\n⚠️  Agent "${agentName}" has ${existingSessions.length} active tmux session(s):`));
      for (const session of existingSessions) {
        this.log(styles.muted(`   • ${session}`));
      }
      this.log('');

      const { sessionAction } = await this.prompt<{ sessionAction: string }>([{
        type: 'list',
        name: 'sessionAction',
        message: 'What would you like to do?',
        choices: [
          { name: '🔗 Attach to existing session', value: 'attach', command: '' },
          { name: '⚠️  Open new session anyway', value: 'continue', command: `prlt open ${agentName} --machine` },
          { name: '❌ Cancel', value: 'cancel', command: '' },
        ],
      }], null);

      if (sessionAction === 'cancel') {
        this.log(styles.muted('Cancelled.'));
        return;
      }

      if (sessionAction === 'attach') {
        const sessionName = existingSessions[0];
        this.log(styles.info(`\nAttaching to session: ${sessionName}`));

        // Load config to check for iTerm control mode
        const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
        const db = new Database(dbPath);
        try {
          const config = loadExecutionConfig(db);
          const useControlMode = shouldUseControlMode(config.terminal.app, config.tmux.controlMode);
          const attachCmd = buildTmuxAttachCommand(useControlMode);

          const { execSync } = await import('node:child_process');
          execSync(`${attachCmd} -t "${sessionName}"`, { stdio: 'inherit' });
        } catch {
          this.log(styles.muted('\nDetached from session.'));
        } finally {
          db.close();
        }
        return;
      }
    }

    const displayMode = (flags['display-mode'] || 'foreground') as DisplayMode;
    const editor = flags.editor || 'claude';

    // Build a lightweight execution context (no ticket, no action tracking)
    const sessionName = `open-${agentName}`;
    const context: ExecutionContext = {
      ticketId: 'OPEN',
      ticketTitle: `Open: ${agentName}`,
      agentName: agentName!,
      agentDir,
      worktreePath: agentDir,
      branch: 'main',
      hqPath: workspaceInfo.path,
      actionName: 'open',
      actionPrompt: flags.prompt,
      modifiesCode: false,
    };

    // Load execution config from workspace database
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);

    try {
      const executionConfig = loadExecutionConfig(db);
      executionConfig.outputMode = 'interactive' as OutputMode;

      // For terminal mode, ensure terminal preference is set
      if (displayMode === 'terminal' && !jsonMode) {
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

      // Show summary
      if (!jsonMode) {
        this.log('');
        this.log(styles.header(`🚀 Opening ${editor === 'claude' ? 'Claude Code' : editor} for agent: ${agentName}`));
        this.log(styles.muted(`   Workspace: ${agentDir}`));
        this.log(styles.muted(`   Display: ${displayMode}`));
        if (flags.prompt) {
          this.log(styles.muted(`   Prompt: "${flags.prompt.substring(0, 60)}${flags.prompt.length > 60 ? '...' : ''}"`));
        }
        this.log('');
      }

      // For non-Claude editors, we handle them differently
      if (editor !== 'claude') {
        if (jsonMode) {
          outputSuccessAsJson({
            agent: agentName,
            workspace: agentDir,
            editor,
            message: `Run "${editor}" manually in ${agentDir}`,
          }, createMetadata('open', flags as Record<string, unknown>));
        }

        this.log(styles.info(`Opening ${editor} in ${agentDir}...`));
        const { execSync: execSyncCmd } = await import('node:child_process');
        try {
          execSyncCmd(`${editor} "${agentDir}"`, { stdio: 'inherit' });
          this.log(styles.success(`✓ Opened ${editor}`));
        } catch {
          this.error(`Failed to open ${editor}. Is it installed and on your PATH?`);
        }
        return;
      }

      // Launch Claude Code via execution engine
      const result = await runExecution('host', context, 'claude-code', executionConfig, {
        displayMode,
      });

      if (result.success) {
        if (jsonMode) {
          outputSuccessAsJson({
            agent: agentName,
            workspace: agentDir,
            editor: 'claude',
            sessionId: result.sessionId,
            displayMode,
          }, createMetadata('open', flags as Record<string, unknown>));
        }

        this.log('');
        this.log(styles.success(`✓ Session started: ${sessionName}`));
        if (displayMode === 'background') {
          this.log(styles.muted(`   Reattach with: tmux attach -t "${result.sessionId || sessionName}"`));
        }
      } else {
        this.handleError('EXECUTION_FAILED', `Failed to start session: ${result.error}`, errorConfig);
      }
    } finally {
      db.close();
    }
  }
}
