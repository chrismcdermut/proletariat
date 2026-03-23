#!/usr/bin/env node

/**
 * cleanup-test-artifacts.mjs
 *
 * Removes test data artifacts from the workspace database:
 * - Test projects (test-*, link-test, project-a, project-b, project-one, project-two)
 * - Ghost repos (new-repo, agent-repo, direct-repo)
 * - Test themes (non-builtin) and their names
 * - Test actions (non-builtin)
 * - Test agent names polluting builtin themes
 * - Fixes workspace active_theme_id if pointing to a test theme
 *
 * Usage: node scripts/cleanup-test-artifacts.mjs [--dry-run] [--db <path>]
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', 'apps', 'cli', 'package.json'));
const Database = require('better-sqlite3');

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbIndex = args.indexOf('--db');
const dbPath = dbIndex !== -1 ? args[dbIndex + 1] : '/hq/.proletariat/workspace.db';

console.log(`Database: ${dbPath}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will modify database)'}\n`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// ─── Test project IDs to remove ──────────────────────────────────────────────
// Pattern-based: test-delete-*, test-project-*
// Named: test, link-test, project-a, project-b, project-one, project-two
const testProjectPatterns = [
  "id LIKE 'test-delete-%'",
  "id LIKE 'test-project-%'",
  "id IN ('test', 'link-test', 'project-a', 'project-b', 'project-one', 'project-two')",
];
const testProjectWhere = testProjectPatterns.join(' OR ');

// ─── Ghost repos to remove ───────────────────────────────────────────────────
const ghostRepos = ['new-repo', 'agent-repo', 'direct-repo'];

// ─── Test themes to remove (non-builtin) ─────────────────────────────────────
// We keep builtin themes (billionaires, companies, toyotas)
const testThemeWhere = "builtin = 0";

// ─── Test actions to remove (non-builtin) ────────────────────────────────────
const testActionWhere = "is_builtin = 0";

// ─── Test agent names in builtin themes ──────────────────────────────────────
const testThemeNames = ['new-test-name-1234'];

// ─── Test agents ─────────────────────────────────────────────────────────────
const testAgents = ['alice', 'bob', 'prlttest1', 'prlttest2', 'prlttest3'];

// ─── Report and clean ────────────────────────────────────────────────────────

function report(label, rows) {
  console.log(`--- ${label} ---`);
  if (rows.length === 0) {
    console.log('  (none found)');
  } else {
    rows.forEach(r => console.log(`  ${JSON.stringify(r)}`));
    console.log(`  Total: ${rows.length}`);
  }
  console.log('');
}

// 1. Test projects
const testProjects = db.prepare(`SELECT id, name FROM pmo_projects WHERE ${testProjectWhere}`).all();
report('Test projects to remove', testProjects);

// 2. Tickets in test projects
const testTickets = db.prepare(`SELECT id, project_id, title FROM pmo_tickets WHERE project_id IN (SELECT id FROM pmo_projects WHERE ${testProjectWhere})`).all();
report('Tickets in test projects to remove', testTickets);

// 3. Ghost repos
const repos = db.prepare(`SELECT name, path, action FROM repositories WHERE name IN (${ghostRepos.map(() => '?').join(',')})`).all(...ghostRepos);
report('Ghost repos to remove', repos);

// 4. Test themes
const testThemes = db.prepare(`SELECT id, name, display_name FROM agent_themes WHERE ${testThemeWhere}`).all();
report('Test themes to remove', testThemes);

// 5. Test theme names in builtin themes
const testNames = db.prepare(`SELECT theme_id, name FROM agent_theme_names WHERE name IN (${testThemeNames.map(() => '?').join(',')})`).all(...testThemeNames);
report('Test names in builtin themes to remove', testNames);

// 6. Test actions
const testActions = db.prepare(`SELECT id, name FROM pmo_actions WHERE ${testActionWhere}`).all();
report('Test actions to remove', testActions);

// 7. Test agents
const testAgentRows = db.prepare(`SELECT name, type, status FROM agents WHERE name IN (${testAgents.map(() => '?').join(',')})`).all(...testAgents);
report('Test agents to remove', testAgentRows);

// 8. Workspace active_theme_id fix
const workspace = db.prepare('SELECT active_theme_id FROM workspace WHERE id = 1').get();
const needsThemeFix = workspace && testThemes.some(t => t.id === workspace.active_theme_id);
if (needsThemeFix) {
  console.log(`--- Workspace active_theme_id fix ---`);
  console.log(`  Current: ${workspace.active_theme_id} (test theme)`);
  console.log(`  Will change to: billionaires (builtin)\n`);
}

if (dryRun) {
  console.log('=== DRY RUN: No changes made. Run without --dry-run to apply. ===');
  db.close();
  process.exit(0);
}

// ─── Execute cleanup in a transaction ────────────────────────────────────────
const cleanup = db.transaction(() => {
  let totalDeleted = 0;

  // 1. Delete tickets in test projects (before projects due to FK)
  const ticketResult = db.prepare(`DELETE FROM pmo_tickets WHERE project_id IN (SELECT id FROM pmo_projects WHERE ${testProjectWhere})`).run();
  console.log(`Deleted ${ticketResult.changes} tickets from test projects`);
  totalDeleted += ticketResult.changes;

  // 2. Delete test projects
  const projectResult = db.prepare(`DELETE FROM pmo_projects WHERE ${testProjectWhere}`).run();
  console.log(`Deleted ${projectResult.changes} test projects`);
  totalDeleted += projectResult.changes;

  // 3. Delete ghost repos
  const repoResult = db.prepare(`DELETE FROM repositories WHERE name IN (${ghostRepos.map(() => '?').join(',')})`).run(...ghostRepos);
  console.log(`Deleted ${repoResult.changes} ghost repos`);
  totalDeleted += repoResult.changes;

  // 4. Fix workspace active_theme_id before deleting themes
  if (needsThemeFix) {
    db.prepare("UPDATE workspace SET active_theme_id = 'billionaires' WHERE id = 1").run();
    console.log(`Fixed workspace active_theme_id: ${workspace.active_theme_id} -> billionaires`);
  }

  // 5. Delete test theme names (cascade handles non-builtin themes, but clean builtin pollutants)
  const nameResult = db.prepare(`DELETE FROM agent_theme_names WHERE name IN (${testThemeNames.map(() => '?').join(',')})`).run(...testThemeNames);
  console.log(`Deleted ${nameResult.changes} test names from builtin themes`);
  totalDeleted += nameResult.changes;

  // 6. Delete test theme names for non-builtin themes (before themes due to FK)
  const themeNameResult = db.prepare(`DELETE FROM agent_theme_names WHERE theme_id IN (SELECT id FROM agent_themes WHERE ${testThemeWhere})`).run();
  console.log(`Deleted ${themeNameResult.changes} names from test themes`);
  totalDeleted += themeNameResult.changes;

  // 7. Delete test themes
  const themeResult = db.prepare(`DELETE FROM agent_themes WHERE ${testThemeWhere}`).run();
  console.log(`Deleted ${themeResult.changes} test themes`);
  totalDeleted += themeResult.changes;

  // 8. Delete test actions
  const actionResult = db.prepare(`DELETE FROM pmo_actions WHERE ${testActionWhere}`).run();
  console.log(`Deleted ${actionResult.changes} test actions`);
  totalDeleted += actionResult.changes;

  // 9. Delete test agents
  const agentResult = db.prepare(`DELETE FROM agents WHERE name IN (${testAgents.map(() => '?').join(',')})`).run(...testAgents);
  console.log(`Deleted ${agentResult.changes} test agents`);
  totalDeleted += agentResult.changes;

  console.log(`\nTotal rows affected: ${totalDeleted}`);
});

cleanup();

// ─── Verify ──────────────────────────────────────────────────────────────────
console.log('\n=== Verification ===');
const remainingTestProjects = db.prepare(`SELECT COUNT(*) as count FROM pmo_projects WHERE ${testProjectWhere}`).get();
console.log(`Remaining test projects: ${remainingTestProjects.count}`);

const remainingGhostRepos = db.prepare(`SELECT COUNT(*) as count FROM repositories WHERE name IN (${ghostRepos.map(() => '?').join(',')})`).get(...ghostRepos);
console.log(`Remaining ghost repos: ${remainingGhostRepos.count}`);

const remainingTestThemes = db.prepare(`SELECT COUNT(*) as count FROM agent_themes WHERE ${testThemeWhere}`).get();
console.log(`Remaining test themes: ${remainingTestThemes.count}`);

const remainingTestActions = db.prepare(`SELECT COUNT(*) as count FROM pmo_actions WHERE ${testActionWhere}`).get();
console.log(`Remaining test actions: ${remainingTestActions.count}`);

const finalWorkspace = db.prepare('SELECT active_theme_id FROM workspace WHERE id = 1').get();
console.log(`Workspace active_theme_id: ${finalWorkspace.active_theme_id}`);

const totalProjects = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get();
console.log(`Total remaining projects: ${totalProjects.count}`);

const totalRepos = db.prepare('SELECT COUNT(*) as count FROM repositories').get();
console.log(`Total remaining repos: ${totalRepos.count}`);

db.close();
console.log('\nCleanup complete!');
