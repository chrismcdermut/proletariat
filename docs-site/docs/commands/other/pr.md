---
sidebar_position: 4
title: pr
---

# prlt pr

Manage pull requests.

## Usage

```bash
prlt pr <subcommand>
```

## Subcommands

### pr create

Create a PR for a ticket:

```bash
prlt pr create <ticket-id>
prlt pr create TKT-001
```

### pr list

List PRs:

```bash
prlt pr list
```

### pr status

Check PR status:

```bash
prlt pr status <ticket-id>
prlt pr status TKT-001
```

### pr link

Link existing PR to ticket:

```bash
prlt pr link <ticket-id> <pr-url>
prlt pr link TKT-001 https://github.com/org/repo/pull/123
```
