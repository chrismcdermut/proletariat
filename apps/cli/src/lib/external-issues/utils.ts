/**
 * External issue metadata helpers.
 */

/**
 * Extract external issue metadata from a ticket's metadata field.
 * Returns the external source, key (e.g. PRLT-1065), id, and url.
 */
export function getTicketExternalMetadata(ticket: { id: string; metadata?: Record<string, string> | null }): {
  source?: string
  key?: string
  id?: string
  url?: string
} {
  const metadata = (typeof ticket === 'object'
    && ticket !== null
    && 'metadata' in ticket
    && typeof ticket.metadata === 'object'
    && ticket.metadata !== null
    ? ticket.metadata
    : {}) as Record<string, unknown>

  return {
    source: typeof metadata.external_source === 'string' ? metadata.external_source : undefined,
    key: typeof metadata.external_key === 'string' ? metadata.external_key : undefined,
    id: typeof metadata.external_id === 'string' ? metadata.external_id : undefined,
    url: typeof metadata.external_url === 'string' ? metadata.external_url : undefined,
  }
}

/**
 * Resolve the display/branch ticket ID. When a ticket was imported from an
 * external provider (e.g. Linear), the external key (PRLT-xxx) is preferred
 * over the internal PMO ID (TKT-xxx).
 */
export function resolveExternalTicketId(ticket: { id: string; metadata?: Record<string, string> | null }): string {
  const external = getTicketExternalMetadata(ticket)
  return external.key || ticket.id
}
