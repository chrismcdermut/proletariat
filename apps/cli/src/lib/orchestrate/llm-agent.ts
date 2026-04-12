/**
 * LLM Orchestrator Agent (Tier 2)
 *
 * Implements the onLlmDecision callback for the 3-tier supervision tree.
 * When the daemon encounters a hook with mode=llm, this agent:
 *
 * 1. Gathers rich context — PR diff, ticket description, test output
 * 2. Builds a structured decision prompt
 * 3. Calls claude -p (print mode) to get a judgment
 * 4. Parses the response to return approve/deny/escalate
 *
 * This is the bridge between the deterministic daemon (tier 1) and
 * human escalation (tier 3). Without it, tier 2 is a pass-through.
 */

import { execSync } from 'node:child_process'
import type { EscalationContext } from './escalation.js'
import type { LlmDecision } from '../work-lifecycle/hooks/types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Enriched context gathered for the LLM decision.
 */
export interface DecisionContext {
  /** The original escalation context */
  escalation: EscalationContext
  /** PR diff (truncated if too large) */
  prDiff?: string
  /** Ticket description */
  ticketDescription?: string
  /** Recent test/CI output */
  testOutput?: string
  /** Branch name */
  branch?: string
  /** Agent session status (running agents, their states) */
  agentStatus?: string
}

/**
 * Options for creating the LLM decision handler.
 */
export interface LlmAgentOptions {
  /** Logger function */
  log?: (msg: string) => void
  /** Maximum characters for PR diff in prompt (default: 8000) */
  maxDiffChars?: number
  /** Maximum characters for test output in prompt (default: 4000) */
  maxTestOutputChars?: number
  /** Timeout in ms for the LLM call (default: 60000) */
  llmCallTimeoutMs?: number
  /** Override the LLM invocation for testing */
  invokeLlm?: (prompt: string) => string
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_DIFF_CHARS = 8000
const DEFAULT_MAX_TEST_OUTPUT_CHARS = 4000
const DEFAULT_LLM_CALL_TIMEOUT_MS = 60_000

// =============================================================================
// Context Gathering (pure functions, individually testable)
// =============================================================================

/**
 * Fetch the PR diff via `gh pr diff`.
 * Returns undefined if no PR number is available or the command fails.
 */
export function fetchPrDiff(prNumber: number | undefined, maxChars: number): string | undefined {
  if (!prNumber) return undefined
  try {
    const diff = execSync(`gh pr diff ${prNumber} --color=never`, {
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    })
    if (diff.length > maxChars) {
      return diff.slice(0, maxChars) + `\n\n... [diff truncated at ${maxChars} chars, ${diff.length} total]`
    }
    return diff || undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch the ticket description via `prlt ticket show`.
 * Returns undefined if no ticket ID is available or the command fails.
 */
export function fetchTicketDescription(ticketId: string | undefined): string | undefined {
  if (!ticketId) return undefined
  try {
    const output = execSync(`prlt ticket show ${ticketId} --json`, {
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    })
    try {
      const parsed = JSON.parse(output)
      const parts: string[] = []
      if (parsed.result?.title) parts.push(`Title: ${parsed.result.title}`)
      if (parsed.result?.description) parts.push(`Description: ${parsed.result.description}`)
      if (parsed.result?.acceptanceCriteria?.length) {
        parts.push(`Acceptance Criteria:\n${parsed.result.acceptanceCriteria.map((ac: string) => `  - ${ac}`).join('\n')}`)
      }
      return parts.length > 0 ? parts.join('\n') : output
    } catch {
      return output || undefined
    }
  } catch {
    return undefined
  }
}

/**
 * Fetch recent CI/test output via `gh pr checks` or `gh run list`.
 * Returns undefined if unavailable.
 */
export function fetchTestOutput(prNumber: number | undefined, maxChars: number): string | undefined {
  if (!prNumber) return undefined
  try {
    const output = execSync(`gh pr checks ${prNumber}`, {
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    })
    if (output.length > maxChars) {
      return output.slice(0, maxChars) + `\n\n... [output truncated at ${maxChars} chars]`
    }
    return output || undefined
  } catch {
    return undefined
  }
}

/**
 * Fetch running agent session status via `prlt session list --json`.
 * Returns a summary of active agents and their states, or undefined if unavailable.
 */
export function fetchAgentSessionStatus(_agentName: string | undefined): string | undefined {
  try {
    const output = execSync('prlt session list --json', {
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    })
    try {
      const parsed = JSON.parse(output)
      const sessions = parsed.result?.sessions ?? parsed.sessions ?? []
      if (!Array.isArray(sessions) || sessions.length === 0) return undefined

      const lines: string[] = [`Active agents (${sessions.length}):`]
      for (const s of sessions) {
        const parts = [
          s.agentName || s.agent_name || 'unknown',
          s.status || 'unknown',
        ]
        if (s.ticket_id || s.ticketId) parts.push(`ticket=${s.ticket_id || s.ticketId}`)
        if (s.elapsed) parts.push(`elapsed=${s.elapsed}`)
        lines.push(`  - ${parts.join(' | ')}`)
      }
      return lines.join('\n')
    } catch {
      return output || undefined
    }
  } catch {
    return undefined
  }
}

/**
 * Gather enriched context from all available sources.
 */
export function gatherDecisionContext(
  escalation: EscalationContext,
  options: { maxDiffChars: number; maxTestOutputChars: number },
): DecisionContext {
  const prNumber = escalation.ctx.pr as number | undefined
  const ticketId = escalation.ctx.ticket as string | undefined
  const branch = escalation.ctx.branch as string | undefined
  const agentName = escalation.ctx.agent as string | undefined

  return {
    escalation,
    prDiff: fetchPrDiff(prNumber, options.maxDiffChars),
    ticketDescription: fetchTicketDescription(ticketId),
    testOutput: fetchTestOutput(prNumber, options.maxTestOutputChars),
    agentStatus: fetchAgentSessionStatus(agentName),
    branch,
  }
}

// =============================================================================
// Prompt Construction (pure function, testable)
// =============================================================================

/**
 * Build the decision prompt for the LLM.
 *
 * The prompt is structured to get a clear approve/deny/escalate response
 * with reasoning.
 */
export function buildDecisionPrompt(context: DecisionContext): string {
  const { escalation, prDiff, ticketDescription, testOutput, agentStatus, branch } = context

  const sections: string[] = []

  sections.push(`# Orchestrator Decision Required

You are an autonomous orchestrator agent making a tier-2 decision in a 3-tier supervision tree.
Your role: review the context and decide whether to APPROVE, DENY, or ESCALATE this action.

## Decision

- **Hook:** ${escalation.hookName}
- **Event:** ${escalation.event}
- **Action:** ${escalation.action}
${branch ? `- **Branch:** ${branch}` : ''}
${escalation.config ? `- **Config:** ${JSON.stringify(escalation.config)}` : ''}`)

  if (ticketDescription) {
    sections.push(`## Ticket Context

${ticketDescription}`)
  }

  if (prDiff) {
    sections.push(`## PR Diff

\`\`\`diff
${prDiff}
\`\`\``)
  }

  if (testOutput) {
    sections.push(`## CI/Test Status

\`\`\`
${testOutput}
\`\`\``)
  }

  if (agentStatus) {
    sections.push(`## Agent Sessions

\`\`\`
${agentStatus}
\`\`\``)
  }

  sections.push(`## Decision Guidelines

Consider these factors:
1. **Safety** — Does the action risk data loss, downtime, or breaking changes?
2. **Context match** — Does the action align with the event and ticket context?
3. **CI status** — Are tests passing? Is the diff reasonable?
4. **Scope** — Is the action proportional to the event?

### When to APPROVE
- CI is green and the action is a natural next step (e.g., merge after green CI)
- Agent spawn for a ticket that's ready and has clear requirements
- Respawn of a died agent with retries remaining

### When to DENY
- CI is failing and the action would advance the pipeline (e.g., merge a failing PR)
- The diff contains suspicious changes (secrets, large deletions, unrelated files)
- The action doesn't match the event context

### When to ESCALATE
- The situation is ambiguous or high-stakes (production deployments, large refactors)
- You lack sufficient context to make a confident decision
- The action involves irreversible operations on shared resources

## Response Format

Respond with EXACTLY one of these words on the first line, followed by your reasoning:

APPROVE
DENY
ESCALATE

Then explain your reasoning briefly.`)

  return sections.join('\n\n')
}

// =============================================================================
// Response Parsing (pure function, testable)
// =============================================================================

/**
 * Parse the LLM response to extract the decision.
 *
 * Looks for APPROVE, DENY, or ESCALATE as the first meaningful word.
 * Falls back to 'escalate' if the response is ambiguous.
 */
export function parseDecisionResponse(response: string): LlmDecision {
  const trimmed = response.trim()
  if (!trimmed) return 'escalate'

  // Check the first non-empty line for the decision keyword
  const lines = trimmed.split('\n')
  for (const line of lines) {
    const cleaned = line.trim().toUpperCase()
    if (!cleaned) continue

    if (cleaned.startsWith('APPROVE')) return 'approve'
    if (cleaned.startsWith('DENY')) return 'deny'
    if (cleaned.startsWith('ESCALATE')) return 'escalate'

    // Only check the first non-empty line
    break
  }

  // Fallback: scan the full response for keywords (less reliable)
  const upper = trimmed.toUpperCase()
  if (upper.includes('APPROVE') && !upper.includes('DENY') && !upper.includes('ESCALATE')) {
    return 'approve'
  }
  if (upper.includes('DENY') && !upper.includes('APPROVE') && !upper.includes('ESCALATE')) {
    return 'deny'
  }

  // When in doubt, escalate to human
  return 'escalate'
}

// =============================================================================
// LLM Invocation
// =============================================================================

/**
 * Invoke the LLM via `claude -p` (print mode).
 * Returns the raw response text.
 */
export function invokeClaudeLlm(prompt: string, timeoutMs: number): string {
  return execSync(
    `claude -p --output-format text`,
    {
      input: prompt,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
}

// =============================================================================
// Factory: onLlmDecision callback
// =============================================================================

/**
 * Create an onLlmDecision callback for the OrchestrateEngine.
 *
 * This is the main entry point — wire this into the engine to activate tier 2.
 *
 * @example
 * ```ts
 * const engine = new OrchestrateEngine({
 *   db,
 *   onLlmDecision: createLlmDecisionHandler({ log: console.log }),
 * })
 * ```
 */
export function createLlmDecisionHandler(
  options: LlmAgentOptions = {},
): (context: EscalationContext) => Promise<LlmDecision> {
  const log = options.log ?? (() => {})
  const maxDiffChars = options.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS
  const maxTestOutputChars = options.maxTestOutputChars ?? DEFAULT_MAX_TEST_OUTPUT_CHARS
  const llmCallTimeoutMs = options.llmCallTimeoutMs ?? DEFAULT_LLM_CALL_TIMEOUT_MS
  const callLlm = options.invokeLlm ?? ((prompt: string) => invokeClaudeLlm(prompt, llmCallTimeoutMs))

  return async (context: EscalationContext): Promise<LlmDecision> => {
    log(`[llm-agent] Decision requested: ${context.hookName} → ${context.action} (event: ${context.event})`)

    try {
      // 1. Gather enriched context
      const enriched = gatherDecisionContext(context, { maxDiffChars, maxTestOutputChars })

      // 2. Build the prompt
      const prompt = buildDecisionPrompt(enriched)
      log(`[llm-agent] Prompt built (${prompt.length} chars)`)

      // 3. Call the LLM
      const response = callLlm(prompt)
      log(`[llm-agent] Response received (${response.length} chars)`)

      // 4. Parse the decision
      const decision = parseDecisionResponse(response)
      log(`[llm-agent] Decision: ${decision} for ${context.hookName} → ${context.action}`)

      return decision
    } catch (err) {
      // On any error, escalate to human rather than silently approving/denying
      const errMsg = err instanceof Error ? err.message : String(err)
      log(`[llm-agent] Error during decision — escalating to human: ${errMsg}`)
      return 'escalate'
    }
  }
}
