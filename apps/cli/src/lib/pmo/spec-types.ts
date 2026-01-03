/**
 * Spec Format Type Definitions
 *
 * Types for parsing spec documents with frontmatter.
 * DB types are in types.ts (Spec, SpecDependency)
 */

// Re-export DB types
export {
  SpecType,
  SpecStatus,
  Spec,
  SpecDependency,
} from './types.js';

// =============================================================================
// Spec Frontmatter (for parsing markdown)
// =============================================================================

/**
 * Spec frontmatter - parsed from YAML at top of markdown file
 */
export interface SpecFrontmatter {
  id?: string;
  status?: 'draft' | 'active' | 'implemented';
  type?: 'product' | 'platform' | 'infra' | 'integration';
  tags?: string[];
  depends_on?: string[];
}

// =============================================================================
// Parsed Spec (result of parsing markdown file)
// =============================================================================

/**
 * A spec parsed from a markdown file
 */
export interface ParsedSpec {
  frontmatter: SpecFrontmatter;
  title: string;
  problem?: string;
  solution?: string;
  decisions?: string;
  notNow?: string;
  uiUx?: string;
  acceptanceCriteria?: string;
  openQuestions?: string;
  requirementsFunctional?: string;
  requirementsTechnical?: string;
  context?: string;
  rawContent: string;
  filePath: string;
}

// =============================================================================
// Spec Export Format (for writing markdown files)
// =============================================================================

/**
 * Format for exporting spec to markdown
 */
export interface SpecExportOptions {
  includeFrontmatter?: boolean;
  includeEmptySections?: boolean;
}
