---
kanban-plugin: basic
---

# Proletariat Roadmap

## Backlog

## In Progress

## Review

- [ ] **TKT-036** [[TKT-036]] Add unit tests for spawner module
      **Priority:** MEDIUM
      **Category:** test
      **pr_url:** https://github.com/chrismcdermut/proletariat/pull/49
      ***
      Add comprehensive unit tests for the spawner.ts module including agent selection strategies

- [ ] **TKT-037** [[TKT-037]] Improve error messages in work start
      **Priority:** LOW
      **Category:** fix
      ***
      Add more descriptive error messages when work start fails due to missing agent or container issues

- [ ] **TKT-038** [[TKT-038]] Add --dry-run flag to spawn-all
      **Priority:** MEDIUM
      **Category:** feat
      ***
      Add a dry-run mode to spawn-all command that shows what would be spawned without actually starting agents

- [ ] **TKT-039** [[TKT-039]] Implement event-based hooks for auto-spawn
      **Priority:** MEDIUM
      **Category:** feat
      ***
      Add hooks system that triggers on events like ticket.created, ticket.moved, ticket.status_changed. Hooks would fire inline when CLI commands run (no server needed). Config via .proletariat/hooks.yaml or workspace settings. Use cases: auto-spawn when ticket enters Ready column, notify on status changes, etc.

## Done
