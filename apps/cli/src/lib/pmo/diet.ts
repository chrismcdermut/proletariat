/**
 * Diet configuration for balanced ticket pulling.
 *
 * The "diet" defines target ratios for business categories (e.g., ship, grow, support).
 * When pulling tickets from Backlog → Ready, the diet ensures a balanced mix.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from './schema.js'

const T = PMO_TABLES

// =============================================================================
// Types
// =============================================================================

/**
 * Diet ratio for a single category.
 */
export interface DietRatio {
  category: string
  target: number  // 0.0 - 1.0 (percentage as decimal)
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
 * Default diet ratios matching the 5-Tool Founder business categories.
 */
export const DEFAULT_DIET_RATIOS: DietRatio[] = [
  { category: 'ship', target: 0.40 },
  { category: 'grow', target: 0.25 },
  { category: 'support', target: 0.15 },
  { category: 'bizops', target: 0.10 },
  { category: 'strategy', target: 0.10 },
]

export const DEFAULT_DIET_CONFIG: DietConfig = {
  ratios: DEFAULT_DIET_RATIOS,
}

// =============================================================================
// Diet Storage (pmo_settings table)
// =============================================================================

const DIET_CONFIG_KEY = 'diet_config'

/**
 * Load diet configuration from the database.
 * Returns default config if none is stored.
 */
export function loadDietConfig(db: Database.Database): DietConfig {
  try {
    const row = db.prepare(
      `SELECT value FROM ${T.settings} WHERE key = ?`
    ).get(DIET_CONFIG_KEY) as { value: string } | undefined

    if (row) {
      const parsed = JSON.parse(row.value) as DietConfig
      if (parsed.ratios && Array.isArray(parsed.ratios)) {
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
 * Parse a diet string like "ship=40,grow=25,support=15,bizops=10,strategy=10"
 * into a DietConfig. Values are percentages that must sum to 100.
 */
export function parseDietString(input: string): DietConfig {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean)
  const ratios: DietRatio[] = []
  let totalPct = 0

  for (const part of parts) {
    const [category, pctStr] = part.split('=').map(s => s.trim())
    if (!category || !pctStr) {
      throw new Error(`Invalid diet entry: "${part}". Expected format: category=percentage`)
    }
    const pct = Number.parseFloat(pctStr)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      throw new Error(`Invalid percentage for "${category}": ${pctStr}. Must be 0-100.`)
    }
    totalPct += pct
    ratios.push({ category: category.toLowerCase(), target: pct / 100 })
  }

  if (Math.abs(totalPct - 100) > 0.01) {
    throw new Error(`Diet percentages must sum to 100, got ${totalPct}`)
  }

  return { ratios }
}

/**
 * Format a diet config as a readable string.
 */
export function formatDietConfig(config: DietConfig): string {
  return config.ratios
    .map(r => `${r.category}=${Math.round(r.target * 100)}%`)
    .join(', ')
}
