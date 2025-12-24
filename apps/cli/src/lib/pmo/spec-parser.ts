/**
 * Spec Parser
 *
 * Parses markdown spec files into structured data for System Card generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import {
  DomainSpec,
  DomainSpecFrontmatter,
  Ability,
  DataModelField,
  BusinessRule,
  FieldType,
  FieldRequired,
} from './spec-types.js';

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a domain spec markdown file into structured data
 */
export function parseDomainSpec(filePath: string): DomainSpec {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);

  return {
    frontmatter: parseFrontmatter(frontmatter),
    overview: parseOverview(body),
    abilities: parseAbilities(body),
    dataModel: parseDataModel(body),
    businessRules: parseBusinessRules(body),
    relatedDomains: parseRelatedDomains(body),
    rawContent: content,
    filePath,
  };
}

/**
 * Parse all domain specs from a directory
 */
export function parseDomainSpecs(specsDir: string): DomainSpec[] {
  const domainDir = path.join(specsDir, 'domain');
  if (!fs.existsSync(domainDir)) {
    return [];
  }

  const files = fs.readdirSync(domainDir).filter(f => f.endsWith('.md'));
  return files.map(f => parseDomainSpec(path.join(domainDir, f)));
}

// =============================================================================
// Section Parsers
// =============================================================================

function parseFrontmatter(data: Record<string, unknown>): DomainSpecFrontmatter {
  return {
    title: String(data.title || ''),
    domain: String(data.domain || ''),
    status: (data.status as 'active' | 'draft' | 'deprecated') || 'active',
  };
}

function parseOverview(body: string): string {
  const match = body.match(/## Overview\s*\n+([\s\S]*?)(?=\n## |$)/);
  return match ? match[1].trim() : '';
}

/**
 * Parse abilities from markdown
 *
 * Supports two formats:
 *
 * 1. Table format (legacy - columns are modalities):
 *    | Ability | Storage | CLI | API | Web | Obsidian |
 *    |---------|---------|-----|-----|-----|----------|
 *    | Create ticket | `createTicket()` | `prlt ticket create` | ... |
 *
 * 2. Subsection format (new - each ability has description + modality table):
 *    ### Create ticket
 *    Create a new ticket with title and optional metadata.
 *
 *    | Modality | Signature |
 *    |----------|-----------|
 *    | storage | `createTicket()` |
 *    | cli | `prlt ticket create` |
 */
function parseAbilities(body: string): Ability[] {
  const abilities: Ability[] = [];

  // Find Abilities section
  const abilitiesSection = body.match(/## Abilities\s*\n+([\s\S]*?)(?=\n## [^#]|$)/);
  if (!abilitiesSection) return abilities;

  const sectionContent = abilitiesSection[1];

  // Check if we have ### subsections (new format) or just tables (old format)
  const hasSubsections = /### [^\n]+/.test(sectionContent);

  if (hasSubsections) {
    // New format: ### Ability Name\nDescription\n| Modality | Signature |
    const subsectionRegex = /### ([^\n]+)\s*\n([\s\S]*?)(?=\n### |$)/g;
    let subsectionMatch;

    while ((subsectionMatch = subsectionRegex.exec(sectionContent)) !== null) {
      const abilityName = subsectionMatch[1].trim();
      const subsectionBody = subsectionMatch[2];

      // Extract description (text before the table)
      const tableStart = subsectionBody.search(/\|[^\n]+\|/);
      const description = tableStart > 0
        ? subsectionBody.substring(0, tableStart).trim()
        : undefined;

      // Parse the modality table
      const implementations: Record<string, string> = {};
      const tableMatch = subsectionBody.match(/\|[^\n]+\|\s*\n\|[-:\s|]+\|\s*\n((?:\|[^\n]+\|\s*\n?)*)/);

      if (tableMatch) {
        const rows = tableMatch[1].trim().split('\n');
        for (const row of rows) {
          const cells = parseTableRow(row);
          if (cells.length >= 2) {
            const modality = cells[0].toLowerCase().trim();
            const signature = cells[1].trim().replace(/`/g, '');
            if (modality && signature && signature !== '-') {
              implementations[modality] = signature;
            }
          }
        }
      }

      abilities.push({ name: abilityName, description, implementations });
    }
  } else {
    // Old format: table with columns as modalities
    const tableRegex = /\|[^\n]+\|\s*\n\|[-:\s|]+\|\s*\n((?:\|[^\n]+\|\s*\n)*)/g;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(sectionContent)) !== null) {
      // Get the header row (line before the separator)
      const tableStart = tableMatch.index;
      const beforeTable = sectionContent.substring(0, tableStart);
      const headerLine = beforeTable.split('\n').filter(l => l.trim()).pop() || '';

      // Parse header to get modality columns
      const headerCells = parseTableRow(headerLine);
      if (headerCells.length < 2) continue;

      // Map column index to modality name (flexible - use header text as-is)
      const modalityMap: Map<number, string> = new Map();
      for (let i = 1; i < headerCells.length; i++) {
        const header = headerCells[i].toLowerCase().trim();
        if (header) {
          modalityMap.set(i, header);
        }
      }

      // Parse data rows
      const rows = tableMatch[1].trim().split('\n');
      for (const row of rows) {
        const cells = parseTableRow(row);
        if (cells.length < 2) continue;

        const abilityName = cells[0].trim();
        if (!abilityName) continue;

        const implementations: Record<string, string> = {};
        for (const [colIndex, modality] of modalityMap) {
          const value = cells[colIndex]?.trim();
          if (value && value !== '-' && value !== '') {
            // Remove backticks and clean up
            implementations[modality] = value.replace(/`/g, '');
          }
        }

        abilities.push({ name: abilityName, implementations });
      }
    }
  }

  return abilities;
}

/**
 * Parse data model table from markdown
 *
 * Expected format:
 * | Field | Type | Required | Default | Description |
 * |-------|------|----------|---------|-------------|
 * | id | string | auto | - | TKT-001 format |
 */
function parseDataModel(body: string): DataModelField[] {
  const fields: DataModelField[] = [];

  // Find Data Model section
  const dataModelSection = body.match(/## Data Model\s*\n+([\s\S]*?)(?=\n## [^#]|$)/);
  if (!dataModelSection) return fields;

  const sectionContent = dataModelSection[1];

  // Find markdown tables
  const tableRegex = /\|[^\n]+\|\s*\n\|[-:\s|]+\|\s*\n((?:\|[^\n]+\|\s*\n)*)/g;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(sectionContent)) !== null) {
    const rows = tableMatch[1].trim().split('\n');
    for (const row of rows) {
      const cells = parseTableRow(row);
      if (cells.length < 5) continue;

      const [name, type, required, defaultVal, description] = cells.map(c => c.trim());
      if (!name) continue;

      fields.push({
        name,
        type: parseFieldType(type),
        required: parseFieldRequired(required),
        default: defaultVal === '-' ? undefined : defaultVal,
        description,
      });
    }
  }

  return fields;
}

/**
 * Parse business rules from markdown
 *
 * Expected format:
 * ## Business Rules
 * - **Title required**: Cannot create ticket without title
 */
function parseBusinessRules(body: string): BusinessRule[] {
  const rules: BusinessRule[] = [];

  const rulesSection = body.match(/## Business Rules\s*\n+([\s\S]*?)(?=\n## |$)/);
  if (!rulesSection) return rules;

  const ruleRegex = /[-*]\s*\*\*([^*]+)\*\*:\s*(.+)/g;
  let match;

  while ((match = ruleRegex.exec(rulesSection[1])) !== null) {
    rules.push({
      name: match[1].trim(),
      description: match[2].trim(),
    });
  }

  return rules;
}

/**
 * Parse related domains from markdown
 */
function parseRelatedDomains(body: string): string[] {
  const domains: string[] = [];

  const relatedSection = body.match(/## Related Domains\s*\n+([\s\S]*?)(?=\n## |$)/);
  if (!relatedSection) return domains;

  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  let match;

  while ((match = linkRegex.exec(relatedSection[1])) !== null) {
    // Extract domain name from link text or path
    const domainName = match[1] || path.basename(match[2], '.md');
    domains.push(domainName.toLowerCase());
  }

  return domains;
}

// =============================================================================
// Helpers
// =============================================================================

function parseTableRow(row: string): string[] {
  // Split by | and remove empty first/last elements
  return row.split('|').slice(1, -1).map(cell => cell.trim());
}

function parseFieldType(typeStr: string): FieldType {
  const lower = typeStr.toLowerCase();
  if (lower.includes('string') || lower.includes('text')) return 'string';
  if (lower.includes('number') || lower.includes('integer') || lower.includes('int')) return 'number';
  if (lower.includes('boolean') || lower.includes('bool')) return 'boolean';
  if (lower.includes('timestamp') || lower.includes('date') || lower.includes('time')) return 'timestamp';
  if (lower.includes('enum')) return 'enum';
  if (lower.includes('ref') || lower.includes('foreign')) return 'ref';
  if (lower.includes('json') || lower.includes('object')) return 'json';
  return 'string'; // default
}

function parseFieldRequired(reqStr: string): FieldRequired {
  const lower = reqStr.toLowerCase().trim();
  if (lower === '✓' || lower === 'yes' || lower === 'true' || lower === 'required') return 'required';
  if (lower === 'auto' || lower === 'auto-generated') return 'auto';
  return 'optional';
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a parsed spec for completeness
 */
export function validateDomainSpec(spec: DomainSpec): string[] {
  const errors: string[] = [];

  if (!spec.frontmatter.title) {
    errors.push('Missing title in frontmatter');
  }
  if (!spec.frontmatter.domain) {
    errors.push('Missing domain in frontmatter');
  }
  if (spec.abilities.length === 0) {
    errors.push('No abilities found - check Abilities section format');
  }
  if (spec.dataModel.length === 0) {
    errors.push('No data model fields found - check Data Model section format');
  }

  return errors;
}
