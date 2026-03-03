/**
 * IssueEnvelope Validation
 *
 * Validates raw data into a canonical IssueEnvelope.
 * Provides typed validation errors for missing or invalid fields.
 */

import {
  ISSUE_SOURCES,
  type IssueEnvelope,
  type IssueSource,
  type IssueValidationError,
  type IssueValidationResult,
  ExternalIssueError,
} from './types.js'

/**
 * Required string fields on IssueEnvelope (must be present and non-empty).
 */
const REQUIRED_STRING_FIELDS = [
  'external_id',
  'external_key',
  'title',
  'status',
  'url',
  'project_key',
] as const

const PRIORITY_VALUES = new Set(['P0', 'P1', 'P2', 'P3'])

/**
 * Validate and construct an IssueEnvelope from untyped input.
 *
 * Checks:
 * - `source` is a valid IssueSource
 * - Required string fields are present and non-empty
 * - `description` is present (may be empty string)
 * - `labels` is an array of strings
 * - `priority` is a string or null
 * - `assignee` is a string or null
 * - `item_type` is optional, but if present must be a non-empty string or null
 * - `raw` is a plain object
 *
 * @param input - Untyped input to validate
 * @returns Validation result with either the valid envelope or an array of errors
 */
export function validateIssueEnvelope(input: unknown): IssueValidationResult {
  const errors: IssueValidationError[] = []

  if (typeof input !== 'object' || input === null) {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: '(root)',
      message: 'Input must be a non-null object',
    })
    return { valid: false, errors }
  }

  const data = input as Record<string, unknown>

  // Validate source
  if (!('source' in data) || data.source === undefined || data.source === null) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'source',
      message: 'source is required',
    })
  } else if (typeof data.source !== 'string') {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'source',
      message: 'source must be a string',
    })
  } else if (!ISSUE_SOURCES.includes(data.source as IssueSource)) {
    errors.push({
      code: 'INVALID_SOURCE',
      field: 'source',
      message: `source must be one of: ${ISSUE_SOURCES.join(', ')}. Got: "${data.source}"`,
    })
  }

  // Validate required string fields
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!(field in data) || data[field] === undefined || data[field] === null) {
      errors.push({
        code: 'MISSING_FIELD',
        field,
        message: `${field} is required`,
      })
    } else if (typeof data[field] !== 'string') {
      errors.push({
        code: 'INVALID_FIELD_TYPE',
        field,
        message: `${field} must be a string`,
      })
    } else if ((data[field] as string).trim() === '') {
      errors.push({
        code: 'EMPTY_FIELD',
        field,
        message: `${field} must not be empty`,
      })
    }
  }

  // Validate description (required, but may be empty string)
  if (!('description' in data) || data.description === undefined || data.description === null) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'description',
      message: 'description is required',
    })
  } else if (typeof data.description !== 'string') {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'description',
      message: 'description must be a string',
    })
  }

  // Validate labels
  if (!('labels' in data) || data.labels === undefined || data.labels === null) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'labels',
      message: 'labels is required',
    })
  } else if (!Array.isArray(data.labels)) {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'labels',
      message: 'labels must be an array',
    })
  } else {
    for (let i = 0; i < data.labels.length; i++) {
      if (typeof data.labels[i] !== 'string') {
        errors.push({
          code: 'INVALID_FIELD_TYPE',
          field: `labels[${i}]`,
          message: `labels[${i}] must be a string`,
        })
      }
    }
  }

  // Validate priority (string or null)
  if (!('priority' in data) || data.priority === undefined) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'priority',
      message: 'priority is required (use null if not set)',
    })
  } else if (data.priority !== null && typeof data.priority !== 'string') {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'priority',
      message: 'priority must be a string or null',
    })
  } else if (typeof data.priority === 'string') {
    const normalizedPriority = data.priority.trim().toUpperCase()
    if (!PRIORITY_VALUES.has(normalizedPriority)) {
      errors.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'priority',
        message: 'priority must be one of: P0, P1, P2, P3, or null',
      })
    }
  }

  // Validate assignee (string or null)
  if (!('assignee' in data) || data.assignee === undefined) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'assignee',
      message: 'assignee is required (use null if not assigned)',
    })
  } else if (data.assignee !== null && typeof data.assignee !== 'string') {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'assignee',
      message: 'assignee must be a string or null',
    })
  }

  // Validate item_type (optional: string or null)
  if ('item_type' in data && data.item_type !== undefined) {
    if (data.item_type !== null && typeof data.item_type !== 'string') {
      errors.push({
        code: 'INVALID_FIELD_TYPE',
        field: 'item_type',
        message: 'item_type must be a string or null',
      })
    } else if (typeof data.item_type === 'string' && data.item_type.trim() === '') {
      errors.push({
        code: 'EMPTY_FIELD',
        field: 'item_type',
        message: 'item_type must not be empty when provided',
      })
    }
  }

  // Validate raw
  if (!('raw' in data) || data.raw === undefined || data.raw === null) {
    errors.push({
      code: 'MISSING_FIELD',
      field: 'raw',
      message: 'raw is required',
    })
  } else if (typeof data.raw !== 'object' || Array.isArray(data.raw)) {
    errors.push({
      code: 'INVALID_FIELD_TYPE',
      field: 'raw',
      message: 'raw must be a plain object',
    })
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    envelope: data as unknown as IssueEnvelope,
  }
}

/**
 * Validate an IssueEnvelope or throw an ExternalIssueError.
 *
 * Convenience wrapper around validateIssueEnvelope that throws on failure.
 *
 * @param input - Untyped input to validate
 * @returns Valid IssueEnvelope
 * @throws ExternalIssueError with code 'VALIDATION_FAILED' if invalid
 */
export function validateOrThrow(input: unknown): IssueEnvelope {
  const result = validateIssueEnvelope(input)
  if (!result.valid) {
    const fieldList = result.errors.map((e) => e.field).join(', ')
    throw new ExternalIssueError(
      'VALIDATION_FAILED',
      `Issue envelope validation failed: invalid fields [${fieldList}]`,
      undefined,
      result.errors
    )
  }
  return result.envelope
}
