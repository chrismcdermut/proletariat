/**
 * Spec Parser
 *
 * Parses markdown spec files into structured data.
 * Uses the new simplified spec format with frontmatter.
 */

import * as fs from 'node:fs';
import matter from 'gray-matter';
import {
  SpecFrontmatter,
  ParsedSpec,
} from './spec-types.js';

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a spec markdown file into structured data
 */
export function parseSpecFile(filePath: string): ParsedSpec {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseSpecContent(content, filePath);
}

/**
 * Parse spec content string into structured data
 */
export function parseSpecContent(content: string, filePath: string = ''): ParsedSpec {
  const { data: rawFrontmatter, content: body } = matter(content);

  const frontmatter: SpecFrontmatter = {
    id: rawFrontmatter.id as string | undefined,
    status: rawFrontmatter.status as SpecFrontmatter['status'],
    type: rawFrontmatter.type as SpecFrontmatter['type'],
    tags: rawFrontmatter.tags as string[] | undefined,
    depends_on: rawFrontmatter.depends_on as string[] | undefined,
  };

  return {
    frontmatter,
    title: parseTitle(body),
    problem: parseSection(body, 'Problem'),
    solution: parseSection(body, 'Solution'),
    decisions: parseSection(body, 'Decisions'),
    notNow: parseSection(body, 'Not Now'),
    uiUx: parseSection(body, 'UI/UX'),
    acceptanceCriteria: parseSection(body, 'Acceptance Criteria'),
    openQuestions: parseSection(body, 'Open Questions'),
    requirementsFunctional: parseNestedSection(body, 'Requirements', 'Functional'),
    requirementsTechnical: parseNestedSection(body, 'Requirements', 'Technical'),
    context: parseSection(body, 'Context'),
    rawContent: content,
    filePath,
  };
}

// =============================================================================
// Section Parsers
// =============================================================================

/**
 * Parse title from the first H1 heading
 */
function parseTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled';
}

/**
 * Parse a section by heading name
 */
function parseSection(body: string, sectionName: string): string | undefined {
  // Match ## Section Name followed by content until next ## or end
  const regex = new RegExp(`## ${sectionName}\\s*\\n+([\\s\\S]*?)(?=\\n## [^#]|$)`, 'i');
  const match = body.match(regex);
  if (!match) return undefined;

  const content = match[1].trim();
  return content || undefined;
}

/**
 * Parse a nested section (e.g., ## Requirements -> ### Functional)
 */
function parseNestedSection(body: string, parentSection: string, childSection: string): string | undefined {
  // First find the parent section
  const parentRegex = new RegExp(`## ${parentSection}\\s*\\n+([\\s\\S]*?)(?=\\n## [^#]|$)`, 'i');
  const parentMatch = body.match(parentRegex);
  if (!parentMatch) return undefined;

  const parentContent = parentMatch[1];

  // Then find the child section within it
  const childRegex = new RegExp(`### ${childSection}\\s*\\n+([\\s\\S]*?)(?=\\n### |$)`, 'i');
  const childMatch = parentContent.match(childRegex);
  if (!childMatch) return undefined;

  const content = childMatch[1].trim();
  return content || undefined;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a parsed spec for completeness
 */
export function validateSpec(spec: ParsedSpec): string[] {
  const errors: string[] = [];

  if (!spec.frontmatter.id) {
    errors.push('Missing id in frontmatter');
  }
  if (!spec.title || spec.title === 'Untitled') {
    errors.push('Missing title (H1 heading)');
  }
  if (!spec.problem) {
    errors.push('Missing Problem section');
  }
  if (!spec.solution) {
    errors.push('Missing Solution section');
  }

  return errors;
}

// =============================================================================
// Export Format
// =============================================================================

/**
 * Convert a parsed spec back to markdown format
 */
export function specToMarkdown(spec: ParsedSpec, options?: { includeFrontmatter?: boolean }): string {
  const lines: string[] = [];

  // Frontmatter
  if (options?.includeFrontmatter !== false) {
    lines.push('---');
    if (spec.frontmatter.id) lines.push(`id: ${spec.frontmatter.id}`);
    if (spec.frontmatter.status) lines.push(`status: ${spec.frontmatter.status}`);
    if (spec.frontmatter.type) lines.push(`type: ${spec.frontmatter.type}`);
    if (spec.frontmatter.tags && spec.frontmatter.tags.length > 0) {
      lines.push(`tags: [${spec.frontmatter.tags.join(', ')}]`);
    }
    if (spec.frontmatter.depends_on && spec.frontmatter.depends_on.length > 0) {
      lines.push(`depends_on: [${spec.frontmatter.depends_on.join(', ')}]`);
    }
    lines.push('---');
    lines.push('');
  }

  // Title
  lines.push(`# ${spec.title}`);
  lines.push('');

  // Sections
  if (spec.problem) {
    lines.push('## Problem');
    lines.push('');
    lines.push(spec.problem);
    lines.push('');
  }

  if (spec.solution) {
    lines.push('## Solution');
    lines.push('');
    lines.push(spec.solution);
    lines.push('');
  }

  if (spec.decisions) {
    lines.push('## Decisions');
    lines.push('');
    lines.push(spec.decisions);
    lines.push('');
  }

  if (spec.notNow) {
    lines.push('## Not Now');
    lines.push('');
    lines.push(spec.notNow);
    lines.push('');
  }

  if (spec.uiUx) {
    lines.push('## UI/UX');
    lines.push('');
    lines.push(spec.uiUx);
    lines.push('');
  }

  if (spec.acceptanceCriteria) {
    lines.push('## Acceptance Criteria');
    lines.push('');
    lines.push(spec.acceptanceCriteria);
    lines.push('');
  }

  if (spec.openQuestions) {
    lines.push('## Open Questions');
    lines.push('');
    lines.push(spec.openQuestions);
    lines.push('');
  }

  if (spec.requirementsFunctional || spec.requirementsTechnical) {
    lines.push('## Requirements');
    lines.push('');
    if (spec.requirementsFunctional) {
      lines.push('### Functional');
      lines.push('');
      lines.push(spec.requirementsFunctional);
      lines.push('');
    }
    if (spec.requirementsTechnical) {
      lines.push('### Technical');
      lines.push('');
      lines.push(spec.requirementsTechnical);
      lines.push('');
    }
  }

  if (spec.context) {
    lines.push('## Context');
    lines.push('');
    lines.push(spec.context);
    lines.push('');
  }

  return lines.join('\n');
}
