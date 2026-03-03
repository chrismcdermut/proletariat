# Orchestrator Docker Migration Guide

This guide helps you migrate from running the orchestrator on the host to running it in Docker.

## Why Migrate to Docker?

Running the orchestrator in Docker provides:

1. **Isolation**: Orchestrator runs in its own container, separate from host system
2. **Remote Access**: SSH access works without macOS keychain issues
3. **Consistent Environment**: Same setup across different machines
4. **Better Security**: Container isolation and controlled resource access

## Before You Start

### Current Behavior (Host)

```bash
# Before: Orchestrator runs directly on host
prlt orchestrator start
```

- Uses host tmux session
- Requires macOS keychain for authentication (on macOS)
- Direct access to host filesystem
- No isolation

### New Behavior (Docker)

```bash
# After: Orchestrator runs in Docker container
prlt orchestrator start --docker
```

- Uses container tmux session
- Uses Docker OAuth credentials or API key
- Mounted HQ directory only
- Container isolation

## Migration Steps

### Step 1: Build the Orchestrator Image

```bash
cd /path/to/proletariat
./docker/orchestrator/build.sh --local
```

This creates the `prlt-orchestrator:latest` image.

### Step 2: Set Up Authentication

Choose one:

**Option A: OAuth (Recommended)**
```bash
# Set up OAuth credentials in Docker volume
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest
# Follow the OAuth flow
```

**Option B: API Key**
```bash
# Set API key in environment
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Step 3: Test the Setup

```bash
# Verify image exists
docker images | grep prlt-orchestrator

# Test image has required tools
docker run --rm prlt-orchestrator:latest prlt --version
docker run --rm prlt-orchestrator:latest claude --version
docker run --rm prlt-orchestrator:latest tmux -V
```

### Step 4: Start Orchestrator in Docker

```bash
prlt orchestrator start --docker
```

## Backward Compatibility

The default behavior hasn't changed. To run on host (old behavior):

```bash
# Still works (default)
prlt orchestrator start

# Explicitly run on host
prlt orchestrator start --run-on-host
```

## Differences Between Host and Docker

| Aspect | Host | Docker |
|--------|------|--------|
| **Command** | `prlt orchestrator start` | `prlt orchestrator start --docker` |
| **Authentication** | macOS keychain | Docker volume or API key |
| **Isolation** | None | Container |
| **Filesystem Access** | Full host access | HQ directory only |
| **Docker Socket** | N/A | Mounted for spawning containers |
| **Remote Access** | Keychain issues via SSH | Works via SSH |

## Common Migration Issues

### Issue: Image Not Found

**Error**: `Orchestrator Docker image 'prlt-orchestrator:latest' not found`

**Solution**:
```bash
./docker/orchestrator/build.sh --local
```

### Issue: No Credentials

**Error**: `No Claude credentials found`

**Solution**: Set up OAuth or API key (see Step 2 above)

### Issue: Permission Denied

**Error**: `permission denied while trying to connect to the Docker daemon socket`

**Solution**:
```bash
sudo usermod -aG docker $USER
# Log out and back in
```

## Rolling Back

If you need to roll back to host-only orchestrator:

```bash
# Just use the default behavior (or explicit --run-on-host)
prlt orchestrator start --run-on-host
```

No changes are needed to your HQ or workspace.

## Best Practices

### For Development
- Use host for faster iteration: `prlt orchestrator start --run-on-host`
- Use Docker for testing isolation: `prlt orchestrator start --docker`

### For Production
- Use Docker for better isolation and portability
- Set up OAuth credentials for automatic token refresh
- Use `--background` for long-running orchestrators
- Monitor container resource usage

### For Remote Access
- Always use Docker when accessing via SSH
- Avoids macOS keychain issues
- More portable across different machines

## FAQ

### Can I run both host and Docker orchestrators simultaneously?

Yes, but they should use different names:

```bash
prlt orchestrator start --run-on-host --name host-orch
prlt orchestrator start --docker --name docker-orch
```

### Will my existing orchestrator sessions break?

No, existing host-based orchestrator sessions continue to work. The Docker support is additive.

### Do I need to rebuild the image when prlt CLI updates?

Yes, rebuild the image to get the latest prlt CLI:

```bash
./docker/orchestrator/build.sh --local
```

### Can I use Docker orchestrator on Linux?

Yes! Docker orchestrator works on any platform with Docker (Linux, macOS, Windows).

### What about agent containers?

Agent containers work the same way. The orchestrator spawns them as siblings using the mounted Docker socket.

## Next Steps

- Read [Orchestrator Docker Guide](./orchestrator-docker.md) for full documentation
- Review [Docker Architecture](./docker-architecture.md) for technical details
- Check [Troubleshooting](./orchestrator-docker.md#troubleshooting) for common issues

## Feedback

Found an issue or have a suggestion? Please file an issue on GitHub or update this documentation.
