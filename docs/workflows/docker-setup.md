# Docker Setup and Container Isolation

This guide explains how to configure and use Docker containers for isolated agent execution.

## Why Docker?

Running agents in Docker containers provides:

- **Isolation**: Agent can't modify your host system
- **Consistency**: Same environment every time
- **Safety**: Experimental code runs in sandbox
- **Cleanup**: Easy to reset or remove
- **Parallelism**: Multiple agents without conflicts

## Prerequisites

### Install Docker

#### macOS

```bash
# Using Homebrew
brew install --cask docker

# Or download Docker Desktop from docker.com
```

#### Linux

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install docker.io
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group (avoid sudo)
sudo usermod -aG docker $USER
```

#### Windows

Download and install Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop).

### Verify Docker

```bash
docker --version
docker run hello-world
```

## Basic Usage

### Start Work with Docker

```bash
prlt work start TKT-001 --mode docker
```

This:
1. Creates a container with the agent environment
2. Mounts your repository as a volume
3. Starts the AI coding assistant inside
4. Creates git branch for the work

### Check Container Status

```bash
prlt docker status
# or
docker ps
```

### View Container Logs

```bash
prlt docker logs <agent-name>
# or
docker logs <container-id>
```

### Shell into Container

```bash
prlt docker shell <agent-name>
# or
docker exec -it <container-id> /bin/bash
```

## Container Management

### List Containers

```bash
prlt docker list
```

Shows:
- Container ID
- Agent name
- Status
- Ticket being worked

### Stop Container

```bash
prlt docker stop <agent-name>
```

### Restart Container

```bash
prlt docker restart <agent-name>
```

### Clean Up Containers

```bash
# Remove stopped containers
prlt docker clean

# Remove all unused Docker resources
prlt docker prune
```

## Container Configuration

### Volume Mounts

Repositories are mounted into containers:

```
Host                          Container
────────────────────          ────────────────────
/path/to/repo      ──────▶    /workspace/repo
~/.gitconfig       ──────▶    /root/.gitconfig
~/.ssh             ──────▶    /root/.ssh
```

### Environment Variables

Passed into containers:
- `GITHUB_TOKEN` - For GitHub operations
- `ANTHROPIC_API_KEY` - For Claude Code
- Git configuration

### Resource Limits

Default container limits:
- Memory: Determined by Docker settings
- CPU: Shared with host

## Devcontainer Mode

For VS Code devcontainer integration:

```bash
prlt work start TKT-001 --mode devcontainer
```

### Devcontainer Benefits

- Full VS Code integration
- Extensions pre-installed
- Familiar development environment
- Debugging support

### Display Options

```bash
# Open in new terminal (default)
prlt work start TKT-001 --mode devcontainer --display terminal

# Run in background
prlt work start TKT-001 --mode devcontainer --display background
```

## Session Management

### Tmux Inside Container

By default, agents run in tmux sessions inside containers:

```bash
# Start with tmux (default)
prlt work start TKT-001 --mode docker --session tmux
```

Benefits:
- Session persists if connection drops
- Can detach and reattach
- View agent output anytime

### Direct Mode

Run without tmux wrapper:

```bash
prlt work start TKT-001 --mode docker --session direct
```

### Attach to Tmux Session

```bash
# Shell into container
prlt docker shell alice

# Attach to tmux
tmux attach
```

## Troubleshooting Docker

### Docker Not Running

**Symptom**: "Cannot connect to Docker daemon"

**Solution**:

```bash
# macOS - Start Docker Desktop
open -a Docker

# Linux
sudo systemctl start docker
```

### Permission Denied

**Symptom**: "Permission denied while trying to connect"

**Solution** (Linux):

```bash
sudo usermod -aG docker $USER
# Log out and back in
```

### Container Won't Start

**Symptom**: Container exits immediately

**Debug**:

```bash
# Check logs
docker logs <container-id>

# Run interactively
docker run -it <image> /bin/bash
```

### Out of Disk Space

**Symptom**: "No space left on device"

**Solution**:

```bash
# Clean up Docker
docker system prune -a

# Or use prlt
prlt docker prune
```

### Volume Mount Issues

**Symptom**: Files not visible in container

**Check**:

```bash
# Verify mount
docker inspect <container-id> | grep -A 10 "Mounts"
```

## Security Considerations

### Credentials

Avoid storing credentials in containers. Use:
- Environment variables
- Mounted secrets
- Credential helpers

### Network Access

Containers have network access by default. For maximum isolation:

```bash
# Run without network
docker run --network none ...
```

### Host Access

Docker mode prevents direct host access, but mounted volumes are shared. Don't mount sensitive directories.

## Advanced Configuration

### Custom Docker Image

If you need custom tools in the agent environment:

1. Create Dockerfile:

```dockerfile
FROM node:18
RUN apt-get update && apt-get install -y git vim
# Add your tools
```

2. Build and tag:

```bash
docker build -t my-prlt-image .
```

3. Use with prlt (requires configuration).

### Resource Limits

Set container resource limits:

```bash
docker run --memory=8g --cpus=2 ...
```

### Persistent Volumes

For data that should persist across container restarts:

```bash
docker volume create prlt-data
docker run -v prlt-data:/data ...
```

## Comparing Execution Modes

| Feature | Docker | Devcontainer | Host |
|---------|--------|--------------|------|
| Isolation | Full | Full | None |
| IDE Integration | Limited | Excellent | Full |
| Setup Complexity | Low | Medium | None |
| Resource Overhead | Medium | Medium | None |
| Safety | High | High | Low |
| Speed | Fast | Medium | Fastest |

## Best Practices

### Always Use Docker for Untrusted Work

```bash
# Good
prlt work start TKT-001 --mode docker

# Risky
prlt work start TKT-001 --run-on-host
```

### Clean Up Regularly

```bash
# Daily cleanup
prlt docker clean
prlt agent temp cleanup
```

### Monitor Resource Usage

```bash
docker stats
```

### Use Named Containers

Easier to manage and identify:

```bash
prlt agent staff add frontend-dev backend-dev
```

## Related Guides

- [Multi-Agent Workflows](./multi-agent.md) - Running multiple agents
- [Troubleshooting](../troubleshooting.md) - Common issues
- [Agents](../concepts/agents.md) - Agent configuration
