import Bull from 'bull';
import { EventEmitter } from 'events';
import { Task, TaskStatus } from './types';
import { logger } from './utils/logger';

export class TaskQueue extends EventEmitter {
  private queue: Bull.Queue;
  private tasks: Map<string, Task>;

  constructor(redisUrl?: string) {
    super();
    this.queue = new Bull('task-queue', redisUrl || 'redis://localhost:6379');
    this.tasks = new Map();
    this.setupQueueHandlers();
  }

  private setupQueueHandlers() {
    this.queue.on('completed', (job) => {
      const task = this.tasks.get(job.data.id);
      if (task) {
        task.status = 'completed';
        task.completedAt = new Date();
        this.emit('task:completed', task);
      }
    });

    this.queue.on('failed', (job, err) => {
      logger.error(`Task ${job.data.id} failed:`, err);
      const task = this.tasks.get(job.data.id);
      if (task) {
        task.status = 'failed';
        this.emit('task:failed', task);
      }
    });

    this.queue.on('progress', (job, progress) => {
      const task = this.tasks.get(job.data.id);
      if (task) {
        task.progress = progress;
        this.emit('task:progress', task);
      }
    });
  }

  async addTask(taskData: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: taskData.title || 'Untitled Task',
      description: taskData.description || '',
      priority: taskData.priority || 'medium',
      status: 'pending',
      requiredSkills: taskData.requiredSkills || [],
      estimatedTime: taskData.estimatedTime || 1,
      dependencies: taskData.dependencies || [],
      acceptanceCriteria: taskData.acceptanceCriteria || [],
      createdAt: new Date(),
      updatedAt: new Date(),
      retries: 0,
      ...taskData
    };

    this.tasks.set(task.id, task);

    // Add to Bull queue with priority
    const priority = this.getPriorityValue(task.priority);
    await this.queue.add(task, { 
      priority,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });

    logger.info(`📋 Task ${task.id} added to queue`);
    this.emit('task:created', task);
    return task;
  }

  private getPriorityValue(priority: string): number {
    const priorityMap = {
      'urgent': 1,
      'high': 2,
      'medium': 3,
      'low': 4
    };
    return priorityMap[priority as keyof typeof priorityMap] || 3;
  }

  async assignTask(taskId: string, workerId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.error(`Task ${taskId} not found`);
      return null;
    }

    if (task.status !== 'pending') {
      logger.warn(`Task ${taskId} is not pending, current status: ${task.status}`);
      return null;
    }

    task.assignedTo = workerId;
    task.status = 'assigned';
    task.updatedAt = new Date();

    this.emit('task:assigned', task);
    return task;
  }

  async updateTaskStatus(taskId: string, update: {
    status?: TaskStatus;
    progress?: number;
    output?: any;
  }): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.error(`Task ${taskId} not found`);
      return null;
    }

    if (update.status) {
      task.status = update.status;
      if (update.status === 'in_progress' && !task.actualTime) {
        task.actualTime = 0;
      }
      if (update.status === 'completed') {
        task.completedAt = new Date();
        if (task.actualTime !== undefined) {
          task.actualTime = (task.completedAt.getTime() - task.createdAt.getTime()) / 1000 / 60 / 60;
        }
      }
    }

    if (update.progress !== undefined) {
      task.progress = update.progress;
    }

    if (update.output !== undefined) {
      task.output = update.output;
    }

    task.updatedAt = new Date();
    this.emit('task:updated', task);
    return task;
  }

  async updateTask(task: Task): Promise<void> {
    task.updatedAt = new Date();
    this.tasks.set(task.id, task);
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async getPendingTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter(task => task.status === 'pending')
      .sort((a, b) => {
        const aPriority = this.getPriorityValue(a.priority);
        const bPriority = this.getPriorityValue(b.priority);
        return aPriority - bPriority;
      });
  }

  async getActiveTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter(task => ['assigned', 'in_progress'].includes(task.status));
  }

  async getTasksByWorker(workerId: string): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter(task => task.assignedTo === workerId);
  }

  async clearCompleted(): Promise<void> {
    const completed = Array.from(this.tasks.values())
      .filter(task => task.status === 'completed');
    
    for (const task of completed) {
      this.tasks.delete(task.id);
    }

    logger.info(`🧹 Cleared ${completed.length} completed tasks`);
  }
}