# Project Management Office (PMO)

This directory contains the project management state following the "company as code" philosophy.

## Structure

- `kanban.md` - Main project kanban board (Obsidian compatible)
- `specs/` - Feature specifications
  - `active/` - Currently being worked on
  - `completed/` - Finished specifications
  - `backlog/` - Future work
- `learnings.md` - Engineering learnings and retrospectives
- `config.yml` - PMO configuration

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
- **CLI**: `prlt pmo status` for terminal view

## Commands

```bash
# Initialize PMO in current repo
prlt pmo init

# Show project status
prlt pmo status

# Sync kanban from multiple repos (in org-level PMO)
prlt pmo sync
```
