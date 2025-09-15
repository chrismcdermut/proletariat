import { EventEmitter } from 'events';
import { Worker, WorkerAvailability } from './types';
import { logger } from './utils/logger';

export class WorkerRegistry extends EventEmitter {
  private workers: Map<string, Worker>;
  private heartbeatInterval: number = 30000; // 30 seconds
  private deadWorkerThreshold: number = 60000; // 60 seconds

  constructor() {
    super();
    this.workers = new Map();
    this.startHealthCheck();
  }

  private startHealthCheck() {
    setInterval(() => {
      this.checkWorkerHealth();
    }, this.heartbeatInterval);
  }

  private checkWorkerHealth() {
    const now = Date.now();
    for (const [id, worker] of this.workers.entries()) {
      const lastSeen = worker.lastHeartbeat.getTime();
      if (now - lastSeen > this.deadWorkerThreshold) {
        logger.warn(`💀 Worker ${worker.name} appears to be dead`);
        worker.availability = 'offline';
        this.emit('worker:offline', worker);
      }
    }
  }

  async register(workerData: Partial<Worker>): Promise<Worker> {
    const worker: Worker = {
      id: `worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: workerData.name || 'anonymous',
      theme: workerData.theme || 'billionaires',
      skills: workerData.skills || [],
      languages: workerData.languages || [],
      availability: 'idle',
      lastHeartbeat: new Date(),
      performance: workerData.performance || {
        tasksCompleted: 0,
        averageTime: 0,
        successRate: 100
      },
      ...workerData
    };

    this.workers.set(worker.id, worker);
    logger.info(`💰 Worker ${worker.name} registered with skills: ${worker.skills.join(', ')}`);
    this.emit('worker:registered', worker);
    
    if (worker.availability === 'idle') {
      this.emit('worker:available', worker);
    }

    return worker;
  }

  async unregister(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      this.workers.delete(workerId);
      logger.info(`👋 Worker ${worker.name} unregistered`);
      this.emit('worker:unregistered', worker);
    }
  }

  async heartbeat(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.lastHeartbeat = new Date();
      
      // Check if worker became available
      if (worker.availability === 'offline') {
        worker.availability = 'idle';
        this.emit('worker:online', worker);
        this.emit('worker:available', worker);
      }
    }
  }

  async updateAvailability(workerId: string, availability: WorkerAvailability): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      const previousAvailability = worker.availability;
      worker.availability = availability;
      
      if (previousAvailability !== 'idle' && availability === 'idle') {
        this.emit('worker:available', worker);
      }
      
      if (previousAvailability === 'idle' && availability !== 'idle') {
        this.emit('worker:busy', worker);
      }
    }
  }

  async assignTask(workerId: string, taskId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.currentTask = taskId;
      worker.availability = 'busy';
      this.emit('worker:busy', worker);
    }
  }

  async completeTask(workerId: string, success: boolean, time: number): Promise<void> {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.currentTask = undefined;
      worker.availability = 'idle';
      
      // Update performance metrics
      const perf = worker.performance;
      perf.tasksCompleted++;
      perf.averageTime = (perf.averageTime * (perf.tasksCompleted - 1) + time) / perf.tasksCompleted;
      if (!success) {
        perf.successRate = (perf.successRate * (perf.tasksCompleted - 1)) / perf.tasksCompleted;
      }
      
      this.emit('worker:available', worker);
    }
  }

  async getWorker(workerId: string): Promise<Worker | undefined> {
    return this.workers.get(workerId);
  }

  async getActiveWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values())
      .filter(worker => worker.availability !== 'offline');
  }

  async getIdleWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values())
      .filter(worker => worker.availability === 'idle');
  }

  async getBusyWorkers(): Promise<Worker[]> {
    return Array.from(this.workers.values())
      .filter(worker => worker.availability === 'busy');
  }

  async getWorkersBySkill(skill: string): Promise<Worker[]> {
    return Array.from(this.workers.values())
      .filter(worker => worker.skills.includes(skill) && worker.availability === 'idle');
  }

  async getWorkersByTheme(theme: string): Promise<Worker[]> {
    return Array.from(this.workers.values())
      .filter(worker => worker.theme === theme);
  }

  getWorkerStats(): {
    total: number;
    idle: number;
    busy: number;
    offline: number;
    byTheme: Record<string, number>;
  } {
    const workers = Array.from(this.workers.values());
    const stats = {
      total: workers.length,
      idle: workers.filter(w => w.availability === 'idle').length,
      busy: workers.filter(w => w.availability === 'busy').length,
      offline: workers.filter(w => w.availability === 'offline').length,
      byTheme: {} as Record<string, number>
    };

    workers.forEach(worker => {
      stats.byTheme[worker.theme] = (stats.byTheme[worker.theme] || 0) + 1;
    });

    return stats;
  }
}