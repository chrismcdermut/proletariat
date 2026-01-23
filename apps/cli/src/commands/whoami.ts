import { Command } from '@oclif/core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { colors } from '../lib/colors.js';
import { getAgentByPath } from '../lib/database/index.js';

export default class Whoami extends Command {
  static description = 'Show current agent/environment context';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  async run(): Promise<void> {
    const isDevcontainer = process.env.DEVCONTAINER === 'true';
    const agentName = this.detectAgentName();
    const repoName = this.detectRepoName();
    const branch = this.getCurrentBranch();
    const hqPath = process.env.PRLT_HQ_PATH;

    this.log('');
    this.log(colors.primary('🔍 Proletariat Context'));
    this.log('');

    // Agent info
    if (agentName) {
      this.log(`  Agent:       ${colors.primary(agentName)}`);
    } else {
      this.log(`  Agent:       ${colors.textMuted('(not detected)')}`);
    }

    // Repository info
    if (repoName) {
      this.log(`  Repository:  ${colors.text(repoName)}`);
    }

    // Branch info
    if (branch) {
      this.log(`  Branch:      ${colors.text(branch)}`);
    }

    // Environment
    this.log('');
    this.log(`  Environment: ${isDevcontainer ? colors.primary('devcontainer') : colors.text('host')}`);
    this.log(`  Working dir: ${colors.textMuted(process.cwd())}`);

    if (hqPath) {
      this.log(`  HQ path:     ${colors.textMuted(hqPath)}`);
    }

    // Show PMO path if available
    const pmoPath = process.env.PRLT_PMO_PATH;
    if (pmoPath) {
      this.log(`  PMO path:    ${colors.textMuted(pmoPath)}`);
    }

    // Show host path if available (set in devcontainer for agent identity)
    const hostPath = process.env.PRLT_HOST_PATH;
    if (hostPath) {
      this.log(`  Host path:   ${colors.textMuted(hostPath)}`);
    }

    this.log('');
  }

  private detectAgentName(): string | null {
    // Check environment variable first (set in devcontainer)
    if (process.env.PRLT_AGENT_NAME) {
      return process.env.PRLT_AGENT_NAME;
    }

    const cwd = process.cwd();

    // Try database lookup (most reliable on host)
    const workspacePath = this.findWorkspaceRoot(cwd);
    if (workspacePath) {
      try {
        const agent = getAgentByPath(workspacePath, cwd);
        if (agent) {
          return agent.name;
        }
      } catch {
        // DB lookup failed, fall back to other methods
      }
    }

    // Fallback: detect from directory structure
    // Devcontainer pattern: /workspace/proletariat-{agent}
    const workspaceMatch = cwd.match(/\/workspace\/[^/]+-(\w+)/);
    if (workspaceMatch) {
      return workspaceMatch[1];
    }

    // Host pattern: agents/staff/{agent} or agents/temp/{agent}
    const agentDirMatch = cwd.match(/agents\/(?:staff|temp)\/([\w-]+)/);
    if (agentDirMatch) {
      return agentDirMatch[1];
    }

    // Try git branch pattern: agent-{name}
    try {
      const branch = execSync('git branch --show-current', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      const agentBranchMatch = branch.match(/^agent-(\w+)$/);
      if (agentBranchMatch) {
        return agentBranchMatch[1];
      }
    } catch {
      // Ignore git errors
    }

    return null;
  }

  private findWorkspaceRoot(startDir: string): string | null {
    let currentDir = startDir;

    while (currentDir !== '/') {
      const dbPath = path.join(currentDir, '.proletariat', 'workspace.db');
      if (fs.existsSync(dbPath)) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  private detectRepoName(): string | null {
    // Try to get repo name from directory or git remote
    try {
      const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore git errors
    }

    // Fallback to directory name
    const cwd = process.cwd();
    return path.basename(cwd);
  }

  private getCurrentBranch(): string | null {
    try {
      return execSync('git branch --show-current', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    } catch {
      return null;
    }
  }
}
