/**
 * Schema Template Cache — eliminates per-test DB setup overhead.
 *
 * Instead of running full schema initialization (30+ tables, migrations, seeding)
 * for every test (~100-200ms each), this module:
 * 1. Creates a template database once with the full production schema + seed data
 * 2. Caches it at /tmp/prlt-test-template-<hash>.db
 * 3. For each test, copies the template via fs.copyFileSync (~1ms)
 *
 * The hash is computed from the source files that determine DB content
 * (schema.ts, base.ts, templates-builtin.ts, utils.ts), so the template
 * is automatically regenerated when schema or seed data changes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { initializePMOTables } from '../../src/lib/pmo/storage/base.js';
import { PMO_TABLES } from '../../src/lib/pmo/schema.js';

const T = PMO_TABLES;

/**
 * Source files that determine the template database contents.
 * If any of these change, the cached template is invalidated.
 */
const SCHEMA_SOURCE_FILES = [
  '../../src/lib/pmo/schema.ts',
  '../../src/lib/pmo/storage/base.ts',
  '../../src/lib/pmo/templates-builtin.ts',
  '../../src/lib/pmo/utils.ts',
  '../../src/lib/database/index.ts',
];

/** In-memory cached path to the template DB, so we don't recompute the hash repeatedly. */
let cachedTemplatePath: string | null = null;

/**
 * Compute a SHA-256 hash of all schema source files.
 * This is used to key the template DB so it's recreated when schema changes.
 */
function computeSchemaHash(): string {
  const hasher = crypto.createHash('sha256');
  const thisDir = path.dirname(new URL(import.meta.url).pathname);

  for (const relPath of SCHEMA_SOURCE_FILES) {
    const absPath = path.resolve(thisDir, relPath);
    try {
      hasher.update(fs.readFileSync(absPath));
    } catch {
      // File doesn't exist yet (e.g., during initial setup) — include path as fallback
      hasher.update(relPath);
    }
  }

  return hasher.digest('hex').slice(0, 16);
}

/**
 * Get the path to the cached template database, creating it if needed.
 * The template includes: full PMO schema, all seeded builtin data.
 */
function ensureTemplatePath(): string {
  if (cachedTemplatePath && fs.existsSync(cachedTemplatePath)) {
    return cachedTemplatePath;
  }

  const hash = computeSchemaHash();
  const templatePath = path.join(os.tmpdir(), `prlt-test-template-${hash}.db`);

  if (!fs.existsSync(templatePath)) {
    // Create the template database with full schema + seed data
    const db = new Database(templatePath);
    try {
      db.pragma('foreign_keys = ON');
      initializePMOTables(db);
      // Store a placeholder for pmo_path — tests will overwrite this per-test
      db.prepare(`INSERT OR REPLACE INTO ${T.settings} (key, value) VALUES ('pmo_path', ?)`).run('__TEMPLATE__');
    } finally {
      db.close();
    }
  }

  cachedTemplatePath = templatePath;
  return templatePath;
}

/**
 * Set up a test database by copying the cached template.
 * This is ~100x faster than running full schema initialization.
 *
 * @param dbPath - Path where the test database should be created
 * @param pmoPath - PMO directory path to store in settings
 * @returns Database instance ready for use
 */
export function setupProductionSchemaFromCache(dbPath: string, pmoPath: string): Database.Database {
  const templatePath = ensureTemplatePath();

  // Copy template to test location (~1ms vs ~100-200ms for full init)
  fs.copyFileSync(templatePath, dbPath);

  // Open the copy and update the pmo_path setting
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.prepare(`UPDATE ${T.settings} SET value = ? WHERE key = 'pmo_path'`).run(pmoPath);

  return db;
}

/**
 * Invalidate the in-memory cache pointer.
 * Useful if schema files are modified during a test run (unlikely in practice).
 */
export function invalidateTemplateCache(): void {
  cachedTemplatePath = null;
}
