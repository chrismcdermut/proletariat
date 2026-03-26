import * as fs from 'node:fs';
import * as path from 'node:path';
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { colors, format } from '../../lib/colors.js';
import { findHQRoot } from '../../lib/repos/index.js';
import { getWorkspaceRepositories, getWorkspaceAgents, openWorkspaceDatabase } from '../../lib/database/index.js';
import { isLocalPath, getOriginUrl, resolveRemoteUrl, setOriginUrl } from '../../lib/repos/git.js';

export default class FixRemotes extends PromptCommand {
  static description = 'Fix agent clone origins that point to local paths instead of GitHub remotes';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ];

  static flags = {
    ...machineOutputFlags,
  };

  protected getPMOOptions() {
    return { promptIfMultiple: false };
  }

  async run(): Promise<void> {
    const hqPath = findHQRoot();
    if (!hqPath) {
      this.error('Not in an HQ directory. Run "prlt new" first.');
    }

    this.log(format.title('Fixing repository remotes'));
    this.log('');

    const repos = getWorkspaceRepositories(hqPath);
    if (repos.length === 0) {
      this.log(colors.warning('No repositories found.'));
      return;
    }

    let fixedCount = 0;
    let alreadyOkCount = 0;
    let warningCount = 0;

    // Fix central repos in repos/ directory
    for (const repo of repos) {
      const repoPath = path.join(hqPath, repo.path);
      if (!fs.existsSync(repoPath)) {
        this.log(colors.warning(`  ${repo.name}: directory missing, skipping`));
        warningCount++;
        continue;
      }

      const originUrl = getOriginUrl(repoPath);
      if (!originUrl) {
        this.log(colors.warning(`  ${repo.name}: no origin remote configured`));
        warningCount++;
        continue;
      }

      if (!isLocalPath(originUrl)) {
        this.log(colors.textMuted(`  ${repo.name}: origin OK (${originUrl})`));
        alreadyOkCount++;
        continue;
      }

      // Origin is a local path — resolve it
      const resolved = resolveRemoteUrl(repoPath);
      if (resolved.isResolved && resolved.url) {
        setOriginUrl(repoPath, resolved.url);
        this.log(format.success(`  ${repo.name}: updated origin ${originUrl} → ${resolved.url}`));
        fixedCount++;
      } else if (resolved.warning) {
        this.log(colors.warning(`  ${repo.name}: ${resolved.warning}`));
        warningCount++;
      }
    }

    // Fix agent worktrees/clones
    this.log('');
    this.log(format.subtitle('Checking agent worktrees...'));

    const agents = getWorkspaceAgents(hqPath);
    const db = openWorkspaceDatabase(hqPath);
    const agentWorktrees = db.prepare('SELECT agent_name, repo_name, worktree_path FROM agent_worktrees').all() as {
      agent_name: string;
      repo_name: string;
      worktree_path: string;
    }[];
    db.close();

    for (const wt of agentWorktrees) {
      const wtPath = path.join(hqPath, wt.worktree_path);
      if (!fs.existsSync(wtPath)) continue;

      const originUrl = getOriginUrl(wtPath);
      if (!originUrl) continue;

      if (!isLocalPath(originUrl)) continue;

      // Agent worktree has a local origin — resolve from the central repo
      const centralRepoPath = path.join(hqPath, 'repos', wt.repo_name);
      const centralOrigin = getOriginUrl(centralRepoPath);

      if (centralOrigin && !isLocalPath(centralOrigin)) {
        // Central repo already has a good remote — use it
        setOriginUrl(wtPath, centralOrigin);
        this.log(format.success(`  ${wt.agent_name}/${wt.repo_name}: updated origin → ${centralOrigin}`));
        fixedCount++;
      } else {
        // Try resolving from the local path
        const resolved = resolveRemoteUrl(wtPath);
        if (resolved.isResolved && resolved.url) {
          setOriginUrl(wtPath, resolved.url);
          this.log(format.success(`  ${wt.agent_name}/${wt.repo_name}: updated origin → ${resolved.url}`));
          fixedCount++;
        }
      }
    }

    // Also scan agent directories for cloned repos not tracked in agent_worktrees
    for (const agent of agents) {
      if (!agent.worktree_path) continue;
      const agentDir = path.join(hqPath, agent.worktree_path);
      if (!fs.existsSync(agentDir)) continue;

      for (const repo of repos) {
        const agentRepoPath = path.join(agentDir, repo.name);
        if (!fs.existsSync(agentRepoPath)) continue;

        // Skip if already handled by agent_worktrees above
        const alreadyHandled = agentWorktrees.some(
          wt => wt.agent_name === agent.name && wt.repo_name === repo.name
        );
        if (alreadyHandled) continue;

        const originUrl = getOriginUrl(agentRepoPath);
        if (!originUrl || !isLocalPath(originUrl)) continue;

        // Resolve the remote
        const centralRepoPath = path.join(hqPath, 'repos', repo.name);
        const centralOrigin = getOriginUrl(centralRepoPath);

        if (centralOrigin && !isLocalPath(centralOrigin)) {
          setOriginUrl(agentRepoPath, centralOrigin);
          this.log(format.success(`  ${agent.name}/${repo.name}: updated origin → ${centralOrigin}`));
          fixedCount++;
        } else {
          const resolved = resolveRemoteUrl(agentRepoPath);
          if (resolved.isResolved && resolved.url) {
            setOriginUrl(agentRepoPath, resolved.url);
            this.log(format.success(`  ${agent.name}/${repo.name}: updated origin → ${resolved.url}`));
            fixedCount++;
          }
        }
      }
    }

    // Summary
    this.log('');
    this.log(format.subtitle('Summary:'));
    if (fixedCount > 0) {
      this.log(format.success(`  ${fixedCount} remote(s) fixed`));
    }
    if (alreadyOkCount > 0) {
      this.log(colors.textMuted(`  ${alreadyOkCount} already pointing to remote URLs`));
    }
    if (warningCount > 0) {
      this.log(colors.warning(`  ${warningCount} warning(s)`));
    }
    if (fixedCount === 0 && warningCount === 0) {
      this.log(colors.textMuted('  All remotes are already configured correctly.'));
    }
  }
}
