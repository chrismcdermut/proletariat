# Running Orchestrator in Docker

This guide explains how to run the prlt orchestrator in a Docker container using the sibling container pattern.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Benefits](#benefits)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Setup](#setup)
- [Usage](#usage)
- [Authentication](#authentication)
- [Troubleshooting](#troubleshooting)
- [Advanced](#advanced)

## Overview

The orchestrator can now run in a Docker container instead of directly on the host machine. This uses the **sibling container pattern**, where the orchestrator container has the Docker socket mounted, allowing it to spawn agent containers as siblings.

## Architecture

### Sibling Container Pattern

```
Host Docker daemon
├── orchestrator container (has /var/run/docker.sock mounted)
├── agent-1 container (spawned by orchestrator, sibling)
├── agent-2 container (spawned by orchestrator, sibling)
└── agent-3 container (spawned by orchestrator, sibling)
```

The orchestrator container:
- Has the HQ directory mounted at `/hq`
- Has the Docker socket mounted at `/var/run/docker.sock`
- Contains the prlt CLI and Claude Code
- Can spawn agent containers as siblings (not nested)

### Why Sibling Pattern?

The sibling pattern avoids Docker-in-Docker (DinD), which has several issues:
- Performance overhead
- Security concerns
- Complexity
- Storage driver conflicts

Instead, the orchestrator container uses the host's Docker daemon to create sibling containers.

## Benefits

1. **Isolation**: Orchestrator runs in its own container, isolated from the host system
2. **Remote Access**: Enables remote orchestrator management (e.g., SSH from phone) without macOS keychain issues
3. **Consistent Pattern**: Uses the same container approach as agents
4. **OAuth Support**: Uses Docker OAuth credentials instead of macOS keychain
5. **Portability**: Can run on any system with Docker (Linux, macOS, Windows)

## Prerequisites

- Docker installed and running
- prlt CLI installed globally (on host)
- Claude OAuth credentials OR ANTHROPIC_API_KEY

## Quick Start

1. Build the orchestrator image:
   ```bash
   ./docker/orchestrator/build.sh --local
   ```

2. Start the orchestrator in Docker:
   ```bash
   prlt orchestrator start --docker
   ```

That's it! The orchestrator is now running in a container and can spawn agent containers as siblings.

## Setup

### 1. Build the Orchestrator Image

From the proletariat project root:

```bash
# Using published npm package (when available)
docker build -t prlt-orchestrator:latest -f docker/orchestrator/Dockerfile .

# OR using local build (development)
./docker/orchestrator/build.sh --local
```

### 2. Set Up Authentication

The orchestrator needs Claude credentials to work. You have two options:

#### Option A: OAuth Credentials (Recommended)

Set up the `claude-credentials` Docker volume:

```bash
# Run claude once to set up OAuth
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest
```

This stores OAuth tokens in a Docker volume that the orchestrator container will mount.

#### Option B: API Key

Set the `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

The orchestrator container will use this API key instead of OAuth.

### 3. Verify Setup

Test that the image is built correctly:

```bash
docker run --rm prlt-orchestrator:latest prlt --version
```

You should see the prlt version output.

## Usage

### Starting the Orchestrator

Run the orchestrator in Docker:

```bash
prlt orchestrator start --docker
```

This will:
1. Check that the `prlt-orchestrator:latest` image exists
2. Create a container with:
   - HQ directory mounted at `/hq`
   - Docker socket mounted at `/var/run/docker.sock`
   - Claude credentials (OAuth volume or API key)
3. Start the orchestrator inside the container
4. Open a terminal tab (or run in background with `--background`)

### With Custom Prompt

```bash
prlt orchestrator start --docker --prompt "coordinate all agents on TKT-100"
```

### In Background

```bash
prlt orchestrator start --docker --background
```

### With Custom Executor

```bash
prlt orchestrator start --docker --executor codex
```

### Multiple Orchestrators

Run multiple orchestrators with different names:

```bash
prlt orchestrator start --docker --name prod
prlt orchestrator start --docker --name staging
prlt orchestrator start --docker --name dev
```

### Explicitly Running on Host

To explicitly run on the host (skip Docker):

```bash
prlt orchestrator start --run-on-host
```

## Authentication

### OAuth Credentials (Recommended)

The orchestrator container mounts the `claude-credentials` Docker volume at `/root/.claude`:

```bash
# Set up OAuth credentials (one-time setup)
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest
```

Benefits:
- Uses your Claude Max subscription
- Automatic token refresh
- No API key management
- Works remotely (no macOS keychain dependency)

### API Key

If you prefer to use an API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
prlt orchestrator start --docker
```

The container will use the API key from the environment variable.

## Troubleshooting

### Image Not Found

**Error**: `Orchestrator Docker image 'prlt-orchestrator:latest' not found`

**Solution**: Build the image first:
```bash
./docker/orchestrator/build.sh --local
```

### No Claude Credentials

**Error**: `No Claude credentials found`

**Solution**: Set up OAuth or provide an API key:
```bash
# Option 1: Set up OAuth (recommended)
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest

# Option 2: Use API key
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Permission Denied on Docker Socket

**Error**: `permission denied while trying to connect to the Docker daemon socket`

**Solution**: Ensure your user is in the docker group:
```bash
sudo usermod -aG docker $USER
# Then log out and back in
```

### Container Exits Immediately

**Error**: Container starts but exits right away

**Solution**: Check the logs:
```bash
docker logs <container-id>
```

Common causes:
- prlt CLI not installed correctly in the image
- Missing dependencies
- Invalid credentials

### Agent Containers Not Starting

**Error**: Orchestrator can't spawn agent containers

**Solution**: Verify Docker socket is mounted:
```bash
docker inspect <orchestrator-container-id> | grep -A 5 Mounts
```

You should see `/var/run/docker.sock` mounted.

## Advanced

### Custom Image Name

Use a custom image name:

```bash
export PRLT_ORCHESTRATOR_IMAGE="my-orchestrator:v1"
docker build -t $PRLT_ORCHESTRATOR_IMAGE -f docker/orchestrator/Dockerfile .
prlt orchestrator start --docker
```

### Resource Limits

The orchestrator container uses resource limits from `execution.docker` config:

```typescript
docker: {
  memory: '8g',
  cpus: 4
}
```

Modify these in your workspace configuration.

### Network Configuration

The orchestrator uses the host network by default for simplicity. To use a custom network:

1. Create a bridge network:
   ```bash
   docker network create orchestrator-net
   ```

2. Modify the `runOrchestratorDocker` function to use this network

### Development

For local development with hot reloading:

1. Build the local CLI:
   ```bash
   cd apps/cli
   pnpm build
   ```

2. Build the image with local sources:
   ```bash
   ./docker/orchestrator/build.sh --local
   ```

3. Rebuild after code changes:
   ```bash
   pnpm build && ./docker/orchestrator/build.sh --local
   ```

### Debugging

Run the orchestrator container interactively for debugging:

```bash
docker run --rm -it \
  -v "$(pwd):/hq" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v claude-credentials:/root/.claude \
  prlt-orchestrator:latest \
  /bin/bash
```

Then inside the container:
```bash
cd /hq
prlt orchestrator start
```

### Remote Orchestrator

SSH into a remote machine and run the orchestrator in Docker:

```bash
ssh remote-machine
cd /path/to/hq
prlt orchestrator start --docker --background
```

This works without macOS keychain issues because the orchestrator uses OAuth credentials stored in the Docker volume.

## Comparison: Host vs Docker

| Feature | Host | Docker |
|---------|------|--------|
| **Isolation** | No | Yes (container) |
| **Remote Access** | macOS keychain issues | Works via SSH |
| **Authentication** | macOS keychain (OAuth) | Docker volume (OAuth) or API key |
| **Setup** | None (direct) | Build image |
| **Performance** | Native | Slight overhead |
| **Portability** | macOS/Linux | Any Docker host |
| **Security** | Host access | Container isolation |

## Related Documentation

- [Orchestrator Overview](./orchestrator.md)
- [Docker Architecture](./docker-architecture.md)
- [Agent Containers](./agent-containers.md)
- [Execution Environments](./execution-environments.md)

## Changelog

### v0.3.48 (TKT-1178)
- Initial release of Docker support for orchestrator
- Sibling container pattern implementation
- OAuth and API key authentication support
- Build scripts and documentation
