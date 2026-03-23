/**
 * ORM Migration Performance Comparison
 *
 * Measures query-level performance for key PMO flows to detect material
 * regressions introduced by the raw-SQL-to-Drizzle ORM migration.
 *
 * Flows benchmarked:
 *  - Ticket list   (bulk SELECT with joins and filters)
 *  - Ticket view   (single SELECT with joins)
 *  - Ticket create (INSERT + related tables)
 *  - Work spawn selection prerequisites (workspace settings reads)
 *
 * Methodology:
 *  - Each benchmark runs N iterations and reports mean / p95 / max.
 *  - Tests are marked @perf so they can be run independently.
 *  - Assertions enforce a generous ceiling (5x of baseline) to catch
 *    catastrophic regressions without being flaky on CI.
 *
 * Run with: pnpm mocha --grep "@perf" test/unit/orm-migration-perf.test.ts
 */

import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SqliteDatabase } from '../../src/lib/database/sqlite.js'
import { SQLiteStorage } from '../../src/lib/pmo/storage-sqlite.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  mean: number;
  p95: number;
  max: number;
  min: number;
  iterations: number;
}

function bench(fn: () => void | Promise<void>, iterations: number): BenchResult {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    // All storage operations are synchronous under the hood (better-sqlite3)
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const max = times[times.length - 1];
  const min = times[0];

  return { mean, p95, max, min, iterations };
}

function formatResult(label: string, result: BenchResult): string {
  return (
    `[${label}] ${result.iterations} iterations — ` +
    `mean: ${result.mean.toFixed(2)}ms, ` +
    `p95: ${result.p95.toFixed(2)}ms, ` +
    `max: ${result.max.toFixed(2)}ms, ` +
    `min: ${result.min.toFixed(2)}ms`
  );
}

// Maximum acceptable mean latency per operation (ms).
// These are generous ceilings to catch catastrophic regressions only.
const PERF_CEILING = {
  ticketCreate: 20,   // create + subtasks + metadata
  ticketView: 10,     // single get with joins
  ticketList: 30,     // list with filter on 100+ tickets
  workspaceRead: 50,  // board read (statuses + tickets + columns)
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('@perf ORM Migration Performance Comparison', function (this: Mocha.Suite) {
  // Increase timeout for performance tests
  this.timeout(120_000);

  let testDir: string;
  let storage: SQLiteStorage;
  const projectId = 'perf-project';

  before(async function (this: Mocha.Context) {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-perf-'));
    const dbPath = path.join(testDir, 'perf.db');
    const db = new SqliteDatabase(dbPath);
    db.close();

    storage = new SQLiteStorage(dbPath);
    await storage.createProject({
      id: projectId,
      name: 'Performance Test Project',
      template: 'kanban',
    });

    // Seed 100 tickets spread across statuses for realistic list benchmarks
    const statuses = ['Backlog', 'To Do', 'In Progress', 'Done', 'Canceled'];
    const priorities = ['P0', 'P1', 'P2', 'P3'];
    const categories = ['feature', 'bug', 'refactor', 'chore'];

    for (let i = 0; i < 100; i++) {
      await storage.createTicket(projectId, {
        id: `PERF-${String(i).padStart(3, '0')}`,
        title: `Performance test ticket ${i}`,
        statusName: statuses[i % statuses.length],
        priority: priorities[i % priorities.length],
        category: categories[i % categories.length],
        description: `Description for performance test ticket number ${i}. `.repeat(3),
        subtasks: [
          { id: `sub-a-${i}`, title: `Subtask A for ${i}`, done: i % 2 === 0 },
          { id: `sub-b-${i}`, title: `Subtask B for ${i}`, done: false },
        ],
        metadata: {
          external_source: 'test',
          iteration: String(i),
        },
      });
    }
  });

  after(async function (this: Mocha.Context) {
    await storage.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 1. Ticket Create
  // -------------------------------------------------------------------------

  it('ticket create performance', async function () {
    let counter = 200;
    const result = bench(() => {
      counter++;
      // Using void to handle the promise (synchronous under the hood)
      void storage.createTicket(projectId, {
        id: `PCREATE-${counter}`,
        title: `Perf create ${counter}`,
        statusName: 'Backlog',
        priority: 'P2',
        category: 'feature',
        subtasks: [{ id: `sub-${counter}`, title: 'Sub 1', done: false }],
        metadata: { key: 'val' },
      });
    }, 50);

    console.log(`    ${formatResult('ticket:create', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketCreate,
      `Mean ticket create time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketCreate}ms)`
    );
  });

  // -------------------------------------------------------------------------
  // 2. Ticket View (getTicket by ID)
  // -------------------------------------------------------------------------

  it('ticket view performance', async function () {
    const ticketIds = Array.from({ length: 50 }, (_, i) => `PERF-${String(i).padStart(3, '0')}`);
    let idx = 0;

    const result = bench(() => {
      void storage.getTicket(ticketIds[idx % ticketIds.length]);
      idx++;
    }, 100);

    console.log(`    ${formatResult('ticket:view', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketView,
      `Mean ticket view time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketView}ms)`
    );
  });

  // -------------------------------------------------------------------------
  // 3. Ticket List (with filters)
  // -------------------------------------------------------------------------

  it('ticket list (unfiltered) performance', async function () {
    const result = bench(() => {
      void storage.listTickets(projectId);
    }, 50);

    console.log(`    ${formatResult('ticket:list:all', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketList,
      `Mean ticket list time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketList}ms)`
    );
  });

  it('ticket list (filtered by column) performance', async function () {
    const result = bench(() => {
      void storage.listTickets(projectId, { column: 'Backlog' });
    }, 50);

    console.log(`    ${formatResult('ticket:list:column', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketList,
      `Mean filtered list time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketList}ms)`
    );
  });

  it('ticket list (filtered by priority) performance', async function () {
    const result = bench(() => {
      void storage.listTickets(projectId, { priority: 'P0' });
    }, 50);

    console.log(`    ${formatResult('ticket:list:priority', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketList,
      `Mean priority-filtered list time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketList}ms)`
    );
  });

  it('ticket list (filtered by search) performance', async function () {
    const result = bench(() => {
      void storage.listTickets(projectId, { search: 'ticket 42' });
    }, 50);

    console.log(`    ${formatResult('ticket:list:search', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.ticketList,
      `Mean search list time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.ticketList}ms)`
    );
  });

  // -------------------------------------------------------------------------
  // 4. Workspace Settings Read (work spawn prerequisite)
  // -------------------------------------------------------------------------

  it('workspace settings read performance', async function () {
    // Board reads exercise the same code path used by work spawn to resolve
    // project context and available statuses.
    const result = bench(() => {
      void storage.getBoard(projectId);
    }, 100);

    console.log(`    ${formatResult('workspace:board-read', result)}`);
    expect(result.mean).to.be.lessThan(
      PERF_CEILING.workspaceRead,
      `Mean board read time (${result.mean.toFixed(2)}ms) exceeds ceiling (${PERF_CEILING.workspaceRead}ms)`
    );
  });

  // -------------------------------------------------------------------------
  // 5. Summary Table
  // -------------------------------------------------------------------------

  after(function () {
    console.log('\n    ┌──────────────────────────────────────────┐');
    console.log('    │  ORM Migration Performance Summary       │');
    console.log('    │  All ceilings are generous guards        │');
    console.log('    │  against catastrophic regression only.   │');
    console.log('    └──────────────────────────────────────────┘');
  });
});
