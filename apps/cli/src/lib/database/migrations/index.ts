/**
 * Migration registry.
 *
 * All migrations must be imported here and added to ALL_MIGRATIONS
 * in chronological order. The migrator applies them in array order.
 */

import type { Migration } from '../migrator.js'
import { baseline } from './0001_baseline.js'
import { workHooks } from './0002_work_hooks.js'
import { actionsRedesign } from './0003_actions_redesign.js'
import { workflowRules } from './0004_workflow_rules.js'
import { providerStatusMapping } from './0005_provider_status_mapping.js'
import { dropThemeNamesUsed } from './0006_drop_theme_names_used.js'
import { addWorktreeColumns } from './0007_add_worktree_columns.js'
import { addAgentMountMode } from './0008_add_agent_mount_mode.js'
import { createMediaItems } from './0009_create_media_items.js'
import { addTicketPosition } from './0010_add_ticket_position.js'
import { addReviewGate } from './0011_add_review_gate.js'
import { addActionNetworkAllowlist } from './0012_add_action_network_allowlist.js'
import { agentLifecycleStates } from './0013_agent_lifecycle_states.js'
import { agentWorkLifecycle } from './0014_agent_work_lifecycle.js'
import { orchestrateHooks } from './0015_orchestrate_hooks.js'
import { schemaCatchup } from './0016_schema_catchup.js'
import { dropAgentWorkFk } from './0017_drop_agent_work_fk.js'
import { createTicketRefs } from './0018_create_ticket_refs.js'
import { gcArtifactCleanup } from './0019_gc_artifact_cleanup.js'
import { transitionMap } from './0020_transition_map.js'
import { notificationSystem } from './0021_notification_system.js'
import { hookModeTiers } from './0022_hook_mode_tiers.js'
import { intentBasedActions } from './0023_intent_based_actions.js'
import { dropDeadPmoTables } from './0024_drop_dead_pmo_tables.js'
import { transitionMapManyToOne } from './0025_transition_map_many_to_one.js'
import { hookActionType } from './0026_hook_action_type.js'
import { actionValidFrom } from './0027_action_valid_from.js'
import { hookActionTypesExpand } from './0028_hook_action_types_expand.js'
import { toolRegistry } from './0029_tool_registry.js'
import { apiToolColumns } from './0030_api_tool_columns.js'

/**
 * Ordered list of all migrations.
 * New migrations should be appended to the end of this array.
 */
export const ALL_MIGRATIONS: Migration[] = [
  baseline,
  workHooks,
  actionsRedesign,
  workflowRules,
  providerStatusMapping,
  dropThemeNamesUsed,
  addWorktreeColumns,
  addAgentMountMode,
  createMediaItems,
  addTicketPosition,
  addReviewGate,
  addActionNetworkAllowlist,
  agentLifecycleStates,
  agentWorkLifecycle,
  orchestrateHooks,
  schemaCatchup,
  dropAgentWorkFk,
  createTicketRefs,
  gcArtifactCleanup,
  transitionMap,
  notificationSystem,
  hookModeTiers,
  intentBasedActions,
  dropDeadPmoTables,
  transitionMapManyToOne,
  hookActionType,
  actionValidFrom,
  hookActionTypesExpand,
  toolRegistry,
  apiToolColumns,
]
