# Test Suite Speed Audit

**Date:** 2026-03-13
**Ticket:** TKT-097

## Executive Summary

CI pipeline wall-clock time on `main` averages **10-13 minutes** across 20 recent runs. The critical path is the **execution e2e shard at ~9m20s** — nearly 2x the next-slowest shard. A redundant serial test job in `release.yml` burns **~27 extra CI minutes** per push to main.

### Changes Implemented

| Change | Impact |
|--------|--------|
| Remove redundant test job from `release.yml` | **~27 min CI minutes saved** per push to main |
| Split `execution` shard into `execution` + `agent-flows` | **~25-30% critical path reduction** (9m20s → ~6m) |
| Move `agent-json-mode.test.ts` from infrastructure to json-mode | Balances infrastructure (6.3k → 4.4k lines) |

**Estimated new CI wall-clock time:** ~7-8 minutes (down from 10-13 minutes).

---

## Benchmarks

### CI Wall-Clock Times (20 Most Recent `main` Runs)

| Run | Total | Critical Path Shard |
|-----|-------|-------------------|
| 23062373777 | 10m51s | execution (9m41s) |
| 23038384381 | 10m27s | execution (9m19s) |
| 23029258464 | 12m01s | execution (9m25s) |
| Average (20 runs) | ~11m30s | ~9m20s |

### Per-Shard Timing (Before Changes)

| Shard | Files | Lines | Avg Runtime | Status |
|-------|-------|-------|-------------|--------|
| execution | 12 | 7,454 | **9m20s** | BOTTLENECK |
| infrastructure | 4 | 6,329 | **7m40s** | Heavy |
| json-mode | 8 | 5,944 | 4m50s | OK |
| integrations | 10 | 5,321 | 3m55s | OK |
| pmo | 14 | 7,237 | 2m30s | Light |
| standalone | 18 | 7,287 | 1m45s | Light |

### Per-Shard Timing (Expected After Changes)

| Shard | Files | Lines | Est. Runtime |
|-------|-------|-------|-------------|
| agent-flows (NEW) | 9 | 5,429 | ~6-7m |
| json-mode (+ agent-json-mode) | 9 | 7,837 | ~5-6m |
| infrastructure (- agent-json-mode) | 3 | 4,436 | ~5-6m |
| execution (work-*.test.ts only) | 3 | 2,025 | ~2-3m |
| integrations | 10 | 5,321 | ~4m |
| pmo | 14 | 7,237 | ~2m30s |
| standalone | 18 | 7,287 | ~1m45s |

### Step-Level Breakdown (e2e-tests execution shard)

| Step | Duration |
|------|----------|
| Checkout + pnpm + Node setup | ~10s |
| pnpm install (cached) | ~15s |
| better-sqlite3 cache restore/rebuild | ~3s |
| Download build artifacts | ~2s |
| **Run e2e tests** | **~9m07s** |
| Total | ~9m41s |

Setup overhead is minimal (~30s). **The tests themselves are the bottleneck.**

### PR Runs (Smoke Tier)

PRs run only smoke-tagged tests and complete in **~4-5 minutes**. No changes needed.

---

## Findings

### 1. Redundant Serial Test Job in `release.yml` (FIXED)

The `release.yml` workflow contained a `test` job that ran ALL unit + e2e tests **serially** (~27 min) on every push to main. This was completely redundant with the parallelized `tests` workflow (`test.yml`) that also triggers on push to main.

The release job didn't even depend on it — `needs: [test]` was commented out with a TODO. Removed the entire redundant job.

### 2. Heavily Imbalanced E2E Shards (FIXED)

The execution shard was a 5:1 outlier vs standalone:

- execution: **9m20s** (12 files — `work-*.test.ts` + `*-agent-flow.test.ts`)
- standalone: **1m45s** (18 files)

**Root cause:** The `*-agent-flow.test.ts` tests are individually heavy — they test multi-step agent workflows with repeated CLI invocations and database operations. Bundling them with `work-*.test.ts` created the largest shard by far.

**Fix:** Split into two shards: `execution` (work-\*.test.ts) and `agent-flows` (\*-agent-flow.test.ts).

Also moved `agent-json-mode.test.ts` (1,893 lines — the single largest test file) from infrastructure to json-mode, where it logically belongs.

### 3. Agent-Flow Tests Are Inherently Slow

The 9 `*-agent-flow.test.ts` files (~5,429 lines) dominate runtime despite moderate line counts. Each test:
- Creates a fresh test environment with temp dirs
- Initializes a database from template
- Runs multiple CLI commands via `execInProcess()` (full oclif command init per call)
- Validates multi-step workflows (create project → create ticket → start work → etc.)

This is by design — they test real workflows. Further optimization would require deeper refactoring (e.g., batch operations, shared test state between related tests).

### 4. Mocha Parallel Mode Not Viable (Current Setup)

Mocha `--parallel` runs files in worker processes, but the current setup uses `ts-node/esm` via `--node-option loader=ts-node/esm`. Mocha's `--node-option` is **not forwarded** to worker processes in parallel mode, so TypeScript compilation would fail.

**Future option:** Migrate to vitest (native ESM + TypeScript + parallel by default) for a step-change improvement. This is a larger effort.

### 5. Test Infrastructure Is Already Well-Optimized

- **Template database caching** (`template-db.ts`): ~1ms copy vs ~100-200ms initialization
- **In-process execution** (`execInProcess()`): ~5x faster than subprocess
- **Test isolation**: Proper temp dirs, env var clearing, cleanup
- **Build artifact reuse**: E2E tests download pre-built `dist/` instead of rebuilding

### 6. Line Count ≠ Runtime

| Shard | Lines | Runtime | Lines/Min |
|-------|-------|---------|-----------|
| standalone | 7,287 | 1m45s | 4,164 |
| pmo | 7,237 | 2m30s | 2,895 |
| execution | 7,454 | 9m20s | 799 |

The execution shard processes lines 5x slower than standalone because agent-flow tests involve many multi-command sequences. Shard balancing should consider test complexity, not just file size.

---

## Optimization Opportunities (Future Work)

### Medium Effort

1. **Further shard rebalancing based on actual timing data**: After these changes land, measure new shard times and redistribute if needed. The `agent-flows` shard may still be the bottleneck at ~6-7m.

2. **Move `work-json-mode.test.ts` from execution to json-mode**: This 1,193-line file is a json-mode test with a `work-` prefix. Moving it would lighten the execution shard further, but requires pattern adjustments.

3. **Reduce per-test retries for fast tests**: `.mocharc.json` sets `retries: 1` globally. Flaky e2e tests benefit from retries, but fast unit tests don't need them. Consider setting retries only for e2e.

### Larger Effort

4. **Migrate to vitest**: Native ESM support, built-in TypeScript, parallel execution by default, faster test startup. Would likely cut test times by 30-50%.

5. **Shared test fixtures between related agent-flow tests**: Instead of each test creating its own environment from scratch, tests in the same file could share a pre-populated database for read-only checks.

6. **Mocha `--parallel` with pre-compiled tests**: Compile TypeScript to JS first (like the build step does), then run mocha in parallel mode against the compiled output. This bypasses the ts-node/esm worker limitation.

---

## Test Suite Overview

| Category | Files | Lines |
|----------|-------|-------|
| Unit tests | 67 | 19,573 |
| E2E tests | 69 | 37,779 |
| Command tests | 13 | 1,960 |
| **Total** | **149** | **59,312** |

**Framework:** Mocha v10 + Chai + ts-node/esm
**Database:** better-sqlite3 (native binding, cached template pattern)
**CI:** GitHub Actions with 7 parallel e2e shards (after this PR)
