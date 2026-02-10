/**
 * String utilities for CLI table formatting.
 *
 * Handles emoji and wide characters that occupy more than one terminal column.
 */

import stringWidth from 'string-width'

/**
 * Pad a string to the given visual width, accounting for emoji and wide characters.
 * Unlike String.padEnd(), this measures visual column width rather than character count.
 */
export function visualPadEnd(str: string, width: number): string {
  const visWidth = stringWidth(str)
  if (visWidth >= width) return str
  return str + ' '.repeat(width - visWidth)
}
