import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { styles } from '../../lib/styles.js';
import {
  getRegisteredHeadquarters,
  unregisterHeadquarters,
} from '../../lib/machine-config.js';
import {
  getWorkspaceAgents,
  removeAgentsFromDatabase,
  getDatabasePath,
} from '../../lib/database/index.js';

interface StaleWorkspace {
  name: string;
  path: string;
}

interface StaleAgent {
  workspacePath: string;
  workspaceName: string;
  agentName: string;
  expectedPath: string;
}

export default class WorkspacePrune extends Command {
  static description = 'Remove stale workspace entries and agents with deleted worktrees';

  static examples = [
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %>',
  ];

  static flags = {
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be removed without removing',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(WorkspacePrune);

    // Find stale entries
    const staleWorkspaces = this.findStaleWorkspaces();
    const staleAgents = this.findStaleAgents();

    const totalStale = staleWorkspaces.length + staleAgents.length;

    // JSON output
    if (flags.json) {
      const output = {
        dryRun: flags['dry-run'],
        staleWorkspaces: staleWorkspaces.map(w => ({
          name: w.name,
          path: w.path,
        })),
        staleAgents: staleAgents.map(a => ({
          workspaceName: a.workspaceName,
          agentName: a.agentName,
          expectedPath: a.expectedPath,
        })),
        totalRemoved: flags['dry-run'] ? 0 : totalStale,
        totalFound: totalStale,
      };
      this.log(JSON.stringify(output, null, 2));

      if (!flags['dry-run'] && totalStale > 0) {
        this.performPrune(staleWorkspaces, staleAgents);
      }
      return;
    }

    // Human-readable output
    this.log(`\n${styles.header('Workspace Prune')}`);
    this.log('─'.repeat(50));

    if (totalStale === 0) {
      this.log(styles.success('\nNo stale entries found.'));
      return;
    }

    // Show stale workspaces
    if (staleWorkspaces.length > 0) {
      this.log(styles.subheader('\nStale workspace registrations:'));
      for (const workspace of staleWorkspaces) {
        this.log(`  ${styles.removed('×')} ${styles.emphasis(workspace.name)}`);
        this.log(styles.muted(`    Path no longer exists: ${workspace.path}`));
      }
    }

    // Show stale agents
    if (staleAgents.length > 0) {
      this.log(styles.subheader('\nAgents with deleted worktrees:'));

      // Group by workspace for cleaner output
      const agentsByWorkspace = new Map<string, StaleAgent[]>();
      for (const agent of staleAgents) {
        const list = agentsByWorkspace.get(agent.workspaceName) || [];
        list.push(agent);
        agentsByWorkspace.set(agent.workspaceName, list);
      }

      for (const [workspaceName, agents] of agentsByWorkspace) {
        this.log(`  ${styles.muted(`In ${workspaceName}:`)}`);
        for (const agent of agents) {
          this.log(`    ${styles.removed('×')} ${agent.agentName}`);
          this.log(styles.muted(`      Expected: ${agent.expectedPath}`));
        }
      }
    }

    // Summary
    this.log('');
    if (flags['dry-run']) {
      this.log(styles.warning(`[DRY RUN] Would remove:`));
      if (staleWorkspaces.length > 0) {
        this.log(styles.muted(`  • ${staleWorkspaces.length} workspace registration(s)`));
      }
      if (staleAgents.length > 0) {
        this.log(styles.muted(`  • ${staleAgents.length} agent record(s)`));
      }
      this.log('');
      this.log(styles.muted('Run without --dry-run to remove these entries.'));
    } else {
      // Perform the actual prune
      this.performPrune(staleWorkspaces, staleAgents);

      this.log(styles.success('Pruned:'));
      if (staleWorkspaces.length > 0) {
        this.log(styles.muted(`  • ${staleWorkspaces.length} workspace registration(s)`));
      }
      if (staleAgents.length > 0) {
        this.log(styles.muted(`  • ${staleAgents.length} agent record(s)`));
      }
    }
    this.log('');
  }

  private findStaleWorkspaces(): StaleWorkspace[] {
    const workspaces = getRegisteredHeadquarters();
    const stale: StaleWorkspace[] = [];

    for (const workspace of workspaces) {
      if (!fs.existsSync(workspace.path)) {
        stale.push({
          name: workspace.name,
          path: workspace.path,
        });
      }
    }

    return stale;
  }

  private findStaleAgents(): StaleAgent[] {
    const workspaces = getRegisteredHeadquarters();
    const stale: StaleAgent[] = [];

    for (const workspace of workspaces) {
      // Skip workspaces that don't exist (handled separately)
      if (!fs.existsSync(workspace.path)) {
        continue;
      }

      // Skip workspaces without a database
      const dbPath = getDatabasePath(workspace.path);
      if (!fs.existsSync(dbPath)) {
        continue;
      }

      try {
        // Get active agents in this workspace
        const agents = getWorkspaceAgents(workspace.path, false);

        for (const agent of agents) {
          // Determine expected directory path
          let agentDir: string;
          if (agent.worktree_path) {
            agentDir = path.join(workspace.path, agent.worktree_path);
          } else if (agent.type === 'ephemeral') {
            agentDir = path.join(workspace.path, 'agents', 'temp', agent.name);
          } else {
            agentDir = path.join(workspace.path, 'agents', 'staff', agent.name);
          }

          // If directory doesn't exist, mark as stale
          if (!fs.existsSync(agentDir)) {
            stale.push({
              workspacePath: workspace.path,
              workspaceName: workspace.name,
              agentName: agent.name,
              expectedPath: agentDir,
            });
          }
        }
      } catch {
        // Skip workspaces where we can't read agents (e.g., database issues)
        continue;
      }
    }

    return stale;
  }

  private performPrune(staleWorkspaces: StaleWorkspace[], staleAgents: StaleAgent[]): void {
    // Remove stale workspace registrations
    for (const workspace of staleWorkspaces) {
      unregisterHeadquarters(workspace.path);
    }

    // Remove stale agents, grouped by workspace
    const agentsByWorkspace = new Map<string, string[]>();
    for (const agent of staleAgents) {
      const list = agentsByWorkspace.get(agent.workspacePath) || [];
      list.push(agent.agentName);
      agentsByWorkspace.set(agent.workspacePath, list);
    }

    for (const [workspacePath, agentNames] of agentsByWorkspace) {
      removeAgentsFromDatabase(workspacePath, agentNames);
    }
  }
}
