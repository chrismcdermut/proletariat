# Orchestrator Docker Container

This Docker image allows running the prlt orchestrator in a container using the **sibling container pattern**.

## Architecture

The sibling container pattern means the orchestrator container has the Docker socket mounted, allowing it to spawn agent containers as siblings (not nested Docker-in-Docker):

```
Host Docker daemon
├── orchestrator container (has /var/run/docker.sock mounted)
├── agent-1 container (spawned by orchestrator, sibling)
├── agent-2 container (spawned by orchestrator, sibling)
```

## Benefits

- **Isolation**: Orchestrator runs in its own container, isolated from the host
- **Remote access**: Enables remote orchestrator management (e.g., SSH from phone) without macOS keychain issues
- **Consistent environment**: Same container pattern as agents already use
- **OAuth support**: Uses Docker OAuth flow instead of macOS keychain

## Build

From the proletariat project root:

```bash
docker build -t prlt-orchestrator:latest -f docker/orchestrator/Dockerfile .
```

Or use the build script:

```bash
./docker/orchestrator/build.sh
```

## Usage

Start the orchestrator in Docker:

```bash
prlt orchestrator start --docker
```

This will:
1. Check that the `prlt-orchestrator:latest` image exists
2. Start a container with:
   - HQ directory mounted at `/hq`
   - Docker socket mounted at `/var/run/docker.sock`
   - Claude OAuth credentials mounted (if available)
3. Run the orchestrator inside the container
4. The orchestrator can then spawn agent containers as siblings

## Requirements

- Docker installed and running
- prlt-orchestrator:latest image built
- Claude OAuth credentials configured (recommended) OR ANTHROPIC_API_KEY set

## Authentication

The orchestrator container supports two authentication methods:

1. **OAuth credentials (recommended)**: Mounts the `claude-credentials` Docker volume
2. **API key**: Uses `ANTHROPIC_API_KEY` environment variable

To set up OAuth credentials:
```bash
# Run claude once in a container to set up OAuth
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest
```

## Environment Variables

- `PRLT_ORCHESTRATOR_IMAGE`: Override the default image name (default: `prlt-orchestrator:latest`)
- `ANTHROPIC_API_KEY`: API key for Claude (if not using OAuth)
- `ORCHESTRATOR_NAME`: Name for the orchestrator session (set automatically)

## Troubleshooting

### Image not found

If you get "Orchestrator Docker image not found", build it first:
```bash
docker build -t prlt-orchestrator:latest -f docker/orchestrator/Dockerfile .
```

### No Claude credentials

If you get "No Claude credentials found":
1. Set up OAuth (recommended): Run `claude` in a container to authenticate
2. OR set `ANTHROPIC_API_KEY` environment variable

### Permission denied on Docker socket

Ensure your user has permission to access the Docker socket:
```bash
sudo usermod -aG docker $USER
# Then log out and back in
```

## Development

To use a local prlt build instead of the published package:

1. Build the CLI locally:
   ```bash
   cd apps/cli
   pnpm build
   ```

2. Modify the Dockerfile to copy the local build:
   ```dockerfile
   COPY apps/cli/dist /usr/local/lib/node_modules/@proletariat/cli
   COPY apps/cli/package.json /usr/local/lib/node_modules/@proletariat/cli/
   RUN cd /usr/local/lib/node_modules/@proletariat/cli && npm link
   ```

3. Rebuild the image:
   ```bash
   ./docker/orchestrator/build.sh
   ```
