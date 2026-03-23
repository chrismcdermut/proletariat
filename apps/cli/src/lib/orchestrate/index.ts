/**
 * Orchestrate module — public API.
 *
 * Event-driven pipeline automation daemon with HITL controls.
 * Extends the work-lifecycle hook system with built-in actions,
 * YAML config loading, presets, and mode-aware execution.
 */

export type {
  OrchestrateEvent,
  HookMode,
  BuiltinAction,
  HooksYaml,
  HookYamlEntry,
  WorkflowYaml,
  PresetName,
  OrchestrateEventContext,
  OrchestrateActionResult,
} from './types.js'

export {
  ORCHESTRATE_EVENTS,
  HOOK_MODES,
  BUILTIN_ACTIONS,
  PRESET_NAMES,
} from './types.js'

export {
  PRESETS,
  getPreset,
} from './presets.js'

export {
  loadHooksYaml,
  loadWorkflowYaml,
  syncHooksFromYaml,
  applyPreset,
  exportHooksToYaml,
} from './config-loader.js'

export {
  ACTION_HANDLERS,
  executeBuiltinAction,
} from './actions.js'

export {
  OrchestrateEngine,
  initOrchestrateEngine,
  getOrchestrateEngine,
  stopOrchestrateEngine,
} from './engine.js'

export type { OrchestrateEngineOptions } from './engine.js'
