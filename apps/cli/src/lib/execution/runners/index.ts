/**
 * Execution Runners
 *
 * Dispatcher and re-exports for all execution environment runners.
 * Each runner is in its own module for independent testability and maintainability.
 *
 * Modules:
 * - shared.ts — Shared utilities (session names, credentials, docker, prompts, etc.)
 * - host.ts — Host runner with tmux session persistence
 * - devcontainer.ts — Docker container runner with raw Docker commands
 * - docker.ts — Simple detached Docker container runner
 * - orchestrator.ts — Orchestrator-in-Docker runner (sibling container pattern)
 * - sandbox.ts — srt sandbox runner (wraps host runner)
 * - cloud.ts — Remote execution via SSH
 */

import {
  ExecutionEnvironment,
  DisplayMode,
  SessionManager,
  ExecutorType,
  ExecutionContext,
  ExecutionConfig,
  DEFAULT_EXECUTION_CONFIG,
  normalizeEnvironment,
} from './shared.js'

import { RunnerResult, ensureTmuxServerHasKeychainAccess } from './shared.js'
import { runHost } from './host.js'
import { runDevcontainer } from './devcontainer.js'
import { runDocker } from './docker.js'
import { runOrchestratorInDocker } from './orchestrator.js'
import { runSandbox } from './sandbox.js'
import { runCloud } from './cloud.js'

// =============================================================================
// Runner Dispatcher
// =============================================================================

export async function runExecution(
  environment: ExecutionEnvironment,
  context: ExecutionContext,
  executor: ExecutorType,
  config: ExecutionConfig = DEFAULT_EXECUTION_CONFIG,
  options?: { host?: string; displayMode?: DisplayMode; sessionManager?: SessionManager }
): Promise<RunnerResult> {
  // Ensure context knows its execution environment
  if (!context.executionEnvironment) {
    context.executionEnvironment = environment
  }

  // Normalize environment (maps 'vm' -> 'cloud')
  const normalizedEnv = normalizeEnvironment(environment)

  // Ensure tmux server has keychain access for OAuth (host/sandbox only)
  // Docker uses claude-credentials volume, devcontainer runs inside container
  if (normalizedEnv === 'host' || normalizedEnv === 'sandbox') {
    await ensureTmuxServerHasKeychainAccess()
  }

  switch (normalizedEnv) {
    case 'devcontainer':
      return runDevcontainer(context, executor, config, options?.displayMode, options?.sessionManager)
    case 'host':
      return runHost(context, executor, config, options?.displayMode)
    case 'sandbox':
      return runSandbox(context, executor, config, options?.displayMode)
    case 'docker':
      return runDocker(context, executor, config)
    case 'cloud':
      return runCloud(context, executor, config, options?.host)
    default:
      return { success: false, error: `Unknown execution environment: ${environment}` }
  }
}

// =============================================================================
// Re-exports — All public API from the old monolithic runners.ts
// =============================================================================

// Shared utilities
export {
  // Runner types
  RunnerResult,
  Runner,
  // Session/title helpers
  buildSessionName,
  buildWindowTitle,
  buildTmuxWindowName,
  // Control mode helpers
  shouldUseControlMode,
  buildTmuxMouseOption,
  buildTmuxAttachCommand,
  configureITermTmuxPreferences,
  configureITermTmuxWindowMode,
  // Credential helpers
  CLAUDE_CREDENTIALS_VOLUME,
  credentialsVolumeExists,
  dockerCredentialsExist,
  getDockerCredentialInfo,
  hostCredentialsExist,
  // Executor helpers
  getExecutorCommand,
  isClaudeExecutor,
  getExecutorDisplayName,
  getExecutorPackage,
  PreflightResult,
  checkExecutorOnHost,
  checkExecutorInContainer,
  runExecutorPreflight,
  // GitHub token
  getGitHubToken,
  isGitHubTokenAvailable,
  // Docker status
  DockerDaemonStatus,
  checkDockerDaemon,
  isDockerRunning,
  isDevcontainerCliInstalled,
  // Docker container management
  getHostPrltVersion,
  getAgentContainerName,
  containerExists,
  isContainerRunning,
  getContainerId,
  // Prompt building
  buildPrompt,
  buildOrchestratorSystemPrompt,
  buildIntegrationCommandsSection,
} from './shared.js'

// Individual runners
export { runHost } from './host.js'
export { runDevcontainer, buildDevcontainerCommand } from './devcontainer.js'
export { runDocker } from './docker.js'
export { runOrchestratorInDocker } from './orchestrator.js'
export { runSandbox, isSrtInstalled, buildSrtCommand } from './sandbox.js'
export { runCloud, runVm } from './cloud.js'

