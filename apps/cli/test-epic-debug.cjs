const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// Create temp test directory
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-test-'));
process.chdir(testDir);
console.log('Test dir:', testDir);

// Create .proletariat directory
const proletariatDir = path.join(testDir, '.proletariat');
fs.mkdirSync(proletariatDir, { recursive: true });

// Create config.json
fs.writeFileSync(path.join(proletariatDir, 'config.json'), JSON.stringify({
  type: 'hq',
  name: 'test-hq',
  hasPmo: true,
}));

// Create database
const dbPath = path.join(proletariatDir, 'workspace.db');
const db = new Database(dbPath);

// Setup tables
db.exec(`
  CREATE TABLE pmo_settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE pmo_projects (id TEXT PRIMARY KEY, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE pmo_columns (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, position INTEGER);
  CREATE TABLE pmo_epics (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, status TEXT DEFAULT 'active', file_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE pmo_tickets (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, status TEXT DEFAULT 'backlog', epic_id TEXT);
  CREATE TABLE pmo_board_tickets (id INTEGER PRIMARY KEY, project_id TEXT, ticket_id TEXT UNIQUE, column_id TEXT, position INTEGER);
`);

db.prepare("INSERT INTO pmo_projects (id, name) VALUES ('test-project', 'Test Project')").run();
db.prepare("INSERT INTO pmo_settings (key, value) VALUES ('pmo_path', 'pmo'), ('current_project', 'test-project'), ('next_epic_id', '1')").run();
db.prepare("INSERT INTO pmo_columns (id, project_id, name, position) VALUES ('backlog', 'test-project', 'Backlog', 0)").run();
db.close();

// Create PMO directory structure
const pmoPath = path.join(testDir, 'pmo/projects/test-project/epics/active');
fs.mkdirSync(pmoPath, { recursive: true });

console.log('Files in test dir:');
console.log(execSync('find . -type f', { encoding: 'utf-8' }));

// Run epic create
try {
  const binPath = path.join(__dirname, 'bin/run.js');
  console.log('Running:', `node ${binPath} epic create --title "Test Epic"`);
  const result = execSync(`node ${binPath} epic create --title "Test Epic"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: testDir,
  });
  console.log('SUCCESS:', result);
} catch (e) {
  console.log('ERROR stdout:', e.stdout);
  console.log('ERROR stderr:', e.stderr);
  console.log('ERROR message:', e.message);
}

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
