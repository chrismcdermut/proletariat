/**
 * Spec Format Type Definitions
 *
 * Types for parsing spec documents and System Card generation.
 *
 * DB types are in types.ts (Spec, SpecAbility, SpecField, SpecRule, SpecRelation)
 * This file has parsing-specific types for reading markdown specs.
 */

// Re-export DB types
export {
  Modality,
  CommonModality,
  MODALITIES,
  COMMON_MODALITIES,
  SpecType,
  Spec,
  SpecAbility,
  SpecImplementation,
  SpecField,
  SpecRule,
  SpecRelation,
} from './types.js';

// =============================================================================
// Spec Frontmatter (for parsing markdown)
// =============================================================================

/**
 * Domain spec frontmatter
 */
export interface DomainSpecFrontmatter {
  title: string;
  domain: string;
  status?: 'active' | 'draft' | 'deprecated';
}

/**
 * Infrastructure spec frontmatter
 */
export interface InfrastructureSpecFrontmatter {
  title: string;
  status?: 'active' | 'draft' | 'deprecated';
}

// =============================================================================
// Parsed Abilities (intermediate format from markdown parsing)
// =============================================================================

/**
 * A single ability parsed from markdown
 * New format supports description per ability and flexible modalities
 */
export interface Ability {
  name: string;
  description?: string;
  implementations: Record<string, string>;  // modality → signature (flexible keys)
}

// =============================================================================
// Data Model (intermediate format from markdown parsing)
// =============================================================================

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'enum'
  | 'ref'
  | 'json';

export type FieldRequired = 'required' | 'auto' | 'optional';

export interface DataModelField {
  name: string;
  type: FieldType;
  required: FieldRequired;
  default?: string;
  description: string;
  enumValues?: string[];
  refTarget?: string;
}

// =============================================================================
// Business Rules (intermediate format from markdown parsing)
// =============================================================================

export interface BusinessRule {
  name: string;
  description: string;
}

// =============================================================================
// Parsed Specs (result of parsing markdown files)
// =============================================================================

/**
 * Parsed domain spec from markdown
 */
export interface DomainSpec {
  frontmatter: DomainSpecFrontmatter;
  overview: string;
  abilities: Ability[];
  dataModel: DataModelField[];
  businessRules: BusinessRule[];
  relatedDomains: string[];
  rawContent: string;
  filePath: string;
}


// =============================================================================
// System Card Generation
// =============================================================================

export interface ModalityCoverage {
  modality: string;  // Flexible - not constrained to predefined modalities
  implemented: number;
  total: number;
  percent: number;
}

export interface DomainCoverage {
  domain: string;
  abilities: {
    name: string;
    implementations: Record<string, {  // Flexible modality keys
      signature: string;
      implemented: boolean;
      tested: boolean;
    }>;
  }[];
}

export interface SystemCard {
  generatedAt: string;
  domains: DomainCoverage[];
  coverage: ModalityCoverage[];
  schema: SchemaTable[];
}

export interface SchemaTable {
  name: string;
  primaryKey: string;
  columns: string[];
  description?: string;
}
