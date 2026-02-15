/**
 * Diet configuration for balanced ticket pulling.
 *
 * The "diet" defines target ratios for business categories (e.g., ship, grow, support).
 * Users specify relative weights (e.g., ship=4, grow=2, support=1) which are
 * normalized to percentages internally. No need to sum to 100.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from './schema.js'

const T = PMO_TABLES

// =============================================================================
// Types
// =============================================================================

/**
 * Diet ratio for a single category.
 * `weight` is the user-facing relative weight.
 * `target` is the normalized percentage (0.0-1.0), computed from weights.
 */
export interface DietRatio {
  category: string
  weight: number   // User-facing relative weight (e.g., 4, 2, 1)
  target: number   // Normalized percentage (0.0-1.0), computed from weights
}

/**
 * Full diet configuration.
 */
export interface DietConfig {
  ratios: DietRatio[]
}

/**
 * Diet report for a single category showing actual vs target.
 */
export interface DietCategoryReport {
  category: string
  target: number       // Target percentage (0-1)
  actual: number       // Actual percentage (0-1)
  count: number        // Actual count in Ready
  targetCount: number  // Target count given total
  delta: number        // actual - target (positive = over, negative = under)
  status: 'over' | 'under' | 'ok'
}

/**
 * Full diet report.
 */
export interface DietReport {
  categories: DietCategoryReport[]
  totalReady: number
  uncategorized: number
}

/**
 * Result of a pull operation.
 */
export interface PullResult {
  pulled: PulledTicket[]
  skippedBlocked: number
  skippedCeiling: number
  totalCandidates: number
}

export interface PulledTicket {
  id: string
  title: string
  category: string | undefined
  position: number
  pass: 'first' | 'second'  // Which pass pulled this ticket
}

// =============================================================================
// Default Diet
// =============================================================================

/**
 * Default diet weights matching the 5-Tool Founder business categories.
 * Weights: ship=4, grow=2.5, support=1.5, bizops=1, strategy=1
 * Normalizes to: ship=40%, grow=25%, support=15%, bizops=10%, strategy=10%
 */
export const DEFAULT_DIET_WEIGHTS: Array<{ category: string; weight: number }> = [
  { category: 'ship', weight: 4 },
  { category: 'grow', weight: 2.5 },
  { category: 'support', weight: 1.5 },
  { category: 'bizops', weight: 1 },
  { category: 'strategy', weight: 1 },
]

export const DEFAULT_DIET_CONFIG: DietConfig = normalizeWeights(DEFAULT_DIET_WEIGHTS)

// =============================================================================
// Weight Normalization
// =============================================================================

/**
 * Normalize an array of category weights into a DietConfig with target percentages.
 */
export function normalizeWeights(
  weights: Array<{ category: string; weight: number }>,
): DietConfig {
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
  if (totalWeight === 0) {
    throw new Error('Total weight must be greater than 0')
  }

  const ratios: DietRatio[] = weights.map(w => ({
    category: w.category,
    weight: w.weight,
    target: w.weight / totalWeight,
  }))

  return { ratios }
}

// =============================================================================
// Diet Storage (pmo_settings table)
// =============================================================================

const DIET_CONFIG_KEY = 'diet_config'

/**
 * Load diet configuration from the database.
 * Returns default config if none is stored.
 *
 * Handles backward compatibility: if stored config has ratios without weights,
 * reconstructs weights from target percentages.
 */
export function loadDietConfig(db: Database.Database): DietConfig {
  try {
    const row = db.prepare(
      `SELECT value FROM ${T.settings} WHERE key = ?`
    ).get(DIET_CONFIG_KEY) as { value: string } | undefined

    if (row) {
      const parsed = JSON.parse(row.value) as DietConfig
      if (parsed.ratios && Array.isArray(parsed.ratios)) {
        // Backward compatibility: if weights are missing, reconstruct from targets
        const needsWeights = parsed.ratios.some(r => r.weight === undefined || r.weight === null)
        if (needsWeights) {
          const weights = parsed.ratios.map(r => ({
            category: r.category,
            weight: r.weight ?? Math.round(r.target * 100),
          }))
          return normalizeWeights(weights)
        }
        return parsed
      }
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_DIET_CONFIG
}

/**
 * Save diet configuration to the database.
 */
export function saveDietConfig(db: Database.Database, config: DietConfig): void {
  db.prepare(
    `INSERT OR REPLACE INTO ${T.settings} (key, value) VALUES (?, ?)`
  ).run(DIET_CONFIG_KEY, JSON.stringify(config))
}

/**
 * Parse a diet string like "ship=4,grow=2.5,support=1.5,bizops=1,strategy=1"
 * into a DietConfig. Values are relative weights that get normalized internally.
 */
export function parseDietString(input: string): DietConfig {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean)
  const weights: Array<{ category: string; weight: number }> = []

  for (const part of parts) {
    const [category, weightStr] = part.split('=').map(s => s.trim())
    if (!category || !weightStr) {
      throw new Error(`Invalid diet entry: "${part}". Expected format: category=weight`)
    }
    const weight = Number.parseFloat(weightStr)
    if (Number.isNaN(weight) || weight < 0) {
      throw new Error(`Invalid weight for "${category}": ${weightStr}. Must be a non-negative number.`)
    }
    weights.push({ category: category.toLowerCase(), weight })
  }

  if (weights.length === 0) {
    throw new Error('At least one category weight is required')
  }

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
  if (totalWeight === 0) {
    throw new Error('At least one category must have a weight greater than 0')
  }

  return normalizeWeights(weights)
}

/**
 * Format a diet config showing weights and computed percentages.
 */
export function formatDietConfig(config: DietConfig): string {
  return config.ratios
    .map(r => `${r.category}=${r.weight} (${Math.round(r.target * 100)}%)`)
    .join(', ')
}

/**
 * Format a diet config showing only the weights (compact form).
 */
export function formatDietWeights(config: DietConfig): string {
  return config.ratios
    .map(r => `${r.category}=${r.weight}`)
    .join(', ')
}
