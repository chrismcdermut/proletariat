import { OrchestratorAgent } from './orchestrator';
import { PMOWatcher } from './pmo-watcher';
import { TaskQueue } from './task-queue';
import { WorkerRegistry } from './worker-registry';
import { logger } from './utils/logger';

async function main() {
  logger.info('⚒️ PROLETARIAT ORCHESTRATOR STARTING ⚒️');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const taskQueue = new TaskQueue();
  const workerRegistry = new WorkerRegistry();
  const pmoWatcher = new PMOWatcher(taskQueue);
  
  const orchestrator = new OrchestratorAgent({
    taskQueue,
    workerRegistry,
    pmoWatcher
  });

  await orchestrator.start();
  
  logger.info('💰 The Central Committee is now in session!');
  logger.info('🚩 Workers of the codebase, unite!');
}

main().catch(err => {
  logger.error('Orchestrator failed to start:', err);
  process.exit(1);
});