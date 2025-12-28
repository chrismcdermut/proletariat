import { Args, Command, Flags } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import inquirer from 'inquirer';
import Database from 'better-sqlite3';
import { colors } from '../../lib/colors.js';
import { getWorkspaceInfo } from '../../lib/agents/commands.js';
import { hasDevcontainerConfig } from '../../lib/execution/devcontainer.js';
import { getTerminalApp } from '../../lib/execution/config.js';
import { TerminalApp } from '../../lib/execution/types.js';
import { isDockerRunning } from '../../lib/execution/runners.js';

export default class AgentsShell extends Command {
  static description = 'Open interactive shells in multiple agent workspaces';

  static examples = [
    '<%= config.bin %> <%= command.id %> altman andreesen',
    '<%= config.bin %> <%= command.id %> --all',
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    all: Flags.boolean({
      char: 'a',
      description: 'Open shells in all agent containers',
      default: false,
    }),
  };

  static args = {
    agents: Args.string({
      description: 'Agent name(s) to open shells in',
      required: false,
    }),
  };

  static strict = false;

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AgentsShell);

    // Get workspace info
    const workspaceInfo = getWorkspaceInfo();
    if (!workspaceInfo) {
      this.error('Not in a proletariat workspace. Run `prlt init` first.');
    }

    if (workspaceInfo.agents.length === 0) {
      this.log(colors.warning('No agents found. Add agents with "prlt agents add"'));
      return;
    }

    let agentsToOpen: string[] = [];

    if (flags.all) {
      agentsToOpen = workspaceInfo.agents.map((a: any) => a.name);
    } else {
      const agentNames = argv as string[];
      if (agentNames.length === 0) {
        // No args provided - prompt user to select agents
        const { selected } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'selected',
          message: 'Select agents to open shells in:',
          choices: [
            ...workspaceInfo.agents.map((a: any) => ({ name: a.name, value: a.name })),
            new inquirer.Separator(),
            { name: 'All agents', value: '__all__' }
          ],
          validate: (input) => input.length > 0 || 'Please select at least one agent'
        }]);

        if (selected.includes('__all__')) {
          agentsToOpen = workspaceInfo.agents.map((a: any) => a.name);
        } else {
          agentsToOpen = selected;
        }
      } else {
        agentsToOpen = agentNames;
      }
    }

    if (agentsToOpen.length === 0) {
      this.log(colors.warning('No agents selected'));
      return;
    }

    // Check which agents have devcontainers
    const agentsWithDevcontainer = agentsToOpen.filter(name => {
      const agentDir = path.join(workspaceInfo.agentsPath, name);
      return hasDevcontainerConfig(agentDir);
    });

    // Prompt for environment if any agents have devcontainers
    let environment: 'devcontainer' | 'host' = 'host';
    if (agentsWithDevcontainer.length > 0) {
      const { selectedEnvironment } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedEnvironment',
          message: 'Where should the shells run?',
          choices: [
            { name: '🐳 devcontainer (recommended)', value: 'devcontainer' },
            { name: '💻 host (agent worktrees on your machine)', value: 'host' },
          ],
          default: 'devcontainer',
        },
      ]);
      environment = selectedEnvironment;
    }

    // Prompt for permission mode
    const { permissionMode } = await inquirer.prompt([
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
    const dangerMode = permissionMode === 'danger';

    // Check Docker if using devcontainer
    if (environment === 'devcontainer' && !isDockerRunning()) {
      this.error('Docker is not running. Please start Docker Desktop and try again.');
    }

    this.log('');
    this.log(colors.primary(`🐚 Opening shells for ${agentsToOpen.length} agent(s)...\n`));

    // Open database for terminal preferences
    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db');
    const db = new Database(dbPath);

    try {
      const terminalApp = await getTerminalApp(db);

      for (const agentName of agentsToOpen) {
        try {
          const agentDir = path.join(workspaceInfo.agentsPath, agentName);
          const hasDevcontainer = hasDevcontainerConfig(agentDir);

          if (environment === 'devcontainer' && hasDevcontainer) {
            await this.openDevcontainerShell(workspaceInfo.path, agentDir, agentName, terminalApp, dangerMode);
          } else {
            await this.openHostShell(workspaceInfo.path, agentDir, agentName, terminalApp, dangerMode);
          }

          this.log(colors.success(`  ${agentName}: ✓ Opened shell`));
        } catch (error) {
          this.log(colors.error(`  ${agentName}: ✗ Failed: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    } finally {
      db.close();
    }

    this.log('');
    this.log(colors.primary('✨ Done!'));
  }

  private async openDevcontainerShell(hqPath: string, agentDir: string, agentName: string, terminalApp: TerminalApp, dangerMode: boolean): Promise<void> {
    // Start or ensure container is running
    try {
      execSync(`devcontainer up --workspace-folder "${agentDir}"`, {
        stdio: 'pipe',
      });
    } catch (error) {
      throw new Error(`Failed to start devcontainer: ${error instanceof Error ? error.message : error}`);
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
      throw new Error('Failed to find running container');
    }

    // Launch Claude inside the container
    const claudeCmd = dangerMode
      ? `docker exec -it -w /workspace ${containerId} claude --dangerously-skip-permissions`
      : `docker exec -it -w /workspace ${containerId} claude`;

    // Create script file (same pattern as runDevcontainerInTerminal)
    const baseDir = path.join(hqPath, '.proletariat', 'scripts');
    fs.mkdirSync(baseDir, { recursive: true });
    const scriptPath = path.join(baseDir, `shell-${agentName}-${Date.now()}.sh`);

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
  }

  private async openHostShell(hqPath: string, agentDir: string, agentName: string, terminalApp: TerminalApp, dangerMode: boolean): Promise<void> {
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
