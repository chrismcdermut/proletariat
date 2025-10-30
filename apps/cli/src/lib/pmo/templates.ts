export const PMO_TEMPLATES = {
  kanban: `---

kanban-plugin: board

---

## Backlog

## In Progress

## In Review

## Complete

## Archived


%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false,false,true]}
\`\`\`
%%`,

  readme: `# Project Management Office (PMO)

This directory contains the project management state following the "company as code" philosophy.

## Structure

- \`kanban.md\` - Main project kanban board (Obsidian compatible)
- \`specs/\` - Feature specifications
  - \`active/\` - Currently being worked on
  - \`completed/\` - Finished specifications
  - \`backlog/\` - Future work
- \`learnings.md\` - Engineering learnings and retrospectives
- \`config.yml\` - PMO configuration

## Philosophy

This PMO is:
- **Version controlled** - All project management state is tracked in git
- **AI-agent friendly** - Markdown files easily readable/writable by AI
- **Team synchronized** - Everyone sees the same state
- **Tool agnostic** - Works with Obsidian, VSCode, or any text editor

## Workflow

1. Create feature branches with both code AND kanban updates
2. Move cards across columns as work progresses
3. Specs evolve from backlog → active → completed
4. Learnings are documented continuously

## Viewing

- **Obsidian**: Install Kanban plugin for visual board
- **VSCode**: Markdown preview for reading
- **CLI**: \`prlt pmo status\` for terminal view

## Commands

\`\`\`bash
# Initialize PMO in current repo
prlt pmo init

# Show project status
prlt pmo status

# Sync kanban from multiple repos (in org-level PMO)
prlt pmo sync
\`\`\`
`,

  learnings: `# Engineering Learnings

Document key technical decisions, gotchas, and insights discovered during development.

## Format

### [Date] - [Topic]
**Context**: What were we trying to do?
**Discovery**: What did we learn?
**Impact**: How does this change our approach?
**Tags**: #architecture #performance #security

---

## Learnings Log

### ${new Date().toISOString().split('T')[0]} - PMO Structure
**Context**: Implementing project management as code
**Discovery**: Keeping PMO in git provides perfect audit trail and enables AI collaboration
**Impact**: Teams can track work evolution and AI agents can update status
**Tags**: #process #ai #collaboration
`,

  specTemplate: `# [Feature Name]

## Status
- **State**: Draft | Active | Complete
- **Owner**: @username
- **Created**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD

## Problem Statement
What problem are we solving? Why now?

## Success Criteria
- [ ] Measurable outcome 1
- [ ] Measurable outcome 2

## Solution Design

### Approach
High-level approach and key decisions

### Technical Details
Implementation specifics

### Dependencies
- External services
- Other features
- Team dependencies

## Implementation Plan
1. [ ] Step 1
2. [ ] Step 2
3. [ ] Step 3

## Rollout Strategy
How will we deploy and validate?

## Open Questions
- Question 1?
- Question 2?
`,

  config: `# PMO Configuration

# Type of PMO setup
type: embedded  # embedded | consolidated | hybrid

# For consolidated PMO, list repos to track
repos:
  # - name: project-a
  #   path: ../project-a
  #   kanban: pmo/kanban.md
  # - name: project-b  
  #   path: ../project-b
  #   kanban: pmo/kanban.md

# Sync settings
sync:
  # Auto-sync on commit
  auto: false
  # Sync interval in minutes (if running daemon)
  interval: 30

# Kanban settings
kanban:
  # Default columns for new boards
  columns:
    - Backlog
    - In Progress
    - In Review
    - Complete
    - Archived
  
  # Card template
  card_template: |
    - [ ] [[{{slug}}]]
      **Priority:** {{priority}}
      **Category:** {{category}}
      ***
      {{description}}

# Integration settings
integrations:
  # Obsidian compatibility
  obsidian:
    enabled: true
    kanban_plugin: true
  
  # GitHub integration
  github:
    # Auto-create cards from issues
    sync_issues: false
    # Update PR descriptions with card status
    update_prs: false
`
};

export const PMO_STRUCTURE = {
  files: [
    { path: 'kanban.md', template: 'kanban' },
    { path: 'README.md', template: 'readme' },
    { path: 'learnings.md', template: 'learnings' },
    { path: 'config.yml', template: 'config' }
  ],
  directories: [
    'specs',
    'specs/active',
    'specs/completed',
    'specs/backlog'
  ]
};