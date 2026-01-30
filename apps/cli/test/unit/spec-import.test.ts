import { expect } from 'chai';
import { parseSpecContent, validateSpec } from '../../src/lib/pmo/spec-parser.js';
import { slugify } from '../../src/lib/pmo/utils.js';
import { SpecType } from '../../src/lib/pmo/types.js';
import { ParsedSpec } from '../../src/lib/pmo/spec-types.js';

/**
 * Helper functions from spec/import.ts (duplicated for testing)
 */
function folderToSpecType(folderName: string): SpecType | undefined {
  const typeMap: Record<string, SpecType> = {
    product: 'product',
    platform: 'platform',
    infra: 'infra',
    integrations: 'integration',
    integration: 'integration',
  };
  return typeMap[folderName.toLowerCase()];
}

function getSpecId(parsedSpec: ParsedSpec, filePath: string): string {
  if (parsedSpec.frontmatter.id) {
    return parsedSpec.frontmatter.id;
  }
  if (parsedSpec.title && parsedSpec.title !== 'Untitled') {
    return slugify(parsedSpec.title);
  }
  const basename = filePath.replace(/.*\//, '').replace('.md', '');
  return slugify(basename);
}

describe('Spec Import', () => {
  describe('parseSpecContent', () => {
    it('parses spec with full frontmatter', () => {
      const content = `---
id: my-spec
status: active
type: product
tags: [core, mvp]
depends_on: [other-spec]
---

# My Spec Title

## Problem

This is the problem.

## Solution

This is the solution.
`;

      const parsed = parseSpecContent(content, 'specs/product/my-spec.md');

      expect(parsed.frontmatter.id).to.equal('my-spec');
      expect(parsed.frontmatter.status).to.equal('active');
      expect(parsed.frontmatter.type).to.equal('product');
      expect(parsed.frontmatter.tags).to.deep.equal(['core', 'mvp']);
      expect(parsed.frontmatter.depends_on).to.deep.equal(['other-spec']);
      expect(parsed.title).to.equal('My Spec Title');
      expect(parsed.problem).to.equal('This is the problem.');
      expect(parsed.solution).to.equal('This is the solution.');
    });

    it('parses spec without frontmatter', () => {
      const content = `# Auth System

## Problem

Users need to authenticate.

## Solution

Implement OAuth 2.0.
`;

      const parsed = parseSpecContent(content, 'specs/product/auth.md');

      expect(parsed.frontmatter.id).to.be.undefined;
      expect(parsed.frontmatter.status).to.be.undefined;
      expect(parsed.title).to.equal('Auth System');
      expect(parsed.problem).to.equal('Users need to authenticate.');
      expect(parsed.solution).to.equal('Implement OAuth 2.0.');
    });

    it('parses nested requirements sections', () => {
      const content = `# Feature

## Problem

Problem text.

## Solution

Solution text.

## Requirements

### Functional

- User can login
- User can logout

### Technical

- Use JWT tokens
- Rate limit API
`;

      const parsed = parseSpecContent(content, 'specs/feature.md');

      expect(parsed.requirementsFunctional).to.contain('User can login');
      expect(parsed.requirementsFunctional).to.contain('User can logout');
      expect(parsed.requirementsTechnical).to.contain('Use JWT tokens');
      expect(parsed.requirementsTechnical).to.contain('Rate limit API');
    });

    it('parses all optional sections', () => {
      const content = `---
id: full-spec
---

# Complete Spec

## Problem

The problem.

## Solution

The solution.

## Decisions

- Decision 1
- Decision 2

## Not Now

- Deferred feature

## UI/UX

- User flow here

## Acceptance Criteria

- [ ] Given X, when Y, then Z

## Open Questions

- What about edge cases?

## Context

Background info.
`;

      const parsed = parseSpecContent(content, 'specs/full-spec.md');

      expect(parsed.decisions).to.contain('Decision 1');
      expect(parsed.notNow).to.contain('Deferred feature');
      expect(parsed.uiUx).to.contain('User flow here');
      expect(parsed.acceptanceCriteria).to.contain('Given X, when Y, then Z');
      expect(parsed.openQuestions).to.contain('What about edge cases?');
      expect(parsed.context).to.contain('Background info');
    });
  });

  describe('validateSpec', () => {
    it('returns no errors for valid spec', () => {
      const content = `---
id: valid-spec
---

# Valid Title

## Problem

Valid problem.

## Solution

Valid solution.
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.be.empty;
    });

    it('returns error for missing id', () => {
      const content = `# Title

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing id in frontmatter');
    });

    it('returns error for missing title', () => {
      const content = `---
id: no-title
---

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing title (H1 heading)');
    });

    it('returns error for missing Problem section', () => {
      const content = `---
id: no-problem
---

# Title

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing Problem section');
    });

    it('returns error for missing Solution section', () => {
      const content = `---
id: no-solution
---

# Title

## Problem

Problem.
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing Solution section');
    });

    it('returns multiple errors for multiple issues', () => {
      const content = `## Not a title
`;

      const parsed = parseSpecContent(content, 'test.md');
      const errors = validateSpec(parsed);

      expect(errors).to.have.lengthOf.at.least(3);
      expect(errors).to.include('Missing id in frontmatter');
      expect(errors).to.include('Missing title (H1 heading)');
      expect(errors).to.include('Missing Problem section');
    });
  });

  describe('folderToSpecType', () => {
    it('maps product folder to product type', () => {
      expect(folderToSpecType('product')).to.equal('product');
    });

    it('maps platform folder to platform type', () => {
      expect(folderToSpecType('platform')).to.equal('platform');
    });

    it('maps infra folder to infra type', () => {
      expect(folderToSpecType('infra')).to.equal('infra');
    });

    it('maps integrations folder to integration type', () => {
      expect(folderToSpecType('integrations')).to.equal('integration');
    });

    it('maps integration folder to integration type', () => {
      expect(folderToSpecType('integration')).to.equal('integration');
    });

    it('handles case insensitively', () => {
      expect(folderToSpecType('Product')).to.equal('product');
      expect(folderToSpecType('PLATFORM')).to.equal('platform');
    });

    it('returns undefined for unknown folder', () => {
      expect(folderToSpecType('docs')).to.be.undefined;
      expect(folderToSpecType('other')).to.be.undefined;
    });
  });

  describe('getSpecId', () => {
    it('uses frontmatter id when present', () => {
      const content = `---
id: custom-id
---

# Title

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'specs/my-spec.md');
      expect(getSpecId(parsed, 'specs/my-spec.md')).to.equal('custom-id');
    });

    it('falls back to slugified title', () => {
      const content = `# User Authentication

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'specs/auth.md');
      expect(getSpecId(parsed, 'specs/auth.md')).to.equal('user-authentication');
    });

    it('falls back to filename when no title', () => {
      const content = `## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, 'specs/my-feature.md');
      expect(getSpecId(parsed, 'specs/my-feature.md')).to.equal('my-feature');
    });

    it('handles complex file paths', () => {
      const content = `## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content, '/workspace/project/specs/product/my-spec.md');
      expect(getSpecId(parsed, '/workspace/project/specs/product/my-spec.md')).to.equal('my-spec');
    });
  });
});
