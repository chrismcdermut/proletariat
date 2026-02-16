import { Flags } from '@oclif/core';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js';
import { styles } from '../../lib/styles.js';
import {
  isMachineOutput,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js';

interface DiagnosticInfo {
  [key: string]: unknown;
  prlt: {
    version: string;
  };
  node: {
    version: string;
  };
  os: {
    platform: string;
    release: string;
    arch: string;
  };
  shell: string | undefined;
  tools: {
    gh: {
      installed: boolean;
      version?: string;
      authenticated?: boolean;
    };
    docker: {
      installed: boolean;
      running?: boolean;
    };
    tmux: {
      installed: boolean;
      version?: string;
    };
  };
  workspace?: {
    path: string;
    name?: string;
    repoCount?: number;
    agentCount?: number;
    ticketCount?: number;
  };
}

export default class SupportLogs extends PMOCommand {
  static description = 'Collect diagnostic info for troubleshooting';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --clipboard',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...pmoBaseFlags,
    clipboard: Flags.boolean({
      description: 'Copy diagnostics to clipboard',
      default: false,
    }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(SupportLogs);

    const diagnostics = await this.collectDiagnostics();

    // In JSON mode, return structured object
    if (isMachineOutput(flags)) {
      outputSuccessAsJson(
        diagnostics,
        createMetadata('support logs', flags)
      );
      return;
    }

    // Format as readable text
    const text = this.formatDiagnostics(diagnostics);

    // Copy to clipboard if requested
    if (flags.clipboard) {
      const copied = this.copyToClipboard(text);
      if (copied) {
        this.log(styles.success('Diagnostics copied to clipboard!'));
        this.log('');
      }
    }

    // Display diagnostics
    this.log(text);
  }

  private async collectDiagnostics(): Promise<DiagnosticInfo> {
    const diagnostics: DiagnosticInfo = {
      prlt: {
        version: this.config.version,
      },
      node: {
        version: process.version,
      },
      os: {
        platform: process.platform,
        release: os.release(),
        arch: os.arch(),
      },
      shell: process.env.SHELL,
      tools: {
        gh: this.checkGh(),
        docker: this.checkDocker(),
        tmux: this.checkTmux(),
      },
    };

    // Add workspace info if available
    try {
      const workspaceInfo = await this.getWorkspaceInfo();
      if (workspaceInfo) {
        diagnostics.workspace = workspaceInfo;
      }
    } catch {
      // PMO may not be initialized
    }

    return diagnostics;
  }

  private checkGh(): DiagnosticInfo['tools']['gh'] {
    try {
      const versionOutput = execSync('gh --version', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const version = versionOutput.split('\n')[0]?.replace('gh version ', '').trim();

      let authenticated = false;
      try {
        execSync('gh auth status', { stdio: 'ignore' });
        authenticated = true;
      } catch {
        authenticated = false;
      }

      return { installed: true, version, authenticated };
    } catch {
      return { installed: false };
    }
  }

  private checkDocker(): DiagnosticInfo['tools']['docker'] {
    try {
      execSync('docker --version', { stdio: 'ignore' });

      let running = false;
      try {
        execSync('docker info', { stdio: 'ignore' });
        running = true;
      } catch {
        running = false;
      }

      return { installed: true, running };
    } catch {
      return { installed: false };
    }
  }

  private checkTmux(): DiagnosticInfo['tools']['tmux'] {
    try {
      const versionOutput = execSync('tmux -V', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const version = versionOutput.trim();
      return { installed: true, version };
    } catch {
      return { installed: false };
    }
  }

  private async getWorkspaceInfo(): Promise<DiagnosticInfo['workspace'] | undefined> {
    try {
      const projects = await this.storage.listProjects();
      let totalTickets = 0;

      for (const project of projects) {
        // eslint-disable-next-line no-await-in-loop
        const tickets = await this.storage.listTickets(project.id);
        totalTickets += tickets.length;
      }

      // Get agents count by checking for agents directory
      let agentCount = 0;
      try {
        const { getWorkspaceInfo } = await import('../../lib/agents/commands.js');
        const wsInfo = getWorkspaceInfo();
        agentCount = wsInfo.agents?.length || 0;
      } catch {
        // Agents module may not be available
      }

      return {
        path: this.pmoPath,
        name: projects[0]?.name,
        repoCount: projects.length,
        agentCount,
        ticketCount: totalTickets,
      };
    } catch {
      return undefined;
    }
  }

  private formatDiagnostics(d: DiagnosticInfo): string {
    const lines: string[] = [];

    lines.push(styles.title('Diagnostic Information'));
    lines.push('');

    // System info
    lines.push(styles.header('System'));
    lines.push(`  prlt version:   ${d.prlt.version}`);
    lines.push(`  Node version:   ${d.node.version}`);
    lines.push(`  OS:             ${d.os.platform} ${d.os.release} (${d.os.arch})`);
    lines.push(`  Shell:          ${d.shell || 'unknown'}`);
    lines.push('');

    // Tools
    lines.push(styles.header('Tools'));

    // gh
    if (d.tools.gh.installed) {
      const authStatus = d.tools.gh.authenticated ? styles.success('authenticated') : styles.warning('not authenticated');
      lines.push(`  gh CLI:         ${styles.success('installed')} (${d.tools.gh.version}) - ${authStatus}`);
    } else {
      lines.push(`  gh CLI:         ${styles.warning('not installed')}`);
    }

    // docker
    if (d.tools.docker.installed) {
      const runStatus = d.tools.docker.running ? styles.success('running') : styles.warning('not running');
      lines.push(`  Docker:         ${styles.success('installed')} - ${runStatus}`);
    } else {
      lines.push(`  Docker:         ${styles.warning('not installed')}`);
    }

    // tmux
    if (d.tools.tmux.installed) {
      lines.push(`  tmux:           ${styles.success('installed')} (${d.tools.tmux.version})`);
    } else {
      lines.push(`  tmux:           ${styles.muted('not installed')}`);
    }

    lines.push('');

    // Workspace
    if (d.workspace) {
      lines.push(styles.header('Workspace'));
      lines.push(`  Path:           ${d.workspace.path}`);
      if (d.workspace.name) {
        lines.push(`  Name:           ${d.workspace.name}`);
      }
      lines.push(`  Projects:       ${d.workspace.repoCount ?? 0}`);
      lines.push(`  Agents:         ${d.workspace.agentCount ?? 0}`);
      lines.push(`  Tickets:        ${d.workspace.ticketCount ?? 0}`);
    } else {
      lines.push(styles.header('Workspace'));
      lines.push(styles.muted('  No workspace initialized'));
    }

    return lines.join('\n');
  }

  private copyToClipboard(text: string): boolean {
    const platform = process.platform;
    // Strip ANSI codes for clipboard
    // eslint-disable-next-line no-control-regex -- intentional ANSI escape code stripping
    const plainText = text.replace(/\u001B\[[0-9;]*m/g, '');

    try {
      if (platform === 'darwin') {
        execSync('pbcopy', { input: plainText, encoding: 'utf-8' });
        return true;
      } else if (platform === 'linux') {
        // Try xclip first, then xsel
        try {
          execSync('xclip -selection clipboard', { input: plainText, encoding: 'utf-8' });
          return true;
        } catch {
          try {
            execSync('xsel --clipboard --input', { input: plainText, encoding: 'utf-8' });
            return true;
          } catch {
            this.log(styles.warning('Install xclip or xsel to enable clipboard support.'));
            return false;
          }
        }
      } else if (platform === 'win32') {
        execSync('clip', { input: plainText, encoding: 'utf-8' });
        return true;
      }
    } catch {
      this.log(styles.warning('Could not copy to clipboard.'));
    }

    return false;
  }
}
