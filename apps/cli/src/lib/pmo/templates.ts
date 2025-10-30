export const README_TEMPLATE = `# PMO (Project Management Office) System

## Overview
This is a markdown-based Kanban project management system designed for both human readability and AI agent compatibility. It integrates with Obsidian's Kanban plugin while maintaining a clear file-based workflow.

## Directory Structure
\`\`\`
/pmo/
├── kanban.md                    # Main kanban board (Obsidian-compatible)
├── active-work/                 # Currently active specifications
├── completed-work/              # Completed specifications  
├── future-work/                 # Future/backlog specifications
├── engineering-learnings.md     # Project retrospectives
├── SPEC_TEMPLATE.md             # Template for new specifications
└── README.md                    # This file
\`\`\`

## Quick Start

### Creating a New Task
1. Copy \`SPEC_TEMPLATE.md\` to the appropriate directory:
   - \`active-work/\` for immediate work
   - \`future-work/\` for backlog items
2. Fill out the specification
3. Add the task to \`kanban.md\` in the appropriate column

### Moving Tasks Through Workflow
1. **Backlog → In Progress**: Move spec to \`active-work/\` if not already there
2. **In Progress → Done**: Move spec from \`active-work/\` to \`completed-work/\`
3. **Done → Released**: Update kanban.md, spec stays in \`completed-work/\`

## Kanban Board Features

### Task Format
\`\`\`markdown
- [ ] [[task-name]]
      **Priority:** [URGENT/IMPORTANT/LOW]
      **Category:** [BUILD/Tech Debt/GROW/LEARN]
      ***
      Brief description
      - [ ] Subtask 1
      - [ ] Subtask 2
      [Spec](active-work/task-name.md)
\`\`\`

### Categories
- **BUILD**: Feature development
- **Tech Debt**: Refactoring, optimization, cleanup
- **GROW**: Documentation, processes, tooling
- **LEARN**: Research, experimentation, prototypes

### Priority Levels
- **URGENT**: Blocking issues, critical path items
- **IMPORTANT**: Significant features or improvements
- **LOW**: Nice-to-have, non-critical tasks

## Obsidian Integration

### Setup
1. Install Obsidian Kanban plugin
2. Open \`pmo/kanban.md\` in Obsidian
3. The file will automatically render as a kanban board

### Features
- Drag and drop tasks between columns
- Click [[task-name]] to navigate to specifications
- Use backlinks to see all references to a task

## Agent/CLI Usage

### Common Operations
\`\`\`bash
# List active work
ls pmo/active-work/

# View kanban status
cat pmo/kanban.md

# Create new task from template
cp pmo/SPEC_TEMPLATE.md pmo/future-work/new-task.md

# Move task to active
mv pmo/future-work/task.md pmo/active-work/

# Complete a task
mv pmo/active-work/task.md pmo/completed-work/
\`\`\`

## Best Practices

1. **One task, one file**: Each task should have its own specification file
2. **Update location and kanban together**: When moving files, update kanban.md
3. **Document learnings**: Add retrospectives to completed specs
4. **Regular cleanup**: Archive old completed tasks periodically
5. **Keep specs updated**: Specifications are living documents

## Workflow Example

\`\`\`
1. Idea/Request → Create spec in future-work/
2. Planning → Move spec to active-work/, add to kanban Backlog
3. Start work → Move task to In Progress column
4. Complete → Move spec to completed-work/, update kanban
5. Deploy → Move to Released column
6. Retrospective → Update engineering-learnings.md
\`\`\`

## Tips for AI Agents

When working with this system:
- Always check file location to understand task status
- Update both the file location and kanban.md when changing status
- Use the template for consistency
- Add meaningful commit messages when updating PMO files
- Link related tasks using [[wiki-links]] for Obsidian compatibility
`;

export const KANBAN_TEMPLATE = `---
kanban-plugin: board
---

## Backlog

## In Progress

## Done / In Review

## Released

## Skipped/Not Pursuing
`;

export const SPEC_TEMPLATE = `---
title: SPEC TITLE
status: draft
owner: OWNER NAME
category: BUILD | Tech Debt | GROW | LEARN
priority: URGENT | IMPORTANT | LOW
created: ${new Date().toISOString().split('T')[0]}
---

## Summary
- What problem are we solving?
- Who benefits?
- Why now?

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Implementation Plan
1. Step one
2. Step two
3. Step three

## Risks & Mitigations
- Risk: ...
  - Mitigation: ...

## Rollout Plan
- Milestone 1
- Milestone 2

## Notes
- Additional context or references.
`;

export const ENGINEERING_LEARNINGS_TEMPLATE = `# Engineering Learnings

Document retrospectives, post-mortems, and lessons learned here.

## ${new Date().getFullYear()} Learnings

- YYYY-MM-DD: Key takeaway and follow-up actions.
`;
