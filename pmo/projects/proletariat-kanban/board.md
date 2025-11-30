---
kanban-plugin: basic
---

## BUILD BL

## GROW BL

## SUPPORT BL

## ️ BIZOPS BL

## STRATEGY BL

## Ready

- [ ] [[WORK-001]] Implement prlt ticket assign command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Create interactive command to assign tickets to humans or agents with dropdown selection

- [ ] [[WORK-002]] Implement prlt ticket own command
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Create command for humans to take ownership/responsibility of tickets

- [ ] [[WORK-003]] Implement prlt ticket claim command
      **Priority:** MEDIUM
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Create command for humans to claim tickets (own + execute)

- [ ] [[WORK-004]] Add owner and assignee columns to pmo_tickets table
      **Priority:** HIGH
      **Category:** backend
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Migrate from pmo_ticket_assignments table to simple owner/assignee columns

- [ ] [[WORK-005]] Implement backend assignTicket method
      **Priority:** HIGH
      **Category:** backend
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Add storage method to set ticket assignee with optional owner

- [ ] [[WORK-006]] Implement backend ownTicket method
      **Priority:** MEDIUM
      **Category:** backend
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Add storage method to set ticket owner

- [ ] [[WORK-007]] Implement backend claimTicket method
      **Priority:** MEDIUM
      **Category:** backend
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Add storage method to set both owner and assignee

- [ ] [[WORK-008]] Add getAssignedTickets to Agent SDK
      **Priority:** MEDIUM
      **Category:** agent-sdk
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Implement agent polling for tickets assigned to them

- [ ] [[WORK-009]] Implement prlt ticket execute command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-work-commands.md|pmo-work-commands]]
      ***
      Execute a ticket by spinning up the assigned agent or prompting human to start work

- [ ] [[PMO-CRUD-001]] Implement prlt ticket list command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-crud-commands.md|pmo-crud-commands]]
      ***
      Create command to list all tickets with filtering by column, priority, category, and assignee

- [ ] [[PMO-CRUD-002]] Implement prlt ticket view command
      **Priority:** HIGH
      **Category:** feature
      **Spec:** [[projects/proletariat-kanban/specs/active/pmo-crud-commands.md|pmo-crud-commands]]
      ***
      Create command to view detailed ticket information including metadata, subtasks, and linked specs

## In Progress

## In Review

## Merged

## Published

## ️ Dropped
