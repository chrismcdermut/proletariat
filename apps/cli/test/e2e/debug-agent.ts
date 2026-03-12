import {
  createTestEnvironment,
  cleanupTestEnvironment,
  createHQConfig,
  createPMODirectories,
  setupProductionSchema,
  createTestProject,
  addWorkspaceTables,
  execInProcess,
  type TestEnvironment,
} from './test-helpers.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const env = createTestEnvironment('debug-agent-');
const db = setupProductionSchema(env.dbPath, env.pmoPath);
createTestProject(db, { id: 'default', name: 'Default Project' });
addWorkspaceTables(db);
createHQConfig(env.proletariatDir);
createPMODirectories(env.pmoPath, 'test-project');

// Create agents directory
const agentsDir = path.join(env.testDir, 'agents');
fs.mkdirSync(path.join(agentsDir, 'staff'), { recursive: true });
fs.mkdirSync(path.join(agentsDir, 'temp'), { recursive: true });

// Create a test agent
const agentPath = path.join(agentsDir, 'staff', 'test-agent-1');
fs.mkdirSync(agentPath, { recursive: true });
fs.mkdirSync(path.join(agentPath, '.git'), { recursive: true });
fs.writeFileSync(path.join(agentPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
db.prepare(`INSERT INTO agents (name, type, status, worktree_path, created_at) VALUES (?, ?, ?, ?, datetime('now'))`).run('test-agent-1', 'persistent', 'active', 'agents/staff/test-agent-1');

console.log('Test env ready at:', env.testDir);
console.log('Running: agent --machine');

try {
  const output = await execInProcess('agent --machine');
  console.log('OUTPUT:', output);
} catch (e) {
  console.error('ERROR:', e);
} finally {
  db.close();
  cleanupTestEnvironment(env);
  console.log('Cleanup done');
}
