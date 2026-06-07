/**
 * Execution Runners — Re-export barrel
 *
 * This file has been refactored into separate modules under ./runners/.
 * All exports are preserved for backwards compatibility.
 *
 * @see ./runners/index.ts — Dispatcher and re-exports
 * @see ./runners/shared.ts — Shared utilities
 * @see ./runners/host.ts — Host runner
 * @see ./runners/devcontainer.ts — Devcontainer runner
 * @see ./runners/docker-management.ts — Container lifecycle + simple detached runDocker (PRLT-1365)
 * @see ./runners/orchestrator.ts — Orchestrator-in-Docker runner
 * @see ./runners/sandbox.ts — Sandbox runner
 * @see ./runners/cloud.ts — Cloud/VM runner
 */

export * from './runners/index.js'
