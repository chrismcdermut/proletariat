/**
 * Template database cache for test performance optimization.
 *
 * Creates and caches template databases with full schema + seed data.
 * Tests copy the template file (~1ms) instead of running full initialization (~100-200ms).
 * Template is invalidated when schema source files change (content-based hash).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import { CREATE_TABLES_SQL } from '../../src/lib/database/index.js';
import { runDrizzleMigrations } from '../../src/lib/database/migrator.js';
import { ALL_MIGRATIONS } from '../../src/lib/database/migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Source files that affect template DB content.
 * If any of these change, the cached template is invalidated.
 */
const SCHEMA_SOURCE_FILES = [
  '../../src/lib/pmo/schema.ts',
  '../../src/lib/pmo/storage/base.ts',
  '../../src/lib/pmo/templates-builtin.ts',
  '../../src/lib/pmo/utils.ts',
  '../../src/lib/pmo/types.ts',
  '../../src/lib/database/index.ts',
  '../../src/lib/database/workspace-schema.ts',
  '../../src/lib/database/migrator.ts',
  '../../src/lib/database/migrations/index.ts',
].map(f => path.resolve(__dirname, f));

/**
 * Compute a content-based hash of all schema source files.
 * Used as the cache key — template is recreated when any source file changes.
 */
function computeSchemaHash(): string {
  const hash = crypto.createHash('sha256');
  for (const file of SCHEMA_SOURCE_FILES) {
    if (fs.existsSync(file)) {
      hash.update(fs.readFileSync(file, 'utf-8'));
    }
  }
  return hash.digest('hex').slice(0, 16);
}

// Lazily computed schema hash (stable within a process)
let _schemaHash: string | null = null;
function getSchemaHash(): string {
  if (!_schemaHash) {
    _schemaHash = computeSchemaHash();
  }
  return _schemaHash;
}

// In-memory cache of verified template paths
let _pmoTemplatePath: string | null = null;
let _workspaceTemplatePath: string | null = null;

/**
 * Get or create a cached PMO template database.
 * Includes full schema (30+ tables) and all seeded builtin data
 * (workflows, phases, actions, templates, priorities, labels).
 *
 * @returns Path to the template file — copy with fs.copyFileSync for each test
 */
export function getOrCreatePMOTemplate(): string {
  if (_pmoTemplatePath && fs.existsSync(_pmoTemplatePath)) {
    return _pmoTemplatePath;
  }

  const hash = getSchemaHash();
  const templatePath = path.join(os.tmpdir(), `prlt-test-template-pmo-${hash}.db`);

  if (fs.existsSync(templatePath)) {
    _pmoTemplatePath = templatePath;
    return templatePath;
  }

  // Create in a temp file, then atomically rename (safe for concurrent processes)
  const tmpPath = `${templatePath}.${process.pid}.tmp`;
  const db = new SqliteDatabase(tmpPath);
  db.pragma('foreign_keys = ON');
  initializePMOTables(db);
  db.close();
  fs.renameSync(tmpPath, templatePath);

  _pmoTemplatePath = templatePath;
  return templatePath;
}

/**
 * Get or create a cached workspace template database.
 * Includes workspace schema tables (workspace, repositories, agents, themes, etc.)
 * but no data rows — tests insert their own workspace row after copying.
 *
 * @returns Path to the template file — copy with fs.copyFileSync for each test
 */
export function getOrCreateWorkspaceTemplate(): string {
  if (_workspaceTemplatePath && fs.existsSync(_workspaceTemplatePath)) {
    return _workspaceTemplatePath;
  }

  const hash = getSchemaHash();
  const templatePath = path.join(os.tmpdir(), `prlt-test-template-workspace-${hash}.db`);

  if (fs.existsSync(templatePath)) {
    _workspaceTemplatePath = templatePath;
    return templatePath;
  }

  const tmpPath = `${templatePath}.${process.pid}.tmp`;
  const db = new SqliteDatabase(tmpPath);
  db.pragma('foreign_keys = ON');
  runDrizzleMigrations(db, ALL_MIGRATIONS);
  db.close();
  fs.renameSync(tmpPath, templatePath);

  _workspaceTemplatePath = templatePath;
  return templatePath;
}
