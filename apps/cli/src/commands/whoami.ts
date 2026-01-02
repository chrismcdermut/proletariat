import { Command } from '@oclif/core';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { colors, format } from '../lib/colors.js';

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

    this.log('');
  }

  private detectAgentName(): string | null {
    // Check environment variable first (set in devcontainer)
    if (process.env.PRLT_AGENT_NAME) {
      return process.env.PRLT_AGENT_NAME;
    }

    // Try to detect from directory structure
    // Pattern: /workspace/proletariat-{agentName} or agents/staff/{agentName}
    const cwd = process.cwd();

    // Devcontainer pattern: /workspace/proletariat-{agent}
    const workspaceMatch = cwd.match(/\/workspace\/[^/]+-(\w+)/);
    if (workspaceMatch) {
      return workspaceMatch[1];
    }

    // Host pattern: agents/staff/{agent}
    const staffMatch = cwd.match(/agents\/staff\/(\w+)/);
    if (staffMatch) {
      return staffMatch[1];
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
