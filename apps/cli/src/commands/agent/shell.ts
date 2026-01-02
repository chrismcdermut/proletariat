import { Command, Args } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js';
import { getTerminalApp } from '../../lib/execution/config.js';
import { TerminalApp, DisplayMode } from '../../lib/execution/types.js';
import { isDockerRunning } from '../../lib/execution/runners.js';
import * as os from 'os';

export default class Shell extends Command {
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

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Shell);

    try {
      // Get workspace information
      const workspaceInfo = getWorkspaceInfo();

      if (workspaceInfo.agents.length === 0) {
        this.log(colors.warning('No agents found. Add agents with "prlt agent add"'));
        return;
      }

      let agentName = args.name;

      // Interactive mode if no agent specified
      if (!agentName) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select agent to open shell in:',
            choices: workspaceInfo.agents.map(agent => ({
              name: agent.name,
              value: agent.name
            }))
          }
        ]);
        agentName = selected;
      }

      // Validate agent exists
      const agent = workspaceInfo.agents.find(a => a.name === agentName);
      if (!agent) {
        this.error(`Agent "${agentName}" not found. Available agents: ${workspaceInfo.agents.map(a => a.name).join(', ')}`);
      }

      const agentDir = path.join(workspaceInfo.agentsPath, agentName!);

      // Check if agent has devcontainer
      const hasDevcontainer = hasDevcontainerConfig(agentDir);

      // Prompt for environment
      let environment: 'devcontainer' | 'host' = 'host';
      if (hasDevcontainer) {
        const { selectedEnvironment } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedEnvironment',
            message: 'Where should the shell run?',
            choices: [
              { name: '🐳 devcontainer (recommended)', value: 'devcontainer' },
              { name: '💻 host (agent worktree on your machine)', value: 'host' },
            ],
            default: 'devcontainer',
          },
        ]);
        environment = selectedEnvironment;
      }

      // Prompt for display mode and permission mode
      const { displayMode, permissionMode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'displayMode',
          message: 'How should the shell be opened?',
          choices: [
            { name: 'terminal     - New terminal window', value: 'terminal' },
            { name: 'foreground   - Run in current terminal', value: 'foreground' },
          ],
          default: 'terminal',
        },
        {
          type: 'list',
          name: 'permissionMode',
          message: 'Permission mode for Claude Code:',
          choices: [
            { name: '🔒 safe   - Requires approval for dangerous operations', value: 'safe' },
            { name: '⚠️  danger - Skip permission checks', value: 'danger' },
          ],
          default: 'safe',
        },
      ]);

      this.log('');
      this.log(colors.primary(`🐚 Opening shell for agent: ${agentName}`));
      this.log('');

      const dangerMode = permissionMode === 'danger';

      if (environment === 'devcontainer') {
        await this.openDevcontainerShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
      } else {
        await this.openHostShell(workspaceInfo.path, agentDir, agentName!, displayMode, dangerMode);
      }

    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }

  private async openDevcontainerShell(hqPath: string, agentDir: string, agentName: string, displayMode: 'terminal' | 'foreground', dangerMode: boolean): Promise<void> {
    // Check Docker is running
    if (!isDockerRunning()) {
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    // Start or ensure container is running
    try {
      execSync(`devcontainer up --workspace-folder "${agentDir}"`, {
        stdio: 'pipe',
      });
    } catch (error) {
      this.error(`Failed to start devcontainer: ${error instanceof Error ? error.message : error}`);
    }

    // Get container ID
    let containerId: string | null = null;
    try {
      containerId = execSync(
        `docker ps -q --filter "label=devcontainer.local_folder=${agentDir}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
    } catch {
      // Ignore
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
