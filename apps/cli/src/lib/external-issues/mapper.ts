/**
 * IssueEnvelope → Spawn Context Mapper
 *
 * Deterministically maps an IssueEnvelope to spawn context data
 * (prompt text + metadata) for agent execution.
 */

import type { IssueEnvelope, IssueSpawnContext } from './types.js'
import { validateOrThrow } from './validation.js'

/**
 * Map an IssueEnvelope to spawn context data.
 *
 * Produces:
 * - A structured prompt string containing the issue details
 * - Metadata key-value pairs for ticket context
 *
 * The mapping is deterministic: the same IssueEnvelope always produces
 * the same IssueSpawnContext.
 *
 * @param input - IssueEnvelope-like input
 * @returns Spawn context with prompt and metadata
 * @throws ExternalIssueError when input fails IssueEnvelope validation
 */
export function mapToSpawnContext(input: IssueEnvelope | unknown): IssueSpawnContext {
  const envelope = validateOrThrow(input)
  const prompt = buildPrompt(envelope)
  const metadata = buildMetadata(envelope)

  return { prompt, metadata }
}

/**
 * Build a structured prompt from an IssueEnvelope.
 *
 * The prompt includes all relevant issue fields formatted for agent consumption.
 */
function buildPrompt(envelope: IssueEnvelope): string {
  const lines: string[] = []

  lines.push(`# ${envelope.title}`)
  lines.push('')
  lines.push(`**Source:** ${envelope.source} (${envelope.external_key})`)

  if (envelope.item_type) {
    lines.push(`**Item Type:** ${envelope.item_type}`)
  }

  lines.push(`**Status:** ${envelope.status}`)

  if (envelope.priority) {
    lines.push(`**Priority:** ${envelope.priority}`)
  }

  if (envelope.assignee) {
    lines.push(`**Assignee:** ${envelope.assignee}`)
  }

  lines.push(`**Project:** ${envelope.project_key}`)

  if (envelope.labels.length > 0) {
    lines.push(`**Labels:** ${envelope.labels.join(', ')}`)
  }

  lines.push(`**URL:** ${envelope.url}`)

  if (envelope.description) {
    lines.push('')
    lines.push('## Description')
    lines.push('')
    lines.push(envelope.description)
  }

  return lines.join('\n')
}

/**
 * Build metadata key-value pairs from an IssueEnvelope.
 *
 * These are stored as ticket metadata for traceability back to
 * the external source.
 */
function buildMetadata(envelope: IssueEnvelope): Record<string, string> {
  const metadata: Record<string, string> = {
    'external_source': envelope.source,
    'external_id': envelope.external_id,
    'external_key': envelope.external_key,
    'external_url': envelope.url,
    'external_project': envelope.project_key,
    'external_status': envelope.status,
  }

  if (envelope.priority) {
    metadata['external_priority'] = envelope.priority
  }

  if (envelope.assignee) {
    metadata['external_assignee'] = envelope.assignee
  }

  if (envelope.labels.length > 0) {
    metadata['external_labels'] = envelope.labels.join(',')
  }

  if (envelope.item_type) {
    metadata['external_item_type'] = envelope.item_type
  }

  return metadata
}
