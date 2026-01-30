import { expect } from 'chai';
import { parseSpecContent, validateSpec, specToMarkdown } from '../../src/lib/pmo/spec-parser.js';

describe('Spec Parser', () => {
  describe('parseSpecContent', () => {
    it('parses frontmatter with id, status, and type', () => {
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

      const parsed = parseSpecContent(content);

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
      const content = `# Spec Without Frontmatter

## Problem

A problem statement.

## Solution

A solution description.
`;

      const parsed = parseSpecContent(content);

      expect(parsed.frontmatter.id).to.be.undefined;
      expect(parsed.title).to.equal('Spec Without Frontmatter');
      expect(parsed.problem).to.equal('A problem statement.');
      expect(parsed.solution).to.equal('A solution description.');
    });

    it('parses all optional sections', () => {
      const content = `---
id: full-spec
---

# Full Spec

## Problem

Problem here.

## Solution

Solution here.

## Decisions

- Decision 1
- Decision 2

## Not Now

- Deferred item 1

## UI/UX

Success flow description.

## Acceptance Criteria

- [ ] Given X, when Y, then Z

## Open Questions

- Question 1?

## Requirements

### Functional

- FR1: Must do X

### Technical

- TR1: Performance under 100ms

## Context

Background information.
`;

      const parsed = parseSpecContent(content);

      expect(parsed.decisions).to.contain('Decision 1');
      expect(parsed.notNow).to.contain('Deferred item 1');
      expect(parsed.uiUx).to.contain('Success flow');
      expect(parsed.acceptanceCriteria).to.contain('Given X');
      expect(parsed.openQuestions).to.contain('Question 1');
      expect(parsed.requirementsFunctional).to.contain('FR1');
      expect(parsed.requirementsTechnical).to.contain('TR1');
      expect(parsed.context).to.contain('Background');
    });

    it('returns Untitled for spec without H1 heading', () => {
      const content = `## Problem

Some problem.

## Solution

Some solution.
`;

      const parsed = parseSpecContent(content);
      expect(parsed.title).to.equal('Untitled');
    });

    it('preserves rawContent', () => {
      const content = '# Test\n\n## Problem\n\nHello\n\n## Solution\n\nWorld';
      const parsed = parseSpecContent(content);
      expect(parsed.rawContent).to.equal(content);
    });
  });

  describe('validateSpec', () => {
    it('returns no errors for valid spec', () => {
      const content = `---
id: valid-spec
---

# Valid Spec

## Problem

Problem statement.

## Solution

Solution description.
`;

      const parsed = parseSpecContent(content);
      const errors = validateSpec(parsed);

      expect(errors).to.be.empty;
    });

    it('returns error for missing id', () => {
      const content = `# Spec Without ID

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content);
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

      const parsed = parseSpecContent(content);
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing title (H1 heading)');
    });

    it('returns error for missing Problem section', () => {
      const content = `---
id: no-problem
---

# No Problem Spec

## Solution

Solution only.
`;

      const parsed = parseSpecContent(content);
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing Problem section');
    });

    it('returns error for missing Solution section', () => {
      const content = `---
id: no-solution
---

# No Solution Spec

## Problem

Problem only.
`;

      const parsed = parseSpecContent(content);
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing Solution section');
    });

    it('returns multiple errors for multiple issues', () => {
      const content = `## Context

Just context, nothing else.
`;

      const parsed = parseSpecContent(content);
      const errors = validateSpec(parsed);

      expect(errors).to.include('Missing id in frontmatter');
      expect(errors).to.include('Missing title (H1 heading)');
      expect(errors).to.include('Missing Problem section');
      expect(errors).to.include('Missing Solution section');
    });
  });

  describe('specToMarkdown', () => {
    it('converts parsed spec back to markdown', () => {
      const content = `---
id: roundtrip-spec
status: draft
type: platform
---

# Roundtrip Test

## Problem

The problem.

## Solution

The solution.
`;

      const parsed = parseSpecContent(content);
      const markdown = specToMarkdown(parsed);

      expect(markdown).to.contain('id: roundtrip-spec');
      expect(markdown).to.contain('status: draft');
      expect(markdown).to.contain('type: platform');
      expect(markdown).to.contain('# Roundtrip Test');
      expect(markdown).to.contain('## Problem');
      expect(markdown).to.contain('The problem.');
      expect(markdown).to.contain('## Solution');
      expect(markdown).to.contain('The solution.');
    });

    it('includes tags and depends_on when present', () => {
      const content = `---
id: spec-with-arrays
tags: [tag1, tag2]
depends_on: [dep1, dep2]
---

# Array Test

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content);
      const markdown = specToMarkdown(parsed);

      expect(markdown).to.contain('tags: [tag1, tag2]');
      expect(markdown).to.contain('depends_on: [dep1, dep2]');
    });

    it('can exclude frontmatter', () => {
      const content = `---
id: no-frontmatter
---

# No Frontmatter Output

## Problem

Problem.

## Solution

Solution.
`;

      const parsed = parseSpecContent(content);
      const markdown = specToMarkdown(parsed, { includeFrontmatter: false });

      expect(markdown).to.not.contain('---');
      expect(markdown).to.not.contain('id:');
      expect(markdown).to.contain('# No Frontmatter Output');
    });

    it('includes optional sections when present', () => {
      const content = `---
id: full-spec
---

# Full Spec

## Problem

Problem.

## Solution

Solution.

## Decisions

Key decisions.

## Not Now

Deferred scope.

## UI/UX

User experience.

## Acceptance Criteria

Criteria here.

## Open Questions

Questions here.

## Context

Background.
`;

      const parsed = parseSpecContent(content);
      const markdown = specToMarkdown(parsed);

      expect(markdown).to.contain('## Decisions');
      expect(markdown).to.contain('## Not Now');
      expect(markdown).to.contain('## UI/UX');
      expect(markdown).to.contain('## Acceptance Criteria');
      expect(markdown).to.contain('## Open Questions');
      expect(markdown).to.contain('## Context');
    });

    it('includes nested requirements sections', () => {
      const content = `---
id: req-spec
---

# Requirements Spec

## Problem

Problem.

## Solution

Solution.

## Requirements

### Functional

Functional reqs.

### Technical

Technical reqs.
`;

      const parsed = parseSpecContent(content);
      const markdown = specToMarkdown(parsed);

      expect(markdown).to.contain('## Requirements');
      expect(markdown).to.contain('### Functional');
      expect(markdown).to.contain('Functional reqs.');
      expect(markdown).to.contain('### Technical');
      expect(markdown).to.contain('Technical reqs.');
    });
  });
});
