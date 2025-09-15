import axios from 'axios';
import { EventEmitter } from 'events';
import { TaskExecutor } from './task-executor';
import { GitManager } from './git-manager';
import { logger } from './utils/logger';
import path from 'path';
import fs from 'fs/promises';

interface WorkerConfig {
  name: string;
  theme: 'billionaires' | 'cars' | 'companies';
  orchestratorUrl: string;
  skills: string[];
  languages: string[];
  workDir?: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedTime: number;
}

export class WorkerAgent extends EventEmitter {
  private config: WorkerConfig;
  private workerId?: string;
  private currentTask?: Task;
  private taskExecutor: TaskExecutor;
  private gitManager: GitManager;
  private heartbeatInterval?: NodeJS.Timer;
  private pollInterval?: NodeJS.Timer;
  private isRunning: boolean = false;

  constructor(config: WorkerConfig) {
    super();
    this.config = config;
    this.config.workDir = config.workDir || this.getWorkDir();
    this.taskExecutor = new TaskExecutor(this.config.workDir);
    this.gitManager = new GitManager(this.config.workDir);
  }

  private getWorkDir(): string {
    const projectName = path.basename(process.cwd());
    const themeDir = {
      'billionaires': 'staff',
      'cars': 'garage',
      'companies': 'portfolio'
    }[this.config.theme];
    
    return path.join(
      process.cwd(),
      '..',
      `${projectName}-${themeDir}`,
      this.config.name
    );
  }

  async start() {
    this.isRunning = true;
    
    // Ensure work directory exists
    await this.ensureWorkDir();
    
    // Register with orchestrator
    await this.register();
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Start polling for tasks
    this.startPolling();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  async stop() {
    logger.info(`👋 ${this.config.name} is stopping...`);
    this.isRunning = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    
    // Unregister from orchestrator
    if (this.workerId) {
      try {
        await axios.post(`${this.config.orchestratorUrl}/api/workers/${this.workerId}/unregister`);
      } catch (error) {
        logger.error('Failed to unregister:', error);
      }
    }
    
    process.exit(0);
  }

  private async ensureWorkDir() {
    try {
      await fs.mkdir(this.config.workDir, { recursive: true });
      logger.info(`📁 Work directory: ${this.config.workDir}`);
      
      // Initialize git worktree if needed
      const gitExists = await this.gitManager.checkGitRepo();
      if (!gitExists) {
        await this.gitManager.createWorktree(this.config.name);
      }
    } catch (error) {
      logger.error('Failed to create work directory:', error);
      throw error;
    }
  }

  private async register() {
    try {
      const { data } = await axios.post(
        `${this.config.orchestratorUrl}/api/workers/register`,
        {
          name: this.config.name,
          theme: this.config.theme,
          skills: this.config.skills,
          languages: this.config.languages,
          endpoint: `http://localhost:${process.env.PORT || 4000}`
        }
      );
      
      this.workerId = data.worker.id;
      logger.info(`✅ Registered with orchestrator as ${this.workerId}`);
    } catch (error) {
      logger.error('Failed to register with orchestrator:', error);
      throw error;
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      if (!this.workerId || !this.isRunning) return;
      
      try {
        await axios.post(
          `${this.config.orchestratorUrl}/api/workers/${this.workerId}/heartbeat`,
          {
            status: this.currentTask ? 'busy' : 'idle',
            currentTask: this.currentTask?.id
          }
        );
      } catch (error) {
        logger.error('Heartbeat failed:', error);
      }
    }, 30000); // Every 30 seconds
  }

  private startPolling() {
    this.pollInterval = setInterval(async () => {
      if (!this.workerId || !this.isRunning || this.currentTask) return;
      
      try {
        await this.checkForTasks();
      } catch (error) {
        logger.error('Polling failed:', error);
      }
    }, 10000); // Every 10 seconds
  }

  private async checkForTasks() {
    try {
      // Get available tasks
      const { data } = await axios.get(
        `${this.config.orchestratorUrl}/api/tasks/available`,
        {
          params: {
            skills: this.config.skills.join(','),
            workerId: this.workerId
          }
        }
      );
      
      if (data.tasks && data.tasks.length > 0) {
        // Claim the first suitable task
        const task = data.tasks[0];
        await this.claimTask(task);
      }
    } catch (error) {
      // Silently ignore if no tasks available
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return;
      }
      logger.error('Failed to check for tasks:', error);
    }
  }

  private async claimTask(task: Task) {
    try {
      logger.info(`🎯 Attempting to claim task: ${task.title}`);
      
      const { data } = await axios.post(
        `${this.config.orchestratorUrl}/api/tasks/${task.id}/claim`,
        {
          workerId: this.workerId
        }
      );
      
      if (data.success) {
        this.currentTask = task;
        logger.info(`✅ Claimed task: ${task.title}`);
        await this.executeTask(task);
      }
    } catch (error) {
      logger.error('Failed to claim task:', error);
    }
  }

  private async executeTask(task: Task) {
    const startTime = Date.now();
    
    try {
      logger.info(`🔨 Starting work on: ${task.title}`);
      
      // Update task status to in_progress
      await this.updateTaskStatus(task.id, 'in_progress', 0);
      
      // Create a new branch for the task
      const branchName = `task/${task.id}`;
      await this.gitManager.createBranch(branchName);
      
      // Execute the task
      const result = await this.taskExecutor.execute(task);
      
      // Validate against acceptance criteria
      const validationResult = await this.validateTask(task, result);
      
      if (validationResult.success) {
        // Commit changes
        await this.gitManager.commitChanges(
          `Complete task ${task.id}: ${task.title}`
        );
        
        // Update task status to completed
        const duration = (Date.now() - startTime) / 1000 / 60; // minutes
        await this.updateTaskStatus(task.id, 'completed', 100, {
          result,
          duration,
          branch: branchName
        });
        
        logger.info(`✅ Task completed: ${task.title} in ${duration.toFixed(1)} minutes`);
      } else {
        // Task failed validation
        await this.updateTaskStatus(task.id, 'failed', 0, {
          error: validationResult.error,
          result
        });
        
        logger.error(`❌ Task failed validation: ${validationResult.error}`);
      }
    } catch (error) {
      logger.error(`Failed to execute task ${task.id}:`, error);
      await this.updateTaskStatus(task.id, 'failed', 0, {
        error: String(error)
      });
    } finally {
      this.currentTask = undefined;
    }
  }

  private async validateTask(task: Task, result: any): Promise<{ success: boolean; error?: string }> {
    // Basic validation against acceptance criteria
    for (const criterion of task.acceptanceCriteria) {
      if (criterion.toLowerCase().includes('test')) {
        // Run tests if required
        const testResult = await this.taskExecutor.runTests();
        if (!testResult.success) {
          return { success: false, error: 'Tests failed' };
        }
      }
      
      if (criterion.toLowerCase().includes('documentation')) {
        // Check if documentation was updated
        const hasDoc = await this.checkDocumentation();
        if (!hasDoc) {
          return { success: false, error: 'Documentation not updated' };
        }
      }
    }
    
    return { success: true };
  }

  private async checkDocumentation(): Promise<boolean> {
    // Check if README or docs were modified
    const changes = await this.gitManager.getChangedFiles();
    return changes.some(file => 
      file.toLowerCase().includes('readme') || 
      file.toLowerCase().includes('doc')
    );
  }

  private async updateTaskStatus(
    taskId: string, 
    status: string, 
    progress: number, 
    output?: any
  ) {
    try {
      await axios.put(
        `${this.config.orchestratorUrl}/api/tasks/${taskId}/status`,
        {
          status,
          progress,
          output
        }
      );
    } catch (error) {
      logger.error('Failed to update task status:', error);
    }
  }

  // Manual task assignment (for testing)
  async assignTask(task: Task) {
    if (this.currentTask) {
      logger.warn('Already working on a task');
      return false;
    }
    
    this.currentTask = task;
    await this.executeTask(task);
    return true;
  }

  getStatus() {
    return {
      id: this.workerId,
      name: this.config.name,
      theme: this.config.theme,
      skills: this.config.skills,
      languages: this.config.languages,
      busy: !!this.currentTask,
      currentTask: this.currentTask?.id,
      workDir: this.config.workDir
    };
  }
}