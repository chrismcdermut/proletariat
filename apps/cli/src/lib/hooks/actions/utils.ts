/**
 * Action Utilities
 *
 * Shared utilities for action executors.
 */

import { HookEventPayload } from '../types.js'

/**
 * Interpolate a template string with values from the payload.
 * Supports {{field}} and {{object.field}} syntax.
 *
 * Examples:
 *   "Ticket {{ticket.id}} created" + {ticket: {id: "TKT-001"}}
 *   => "Ticket TKT-001 created"
 */
export function interpolateTemplate(template: string, payload: HookEventPayload): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(payload, path.trim())
    if (value === undefined || value === null) {
      return match // Keep original placeholder if value not found
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  })
}

/**
 * Get a nested value from an object using dot notation.
 *
 * Examples:
 *   getNestedValue({a: {b: 1}}, "a.b") => 1
 *   getNestedValue({ticket: {id: "TKT-001"}}, "ticket.id") => "TKT-001"
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Format a value for display in logs/messages.
 */
export function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(', ')}]`
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
