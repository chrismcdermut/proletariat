/**
 * Migration registry.
 *
 * All migrations must be imported here and added to ALL_MIGRATIONS
 * in chronological order. The migrator applies them in array order.
 */

import type { Migration } from '../migrator.js'
import { baseline } from './0001_baseline.js'

/**
 * Ordered list of all migrations.
 * New migrations should be appended to the end of this array.
 */
export const ALL_MIGRATIONS: Migration[] = [
  baseline,
]
