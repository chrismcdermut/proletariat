/**
 * Ticket Builder
 *
 * Builds a Ticket object from a NormalizedIssueEnvelope, bypassing
 * the PMO mirror. Part of PMO removal (PRLT-1167).
 *
 * When mirror-to-pmo is disabled (the new default), work start
 * uses this to build an in-memory Ticket directly from the
 * external issue envelope.
 */

import type { Ticket } from '../pmo/types.js'
import type { NormalizedIssueEnvelope } from './types.js'

/**
 * Build a Ticket from a NormalizedIssueEnvelope without creating
 * a PMO mirror ticket.
 *
 * Uses the external key (e.g. PRLT-1167) as the ticket ID.
 * The resulting Ticket is used for execution context, branch naming,
 * and ticket_refs storage — but is NOT persisted to pmo_tickets.
 */
export function buildTicketFromEnvelope(
  envelope: NormalizedIssueEnvelope,
  projectId: string,
): Ticket {
  const metadata: Record<string, string> = {
    external_source: envelope.source.name,
    external_id: envelope.source.externalId,
    external_key: envelope.source.externalKey,
    external_url: envelope.source.url,
  }

  return {
    id: envelope.source.externalKey,
    title: envelope.title,
    description: envelope.description,
    priority: envelope.priority ?? undefined,
    category: envelope.category ?? undefined,
    projectId,
    statusId: 'external',
    statusName: envelope.status,
    statusCategory: null,
    subtasks: [],
    labels: envelope.labels,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
