import express from 'express';
import { EventEmitter } from 'events';
import { TaskQueue } from './task-queue';
import { WorkerRegistry } from './worker-registry';
import { PMOWatcher } from './pmo-watcher';
import { logger } from './utils/logger';
import { Task, Worker, TaskStatus } from './types';

interface OrchestratorConfig {
  taskQueue: TaskQueue;
  workerRegistry: WorkerRegistry;
  pmoWatcher: PMOWatcher;
  port?: number;
}

export class OrchestratorAgent extends EventEmitter {
  private taskQueue: TaskQueue;
  private workerRegistry: WorkerRegistry;
  private pmoWatcher: PMOWatcher;
  private app: express.Application;
  private port: number;
  private assignmentLoop?: NodeJS.Timer;

  constructor(config: OrchestratorConfig) {
    super();
    this.taskQueue = config.taskQueue;
    this.workerRegistry = config.workerRegistry;
    this.pmoWatcher = config.pmoWatcher;
    this.port = config.port || 3000;
    this.app = express();
    this.setupAPI();
    this.setupEventHandlers();
  }

  private setupAPI() {
    this.app.use(express.json());

    // Worker registration endpoint
    this.app.post('/api/workers/register', async (req, res) => {
      const worker = await this.workerRegistry.register(req.body);
      logger.info(`💰 Worker ${worker.name} joined the revolution!`);
      res.json({ success: true, worker });
    });

    // Worker heartbeat
    this.app.post('/api/workers/:id/heartbeat', async (req, res) => {
      const { id } = req.params;
      await this.workerRegistry.heartbeat(id);
      res.json({ success: true });
    });

    // Task claim endpoint
    this.app.post('/api/tasks/:id/claim', async (req, res) => {
      const { id } = req.params;
      const { workerId } = req.body;
      const task = await this.taskQueue.assignTask(id, workerId);
      res.json({ success: true, task });
    });

    // Task status update
    this.app.put('/api/tasks/:id/status', async (req, res) => {
      const { id } = req.params;
      const { status, progress, output } = req.body;
      await this.taskQueue.updateTaskStatus(id, { status, progress, output });
      res.json({ success: true });
    });

    // Get system status
    this.app.get('/api/status', async (req, res) => {
      const workers = await this.workerRegistry.getActiveWorkers();
      const tasks = await this.taskQueue.getActiveTasks();
      const pending = await this.taskQueue.getPendingTasks();
      
      res.json({
        workers: workers.length,
        activeTasks: tasks.length,
        pendingTasks: pending.length,
        uptime: process.uptime()
      });
    });

    // Manual task creation
    this.app.post('/api/tasks', async (req, res) => {
      const task = await this.taskQueue.addTask(req.body);
      logger.info(`📋 New task created: ${task.id}`);
      res.json({ success: true, task });
    });
  }

  private setupEventHandlers() {
    // Listen for new specs from PMO
    this.pmoWatcher.on('spec:new', async (spec) => {
      logger.info(`📋 New spec detected: ${spec.id}`);
      const tasks = this.breakdownSpec(spec);
      for (const task of tasks) {
        await this.taskQueue.addTask(task);
      }
    });

    // Listen for worker availability changes
    this.workerRegistry.on('worker:available', async (worker) => {
      logger.info(`✅ Worker ${worker.name} is available for tasks`);
      await this.tryAssignTask(worker);
    });

    // Listen for task completion
    this.taskQueue.on('task:completed', async (task) => {
      logger.info(`✅ Task ${task.id} completed by ${task.assignedTo}`);
      const worker = await this.workerRegistry.getWorker(task.assignedTo!);
      if (worker) {
        await this.tryAssignTask(worker);
      }
    });

    // Listen for task failure
    this.taskQueue.on('task:failed', async (task) => {
      logger.error(`❌ Task ${task.id} failed`);
      // Retry logic or reassignment
      if (task.retries < 3) {
        task.retries++;
        task.status = 'pending';
        await this.taskQueue.updateTask(task);
      }
    });
  }

  private breakdownSpec(spec: any): Partial<Task>[] {
    const tasks: Partial<Task>[] = [];
    
    // Break down spec into individual tasks
    if (spec.requirements) {
      spec.requirements.forEach((req: any, index: number) => {
        tasks.push({
          specId: spec.id,
          title: `${spec.title} - Part ${index + 1}`,
          description: req.description,
          priority: spec.priority || 'medium',
          requiredSkills: req.skills || [],
          estimatedTime: req.estimatedHours || 1,
          dependencies: req.dependencies || [],
          acceptanceCriteria: spec.acceptanceCriteria || []
        });
      });
    } else {
      // Single task from spec
      tasks.push({
        specId: spec.id,
        title: spec.title,
        description: spec.description,
        priority: spec.priority || 'medium',
        requiredSkills: spec.skills || [],
        estimatedTime: spec.estimatedHours || 1,
        dependencies: spec.dependencies || [],
        acceptanceCriteria: spec.acceptanceCriteria || []
      });
    }

    return tasks;
  }

  private async tryAssignTask(worker: Worker) {
    // Find best matching task for worker
    const pendingTasks = await this.taskQueue.getPendingTasks();
    
    for (const task of pendingTasks) {
      // Check if worker has required skills
      const hasSkills = task.requiredSkills.every(skill => 
        worker.skills.includes(skill)
      );
      
      if (hasSkills && worker.availability === 'idle') {
        // Check dependencies
        const depsComplete = await this.checkDependencies(task);
        if (depsComplete) {
          await this.assignTask(task, worker);
          break;
        }
      }
    }
  }

  private async checkDependencies(task: Task): Promise<boolean> {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }
    
    for (const depId of task.dependencies) {
      const depTask = await this.taskQueue.getTask(depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    
    return true;
  }

  private async assignTask(task: Task, worker: Worker) {
    logger.info(`📋 Assigning task ${task.id} to ${worker.name}`);
    
    // Update task
    await this.taskQueue.assignTask(task.id, worker.id);
    
    // Update worker
    await this.workerRegistry.assignTask(worker.id, task.id);
    
    // Notify worker (via webhook or message queue)
    this.notifyWorker(worker, task);
  }

  private notifyWorker(worker: Worker, task: Task) {
    // In production, this would send to message queue or webhook
    logger.info(`📨 Notifying ${worker.name} about task ${task.id}`);
    this.emit('task:assigned', { worker, task });
  }

  private startAssignmentLoop() {
    // Periodically check for unassigned tasks
    this.assignmentLoop = setInterval(async () => {
      const pendingTasks = await this.taskQueue.getPendingTasks();
      const idleWorkers = await this.workerRegistry.getIdleWorkers();
      
      if (pendingTasks.length > 0 && idleWorkers.length > 0) {
        logger.info(`🔄 Matching ${pendingTasks.length} tasks with ${idleWorkers.length} workers`);
        
        for (const worker of idleWorkers) {
          await this.tryAssignTask(worker);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  async start() {
    // Start PMO watcher
    await this.pmoWatcher.start();
    
    // Start assignment loop
    this.startAssignmentLoop();
    
    // Start API server
    this.app.listen(this.port, () => {
      logger.info(`🚀 Orchestrator API running on port ${this.port}`);
    });
  }

  async stop() {
    if (this.assignmentLoop) {
      clearInterval(this.assignmentLoop);
    }
    await this.pmoWatcher.stop();
  }
}