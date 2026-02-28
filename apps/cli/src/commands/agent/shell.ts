import { Args } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo, getAgentTmuxSessions, formatAgentList, resolveAgentDir } from '../../lib/agents/commands.js';
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js';
import { getTerminalApp } from '../../lib/execution/config.js';
import { TerminalApp } from '../../lib/execution/types.js';
import {
  isDockerRunning,
  getAgentContainerName,
  isContainerRunning,
  getContainerId,
} from '../../lib/execution/runners.js';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import {
  shouldOutputJson,
} from '../../lib/prompt-json.js';

export default class Shell extends PMOCommand {
  static description = 'Open an interactive shell in an agent workspace';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman',
    '<%= config.bin %> <%= command.id %>',
  ];

  static args = {
    name: Args.string({
      description: 'Agent name to open shell in',
      required: false,
    }),
  };

  static flags = {
    ...pmoBaseFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(Shell);

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags);

    // Error handling config
    const errorConfig = { jsonMode, commandName: 'agent shell', flags };

    // Get workspace information
    const workspaceInfo = getWorkspaceInfo();

    if (workspaceInfo.agents.length === 0) {
      if (jsonMode) {
        this.handleError('NO_AGENTS', 'No agents found. Add agents with "prlt agent add"', errorConfig);
      }
      this.log(colors.warning('No agents found. Add agents with "prlt agent add"'));
      return;
    }

    let agentName = args.name;

    // Agent mode config for prompts
    const agentConfig = jsonMode ? { flags, commandName: 'agent shell' } : null;

    // Interactive mode if no agent specified
    if (!agentName) {
      // Group agents by type
      const staffAgents = workspaceInfo.agents.filter(a => a.type === 'persistent');
      const tempAgents = workspaceInfo.agents.filter(a => a.type === 'ephemeral');

      // Build choices with command field for JSON mode
      const choices: Array<{ name: string; value: string; command: string }> = [];

      for (const agent of staffAgents) {
        choices.push({ name: `👔 ${agent.name}`, value: agent.name, command: `prlt agent shell ${agent.name} --machine` });
      }

      for (const agent of tempAgents) {
        choices.push({ name: `⏱️  ${agent.name}`, value: agent.name, command: `prlt agent shell ${agent.name} --machine` });
      }

      const { selected } = await this.prompt<{ selected: string }>([{
        type: 'list',
        name: 'selected',
        message: 'Select agent to open shell in:',
        choices,
      }], agentConfig);

      agentName = selected;
    }

    // Validate agent exists
    const agent = workspaceInfo.agents.find(a => a.name === agentName);
    if (!agent) {
      this.handleError('AGENT_NOT_FOUND', `Agent "${agentName}" not found. Available: ${formatAgentList(workspaceInfo.agents)}`, errorConfig);
    }

    // Check for existing tmux sessions (skip in JSON mode - can't handle interactive tmux)
    const existingSessions = getAgentTmuxSessions(agentName!);
    if (existingSessions.length > 0 && !jsonMode) {
      this.log(colors.warning(`\n⚠️  Agent "${agentName}" has ${existingSessions.length} active tmux session(s):`));
      for (const session of existingSessions) {
        this.log(colors.textMuted(`   • ${session}`));
      }
      this.log('');

      const { sessionAction } = await this.prompt<{ sessionAction: string }>([{
        type: 'list',
        name: 'sessionAction',
        message: 'What would you like to do?',
        choices: [
          { name: '🔗 Attach to existing session', value: 'attach', command: '' },
          { name: '⚠️  Open new shell anyway (may cause conflicts)', value: 'continue', command: `prlt agent shell ${agentName} --machine` },
          { name: '❌ Cancel', value: 'cancel', command: '' },
        ],
      }], agentConfig);

      if (sessionAction === 'cancel') {
        this.log(colors.textMuted('Operation cancelled.'));
        return;
      }

      if (sessionAction === 'attach') {
        // Attach to the first session
        const sessionName = existingSessions[0];
        this.log(colors.primary(`\nAttaching to session: ${sessionName}`));
        try {
          execSync(`tmux attach-session -t "${sessionName}"`, { stdio: 'inherit' });
        } catch {
          // User detached or session ended
          this.log(colors.textMuted('\nDetached from session.'));
        }
        return;
      }
      // If 'continue', proceed with opening a new shell
      this.log(colors.warning('\nProceeding with new shell - be careful of conflicts!\n'));
    }

    const agentDir = resolveAgentDir(workspaceInfo, agentName!);

    // Check if agent has devcontainer
    const hasDevcontainer = hasDevcontainerConfig(agentDir);

    // In JSON mode with agent name provided, output combined config prompt
    if (jsonMode) {
      const configChoices = [
        { name: 'terminal - safe - devcontainer', value: 'terminal-safe-devcontainer', command: '' },
        { name: 'terminal - safe - host', value: 'terminal-safe-host', command: '' },
        { name: 'terminal - danger - devcontainer', value: 'terminal-danger-devcontainer', command: '' },
        { name: 'terminal - danger - host', value: 'terminal-danger-host', command: '' },
        { name: 'foreground - safe - devcontainer', value: 'foreground-safe-devcontainer', command: '' },
        { name: 'foreground - safe - host', value: 'foreground-safe-host', command: '' },
        { name: 'foreground - danger - devcontainer', value: 'foreground-danger-devcontainer', command: '' },
        { name: 'foreground - danger - host', value: 'foreground-danger-host', command: '' },
      ];

      const { config } = await this.prompt<{ config: string }>([{
        type: 'list',
        name: 'config',
        message: 'Select shell configuration (displayMode-permissionMode-environment):',
        choices: hasDevcontainer ? configChoices : configChoices.filter(c => c.value.endsWith('-host')),
      }], agentConfig);

      // Parse the config selection (this won't be reached in JSON mode as agentPrompt exits)
      const [displayMode, permissionMode, environment] = config.split('-') as ['terminal' | 'foreground', 'safe' | 'danger', 'devcontainer' | 'host'];
      const dangerMode = permissionMode === 'danger';

      if (environment === 'devcontainer') {
        await this.openDevcontainerShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
      } else {
        await this.openHostShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
      }
      return;
    }

    // Interactive mode: Prompt for environment
    let environment: 'devcontainer' | 'host' = 'host';
    if (hasDevcontainer) {
      let environmentSelected = false;
      while (!environmentSelected) {
        // eslint-disable-next-line no-await-in-loop -- Interactive loop with retry on Docker check
        const { selectedEnvironment } = await this.prompt<{ selectedEnvironment: 'devcontainer' | 'host' }>([{
          type: 'list',
          name: 'selectedEnvironment',
          message: 'Where should the shell run?',
          choices: [
            { name: '🐳 devcontainer (recommended)', value: 'devcontainer', command: '' },
            { name: '💻 host (agent worktree on your machine)', value: 'host', command: '' },
          ],
        }], null);

        if (selectedEnvironment === 'devcontainer') {
          // Dynamically check Docker when selected (user may have started it)
          if (!isDockerRunning()) {
            this.log('');
            this.warn('Docker is not running. Please start Docker and try again.');
            this.log('');
            continue;
          }
        }

        environment = selectedEnvironment;
        environmentSelected = true;
      }
    }

    // Interactive mode: Prompt for display mode
    const { displayMode } = await this.prompt<{ displayMode: 'terminal' | 'foreground' }>([{
      type: 'list',
      name: 'displayMode',
      message: 'How should the shell be opened?',
      choices: [
        { name: 'terminal     - New terminal window', value: 'terminal', command: '' },
        { name: 'foreground   - Run in current terminal', value: 'foreground', command: '' },
      ],
    }], null);

    // Interactive mode: Prompt for permission mode
    const { permissionMode } = await this.prompt<{ permissionMode: 'safe' | 'danger' }>([{
      type: 'list',
      name: 'permissionMode',
      message: 'Permission mode for Claude Code:',
      choices: [
        { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe', command: '' },
        { name: '⚠️  danger - Skip permission checks', value: 'danger', command: '' },
      ],
    }], null);

    this.log('');
    this.log(colors.primary(`🐚 Opening shell for agent: ${agentName}`));
    this.log('');

    const dangerMode = permissionMode === 'danger';

    if (environment === 'devcontainer') {
      await this.openDevcontainerShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
    } else {
      await this.openHostShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
    }
  }

  private async openDevcontainerShell(hqPath: string, agentDir: string, agentName: string, displayMode: 'terminal' | 'foreground', dangerMode: boolean): Promise<void> {
    // Check Docker is running
    if (!isDockerRunning()) {
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    // Get container using the standard naming convention
    const containerName = getAgentContainerName(agentName);
    let containerId: string | null = null;

    // Check if container is running
    if (isContainerRunning(containerName)) {
      containerId = getContainerId(containerName);
    } else {
      // Try to start a stopped container
      try {
        execSync(`docker start ${containerName}`, { stdio: 'pipe' });
        containerId = getContainerId(containerName);
      } catch {
        // Container doesn't exist - user needs to run a work command first
        this.log(colors.warning('Container is not running.'));
        this.log('');
        this.log('Start the container first by running a work command:');
        this.log('  prlt work start <ticket-id>');
        this.log('');
        this.error('Container must exist. Run a work command first to create it.');
      }
    }

    if (!containerId) {
      this.error('Failed to find running container.');
    }

    this.log(colors.success(`✓ Container running: ${containerId}`));
    this.log('');

    // The command to run inside the container
    const claudeArgs = dangerMode ? ['exec', '-it', '-w', '/workspace', containerId!, 'claude', '--dangerously-skip-permissions'] : ['exec', '-it', '-w', '/workspace', containerId!, 'claude'];

    if (displayMode === 'foreground') {
      // Run Claude directly in current terminal
      this.log(colors.text('Starting Claude Code in devcontainer...'));
      this.log('');

      const child = spawn('docker', claudeArgs, {
        stdio: 'inherit'
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Claude exited with code ${code}`));
          }
        });
        child.on('error', reject);
      });
    } else {
      // Open in new terminal window using the same method as work start
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      const db = new Database(dbPath);

      try {
        const terminalApp = await getTerminalApp(db);

        // Create script file (same pattern as runDevcontainerInTerminal)
        const baseDir = path.join(hqPath, '.proletariat', 'scripts');
        fs.mkdirSync(baseDir, { recursive: true });
        const scriptPath = path.join(baseDir, `shell-${agentName}-${Date.now()}.sh`);

        // Launch claude inside the container
        const claudeCmd = dangerMode
          ? `docker exec -it -w /workspace ${containerId} claude --dangerously-skip-permissions`
          : `docker exec -it -w /workspace ${containerId} claude`;

        const scriptContent = `#!/bin/bash
# Shell for agent ${agentName}

echo "======================================"
echo "Agent Shell: ${agentName} (devcontainer)"
echo "======================================"
echo ""

# Run Claude Code
${claudeCmd}

# Clean up script file
rm -f "${scriptPath}"

# Keep shell open after Claude exits
exec bash
`;
        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

        await this.runInTerminal(terminalApp, scriptPath);

        this.log(colors.success('✓ Opened new terminal window'));
        this.log(colors.textSecondary('An interactive shell is now available in the devcontainer.'));
      } finally {
        db.close();
      }
    }
  }

  private async openHostShell(hqPath: string, agentDir: string, agentName: string, displayMode: 'terminal' | 'foreground', dangerMode: boolean): Promise<void> {
    if (displayMode === 'foreground') {
      this.log(colors.text(`Starting Claude Code in ${agentDir}...`));
      this.log('');

      const claudeArgs = dangerMode ? ['--dangerously-skip-permissions'] : [];
      const child = spawn('claude', claudeArgs, {
        stdio: 'inherit',
        cwd: agentDir,
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Claude exited with code ${code}`));
          }
        });
        child.on('error', reject);
      });
    } else {
      // Open in new terminal window
      const dbPath = path.join(hqPath, '.proletariat', 'workspace.db');
      const db = new Database(dbPath);

      try {
        const terminalApp = await getTerminalApp(db);

        // Create script file
        const baseDir = path.join(hqPath, '.proletariat', 'scripts');
        fs.mkdirSync(baseDir, { recursive: true });
        const scriptPath = path.join(baseDir, `shell-${agentName}-${Date.now()}.sh`);

        const claudeCmd = dangerMode ? 'claude --dangerously-skip-permissions' : 'claude';

        const scriptContent = `#!/bin/bash
# Shell for agent ${agentName}

echo "======================================"
echo "Agent Shell: ${agentName} (host)"
echo "======================================"
echo ""

cd "${agentDir}"

# Run Claude Code
${claudeCmd}

# Clean up script file
rm -f "${scriptPath}"

# Keep shell open after Claude exits
exec bash
`;
        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

        await this.runInTerminal(terminalApp, scriptPath);

        this.log(colors.success('✓ Opened new terminal window'));
        this.log(colors.textSecondary(`Directory: ${agentDir}`));
      } finally {
        db.close();
      }
    }
  }

  /**
   * Run a script in a new terminal window using the same method as work start.
   * Uses osascript with proper iTerm/Terminal handling.
   */
  private async runInTerminal(terminalApp: TerminalApp, scriptPath: string): Promise<void> {
    switch (terminalApp) {
      case 'iTerm':
        // Same pattern as runDevcontainerInTerminal in runners.ts
        execSync(`osascript -e '
          tell application "iTerm"
            activate
            tell current window
              set newTab to (create tab with default profile)
              tell current session of newTab
                write text "${scriptPath}"
              end tell
            end tell
          end tell
        '`);
        break;

      case 'Ghostty':
        execSync(`osascript -e '
          tell application "Ghostty"
            activate
          end tell
          tell application "System Events"
            tell process "Ghostty"
              keystroke "t" using command down
              delay 0.3
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`);
        break;

      case 'WezTerm':
        execSync(`wezterm cli spawn --new-window -- bash -c 'source ${scriptPath}'`);
        break;

      case 'Kitty':
        execSync(`kitty @ launch --type=tab -- bash -c 'source ${scriptPath}'`);
        break;

      case 'Alacritty':
        execSync(`osascript -e '
          tell application "Alacritty"
            activate
          end tell
          tell application "System Events"
            tell process "Alacritty"
              keystroke "n" using command down
              delay 0.3
              keystroke "source ${scriptPath}"
              keystroke return
            end tell
          end tell
        '`);
        break;

      case 'Terminal':
      default:
        // Same pattern as runDevcontainerInTerminal in runners.ts
        execSync(`osascript -e '
          tell application "Terminal"
            activate
            tell application "System Events"
              tell process "Terminal"
                keystroke "t" using command down
              end tell
            end tell
            delay 0.3
            do script "source ${scriptPath}" in front window
          end tell
        '`);
        break;
    }
  }
}
