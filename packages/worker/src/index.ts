import { WorkerAgent } from './worker-agent';
import { logger } from './utils/logger';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const workerName = process.env.WORKER_NAME || process.argv[2] || 'anonymous';
  const workerTheme = process.env.WORKER_THEME || 'billionaires';
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';

  logger.info('⚒️ PROLETARIAT WORKER STARTING ⚒️');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`💰 Worker: ${workerName}`);
  logger.info(`🎨 Theme: ${workerTheme}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const worker = new WorkerAgent({
    name: workerName,
    theme: workerTheme as any,
    orchestratorUrl,
    skills: process.env.WORKER_SKILLS?.split(',') || ['general'],
    languages: process.env.WORKER_LANGUAGES?.split(',') || ['javascript', 'typescript']
  });

  await worker.start();
  
  logger.info(`💰 ${workerName.toUpperCase()} is ready to work!`);
  logger.info('🚩 This worker serves the revolution!');
}

main().catch(err => {
  logger.error('Worker failed to start:', err);
  process.exit(1);
});