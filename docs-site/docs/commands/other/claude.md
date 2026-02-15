---
sidebar_position: 16
title: claude
---

# prlt claude

Start an interactive Claude Code session for quick AI assistance.

:::info
This command starts a standalone Claude session without ticket context. For ticket-aware work, use `prlt work start` instead.
:::

## Usage

```bash
prlt claude [prompt]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `prompt` | Optional initial prompt to start the conversation |

## Examples

### Start Interactive Session

```bash
prlt claude
```

Opens Claude Code in interactive mode where you can ask questions, get code help, and more.

### Start with Initial Prompt

```bash
prlt claude "explain this error"
prlt claude "how do I parse JSON in Python"
```

Starts the session with your question already submitted.

## When to Use

- Quick questions about code or debugging
- One-off tasks that don't need ticket tracking
- Exploring ideas before creating a ticket
- Getting help with commands or syntax

## See Also

- [work start](/commands/work/start) - Start agent with ticket context
- [Spawning Agents Guide](/guides/spawning-agents)
