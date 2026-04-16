/**
 * Action Context — internal channel for routing a specific action to `work start`.
 *
 * Background (PRLT-1316): the `--action` CLI flag on `work start` was a leaky
 * abstraction — it let users bypass dedicated verbs (`work review`,
 * `work groom`, `work resolve`, `work implement`) by naming an action directly.
 *
 * Removing the flag left one gap: dedicated verbs still delegate into
 * `work:start` and need to tell it which action to run. This module is that
 * internal channel. It is deliberately NOT exposed as a CLI flag, help output,
 * or documented user API.
 *
 * Two carriers are supported so this works across both oclif command
 * delegation (same process) and subprocess delegation (orchestrator):
 *
 *   1. `setInternalAction(action)` — in-process, cleared on first read
 *   2. `PRLT_INTERNAL_ACTION` env var — survives subprocess boundary
 *
 * Precedence: in-process state > env var. The in-process slot is cleared after
 * being read so stale values can't leak into an unrelated `work start`
 * invocation later in the same process.
 */

let inProcessAction: string | null = null

/**
 * Record the action a sibling command wants `work:start` to execute.
 * Only read once — cleared after {@link resolveInternalAction} returns it.
 */
export function setInternalAction(action: string): void {
  inProcessAction = action
}

/**
 * Read and clear the internal action slot. Falls back to the
 * `PRLT_INTERNAL_ACTION` env var for subprocess invocations.
 */
export function resolveInternalAction(): string | null {
  const action = inProcessAction ?? process.env.PRLT_INTERNAL_ACTION ?? null
  inProcessAction = null
  return action
}

/**
 * Resolve the action id for a `work start` invocation.
 *
 * @param explicit — optional explicit id (kept for the service-layer API;
 *                   CLI callers pass undefined because `--action` is gone)
 * @param fallback — default when nothing is set (defaults to `'implement'`)
 */
export function resolveActionId(
  explicit: string | undefined,
  fallback: string = 'implement',
): string {
  return explicit ?? resolveInternalAction() ?? fallback
}

/**
 * Test helper — forcibly clear the in-process slot. Production code should
 * never need this; it exists so tests can assert clean state between cases.
 */
export function __clearInternalActionForTests(): void {
  inProcessAction = null
}
