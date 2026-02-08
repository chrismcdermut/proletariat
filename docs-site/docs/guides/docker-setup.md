---
sidebar_position: 3
title: Docker Setup
---

# Docker Setup

Run agents in isolated Docker containers for maximum safety.

## Prerequisites

- Docker Desktop or Docker Engine installed
- Docker daemon running

Verify Docker:

```bash
docker version
docker ps
```

## Devcontainer Configuration

prlt uses VS Code's devcontainer format. Create `.devcontainer/devcontainer.json`:

```json
{
  "name": "Dev Container",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {
      "version": "20"
    },
    "ghcr.io/devcontainers/features/git:1": {}
  },
  "postCreateCommand": "npm install",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint"
      ]
    }
  }
}
```

### Node.js Project Example

```json
{
  "name": "Node.js Development",
  "image": "mcr.microsoft.com/devcontainers/javascript-node:20",
  "postCreateCommand": "npm ci",
  "mounts": [
    "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind"
  ]
}
```

### Python Project Example

```json
{
  "name": "Python Development",
  "image": "mcr.microsoft.com/devcontainers/python:3.11",
  "postCreateCommand": "pip install -r requirements.txt",
  "mounts": [
    "source=${localEnv:HOME}/.claude,target=/home/vscode/.claude,type=bind"
  ]
}
```

## Authentication in Containers

### Claude Code Auth

Mount your Claude credentials:

```json
{
  "mounts": [
    "source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind"
  ]
}
```

Or login inside container:

```bash
prlt agent login <agent-name>
```

### GitHub Auth

Set the `GITHUB_TOKEN` environment variable:

```json
{
  "containerEnv": {
    "GITHUB_TOKEN": "${localEnv:GITHUB_TOKEN}"
  }
}
```

Or mount gh credentials:

```json
{
  "mounts": [
    "source=${localEnv:HOME}/.config/gh,target=/home/node/.config/gh,type=bind"
  ]
}
```

## Using Docker Mode

When devcontainer exists, Docker is the default:

```bash
prlt work start TKT-001
# Automatically uses Docker
```

Explicitly specify:

```bash
prlt work start TKT-001 --mode docker
```

Force host mode:

```bash
prlt work start TKT-001 --run-on-host
```

## Container Management

### List Containers

```bash
prlt docker list
```

### Check Status

```bash
prlt docker status
```

### Container Operations

```bash
# Start container
prlt docker start <agent-name>

# Stop container
prlt docker stop <agent-name>

# Restart container
prlt docker restart <agent-name>

# Shell into container
prlt docker shell <agent-name>

# View logs
prlt docker logs <agent-name>
```

## Syncing Files

Sync files between host and container:

```bash
prlt docker sync <agent-name>
```

## Cleanup

Remove stopped containers:

```bash
prlt docker clean
```

Remove unused images and volumes:

```bash
prlt docker prune
```

## Troubleshooting

### Container Won't Start

1. Check Docker is running: `docker ps`
2. Verify devcontainer.json is valid JSON
3. Check image exists: `docker pull <image>`

### Authentication Fails

1. Verify mount paths are correct
2. Check file permissions on credentials
3. Try `prlt agent login` inside container

### Out of Disk Space

```bash
# Remove old containers
prlt docker clean

# Prune unused resources
prlt docker prune

# Docker system prune (careful!)
docker system prune -a
```

### Container is Slow

1. Allocate more resources in Docker Desktop
2. Use host mode for speed-critical work
3. Reduce number of concurrent containers

## Best Practices

1. **Always use Docker with YOLO mode** - Full isolation means safe autonomy
2. **Mount only necessary credentials** - Minimize exposure
3. **Regular cleanup** - Containers and images consume disk space
4. **Test devcontainer locally** - `code --folder-uri vscode-dev-container://<path>`
5. **Use postCreateCommand** - Install dependencies once

## Example Workflow

```bash
# Initialize workspace
prlt init

# Spawn agents in Docker with full autonomy
prlt work spawn TKT-001 TKT-002 --skip-permissions

# Monitor
prlt execution list
prlt docker status

# When done, cleanup
prlt docker clean
prlt agent cleanup
```

## Next Steps

- [GitHub Integration](/guides/github-integration) - PR workflows
- [Multi-Agent Workflows](/guides/multi-agent-workflows) - Scale up
- [Command Reference: docker](/commands/docker/list) - Full docker commands
