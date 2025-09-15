import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './utils/logger';

export class GitManager {
  private git: SimpleGit;
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
    this.git = simpleGit(workDir);
  }

  async checkGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async createWorktree(name: string): Promise<void> {
    try {
      const parentDir = path.dirname(this.workDir);
      const projectRoot = path.join(parentDir, '..', path.basename(parentDir).replace(/-.*/, ''));
      
      // Create worktree from main project
      const parentGit = simpleGit(projectRoot);
      const branchName = `agent/${name}/work`;
      
      // Create branch if it doesn't exist
      try {
        await parentGit.checkoutLocalBranch(branchName);
      } catch {
        // Branch might already exist
      }
      
      // Add worktree
      await parentGit.raw(['worktree', 'add', '-b', branchName, this.workDir]);
      
      logger.info(`✅ Created git worktree at ${this.workDir}`);
    } catch (error) {
      logger.error('Failed to create worktree:', error);
      // Initialize as new repo if worktree creation fails
      await this.git.init();
    }
  }

  async createBranch(branchName: string): Promise<void> {
    try {
      await this.git.checkoutLocalBranch(branchName);
      logger.info(`🌿 Created branch: ${branchName}`);
    } catch (error) {
      logger.error('Failed to create branch:', error);
      // Try to checkout if branch exists
      try {
        await this.git.checkout(branchName);
      } catch {
        logger.error('Failed to checkout branch');
      }
    }
  }

  async commitChanges(message: string): Promise<void> {
    try {
      // Add all changes
      await this.git.add('.');
      
      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        logger.info('No changes to commit');
        return;
      }
      
      // Commit with message
      await this.git.commit(message);
      logger.info(`📝 Committed: ${message}`);
    } catch (error) {
      logger.error('Failed to commit changes:', error);
    }
  }

  async push(branch?: string): Promise<void> {
    try {
      if (branch) {
        await this.git.push('origin', branch);
      } else {
        await this.git.push();
      }
      logger.info('⬆️ Pushed changes to remote');
    } catch (error) {
      logger.error('Failed to push changes:', error);
    }
  }

  async getChangedFiles(): Promise<string[]> {
    try {
      const status = await this.git.status();
      return status.files.map(file => file.path);
    } catch (error) {
      logger.error('Failed to get changed files:', error);
      return [];
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error) {
      logger.error('Failed to get current branch:', error);
      return 'unknown';
    }
  }

  async stashChanges(): Promise<void> {
    try {
      await this.git.stash();
      logger.info('📦 Stashed changes');
    } catch (error) {
      logger.error('Failed to stash changes:', error);
    }
  }

  async pullLatest(): Promise<void> {
    try {
      await this.git.pull();
      logger.info('⬇️ Pulled latest changes');
    } catch (error) {
      logger.error('Failed to pull changes:', error);
    }
  }
}