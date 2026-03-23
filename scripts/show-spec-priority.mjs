#!/usr/bin/env node
/**
 * Show specs ordered by priority with completion status
 */

import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../../.proletariat/workspace.db');

const SQL = await initSqlJs();
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

function prepare(sql) {
  return {
    all() {
      const stmt = db.prepare(sql);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    }
  };
}

console.log('\n📊 Spec Prioritization Dashboard\n');
console.log('═'.repeat(80));

// Get all specs with ticket counts
const specs = prepare(`
  SELECT
    s.id,
    s.title,
    s.status,
    COUNT(t.id) as total_tickets,
    SUM(CASE
      WHEN c.name IN ('Merged', 'Published') THEN 1
      ELSE 0
    END) as done_tickets
  FROM pmo_specs s
  LEFT JOIN pmo_tickets t ON t.spec_id = s.id
  LEFT JOIN pmo_board_tickets bt ON bt.ticket_id = t.id
  LEFT JOIN pmo_columns c ON c.id = bt.column_id
  GROUP BY s.id
  ORDER BY s.status DESC, s.created_at ASC
`).all();

// Priority order (manual for now - could be in database)
const priority = {
  'pmo-schema-refactor': { order: 0, moscow: 'DONE', phase: 'Foundation' },
  'pmo-ticket-commands': { order: 1, moscow: 'MUST', phase: 'Core CRUD' },
  'pmo-board-commands': { order: 2, moscow: 'MUST', phase: 'Core CRUD' },
  'pmo-spec-commands': { order: 3, moscow: 'SHOULD', phase: 'Core CRUD' },
  'pmo-project-commands': { order: 4, moscow: 'SHOULD', phase: 'Core CRUD' },
  'pmo-board-views': { order: 5, moscow: 'COULD', phase: 'Views' },
  'pmo-work-commands': { order: 6, moscow: 'FUTURE', phase: 'Advanced' },
  'pmo-local-sync': { order: 7, moscow: 'FUTURE', phase: 'Advanced' },
};

// Group by phase
const phases = {};
specs.forEach(spec => {
  const pri = priority[spec.id] || { order: 99, moscow: 'UNKNOWN', phase: 'Other' };
  const phase = pri.phase;

  if (!phases[phase]) phases[phase] = [];

  const pct = spec.total_tickets > 0
    ? Math.round((spec.done_tickets / spec.total_tickets) * 100)
    : 0;

  const status = pct === 100 ? '✅' : pct > 0 ? '🟡' : '❌';

  phases[phase].push({
    ...spec,
    priority: pri.order,
    moscow: pri.moscow,
    pct,
    status
  });
});

// Display by phase
const phaseOrder = ['Foundation', 'Core CRUD', 'Views', 'Advanced', 'Other'];

phaseOrder.forEach(phase => {
  if (!phases[phase] || phases[phase].length === 0) return;

  console.log(`\n${phase}`);
  console.log('─'.repeat(80));

  phases[phase]
    .sort((a, b) => a.priority - b.priority)
    .forEach(spec => {
      const bar = '█'.repeat(Math.floor(spec.pct / 5)) + '░'.repeat(20 - Math.floor(spec.pct / 5));
      const tickets = `${spec.done_tickets}/${spec.total_tickets}`;

      console.log(
        `${spec.status} [P${spec.priority}] ${spec.id.padEnd(25)} ` +
        `${spec.moscow.padEnd(8)} ${bar} ${spec.pct}% (${tickets} tickets)`
      );
    });
});

console.log('\n' + '═'.repeat(80));

// Recommendations
console.log('\n💡 Recommendations:\n');

const notDone = specs.filter(s => {
  const pri = priority[s.id];
  return pri && pri.moscow !== 'DONE' && pri.moscow !== 'FUTURE' && s.pct < 100;
});

if (notDone.length > 0) {
  const next = notDone.sort((a, b) => {
    const priA = priority[a.id]?.order || 99;
    const priB = priority[b.id]?.order || 99;
    return priA - priB;
  })[0];

  console.log(`   1. Focus on: ${next.id} (${next.done_tickets}/${next.total_tickets} tickets complete)`);

  if (next.id === 'pmo-ticket-commands' && next.done_tickets < 2) {
    console.log('      → Implement pmo-ticket-commands-001: prlt ticket list');
    console.log('      → Implement pmo-ticket-commands-002: prlt ticket view');
  }
}

console.log('\n   2. Defer to future: pmo-work-commands, pmo-local-sync');
console.log('   3. Test completed specs manually before moving on\n');

// Legend
console.log('Legend: ✅ Done | 🟡 In Progress | ❌ Not Started');
console.log('        MUST=Critical | SHOULD=Important | COULD=Nice-to-have | FUTURE=Later\n');

db.close();
