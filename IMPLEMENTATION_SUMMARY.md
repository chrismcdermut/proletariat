# TKT-1178: Orchestrator Docker Support - Implementation Summary

## Overview

Implemented support for running the prlt orchestrator in a Docker container using the sibling container pattern. This enables better isolation, remote access without macOS keychain issues, and consistent environment across different machines.

## Changes Made

### 1. Command Line Interface

**File**: `apps/cli/src/commands/orchestrator/start.ts`

- Added `--docker` flag to run orchestrator in Docker container
- Added `--run-on-host` flag to explicitly run on host (maintains backward compatibility)
- Added environment selection logic before `runExecution` call
- Updated command examples to show Docker usage
- Default behavior unchanged (runs on host)

### 2. Execution Runners

**File**: `apps/cli/src/lib/execution/runners.ts`

- Modified `runDocker` function to detect orchestrator execution (ticketId === 'prlt' or 'ORCH')
- Created `runOrchestratorDocker` function implementing sibling container pattern:
  - Mounts HQ directory at `/hq`
  - Mounts Docker socket at `/var/run/docker.sock` for spawning sibling containers
  - Mounts Claude credentials volume (`claude-credentials`) or uses API key
  - Supports resource limits (memory, CPUs)
  - Provides helpful error messages for missing image or credentials

### 3. Docker Infrastructure

**Files**:
- `docker/orchestrator/Dockerfile` - Orchestrator container image
- `docker/orchestrator/build.sh` - Build script with `--local` option
- `docker/orchestrator/test.sh` - Validation test suite
- `docker/orchestrator/README.md` - Docker-specific documentation

**Image Contents**:
- Node.js 20 Alpine base
- prlt CLI (from npm or local build)
- Claude Code CLI
- tmux (session management)
- Docker CLI (for spawning sibling containers)
- Git (for commits)

### 4. Documentation

**Files**:
- `docs/orchestrator-docker.md` - Comprehensive guide (381 lines)
  - Architecture and benefits
  - Setup and usage instructions
  - Authentication methods (OAuth and API key)
  - Troubleshooting guide
  - Advanced topics (custom images, debugging, remote access)
  - Comparison table: Host vs Docker

- `docs/orchestrator-docker-migration.md` - Migration guide (203 lines)
  - Migration steps from host to Docker
  - Before/after comparisons
  - Common migration issues and solutions
  - Rollback instructions
  - Best practices and FAQ

## Architecture

### Sibling Container Pattern

```
Host Docker daemon
├── orchestrator container (has /var/run/docker.sock mounted)
├── agent-1 container (spawned by orchestrator, sibling)
├── agent-2 container (spawned by orchestrator, sibling)
└── agent-3 container (spawned by orchestrator, sibling)
```

**Why Sibling Pattern?**
- Avoids Docker-in-Docker (DinD) complexity and performance issues
- Better security and resource management
- Simpler architecture
- Compatible with existing agent container spawning

## Features Implemented

### ✓ Core Requirements (from TKT-1178)
- [x] Add `--docker` / `--run-on-host` flag to `prlt orchestrator start`
- [x] Default stays as host for backward compatibility
- [x] Orchestrator container has HQ directory mounted
- [x] Orchestrator container has Docker socket mounted (`/var/run/docker.sock`)
- [x] prlt CLI installed in container
- [x] OAuth credentials support (Docker volume)
- [x] Agent containers spawned as siblings, not nested
- [x] Fixes SSH/remote access auth issue (TKT-1177 dependency)

### ✓ Additional Features
- [x] API key authentication fallback
- [x] Resource limits configuration
- [x] Build script with local development support
- [x] Comprehensive test suite
- [x] Detailed documentation and migration guide
- [x] Error handling and helpful error messages
- [x] Custom image name support via environment variable

## Usage

### Basic Usage

```bash
# Run orchestrator in Docker
prlt orchestrator start --docker

# Run orchestrator on host (default)
prlt orchestrator start
prlt orchestrator start --run-on-host
```

### Setup

```bash
# 1. Build the image
./docker/orchestrator/build.sh --local

# 2. Set up authentication (choose one)
# Option A: OAuth (recommended)
docker run --rm -it -v claude-credentials:/root/.claude anthropic/claude-code:latest

# Option B: API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Start orchestrator
prlt orchestrator start --docker
```

## Testing

### Validation Tests

Run the test suite:
```bash
cd docker/orchestrator
./test.sh
```

Tests verify:
1. Docker image builds successfully
2. prlt CLI is installed and working
3. tmux is installed
4. Docker CLI is installed
5. Claude Code is installed
6. `--docker` flag is recognized
7. `--run-on-host` flag is recognized

### Manual Testing

```bash
# Build image
./docker/orchestrator/build.sh --local

# Verify tools
docker run --rm prlt-orchestrator:latest prlt --version
docker run --rm prlt-orchestrator:latest claude --version
docker run --rm prlt-orchestrator:latest tmux -V
docker run --rm prlt-orchestrator:latest docker --version

# Test orchestrator start
prlt orchestrator start --docker --background
```

## Benefits

1. **Isolation**: Orchestrator runs in its own container, isolated from host
2. **Remote Access**: Works via SSH without macOS keychain issues (fixes TKT-1177)
3. **Consistent Environment**: Same container pattern as agents
4. **Portability**: Runs on any platform with Docker (Linux, macOS, Windows)
5. **Security**: Container isolation and controlled resource access
6. **Flexibility**: OAuth or API key authentication

## Backward Compatibility

- ✓ Default behavior unchanged (runs on host)
- ✓ Existing orchestrator sessions continue to work
- ✓ No breaking changes to existing workflows
- ✓ Explicit `--run-on-host` flag for clarity

## Files Changed

| File | Lines | Type | Description |
|------|-------|------|-------------|
| `apps/cli/src/commands/orchestrator/start.ts` | +32 | Modified | Add Docker flags and environment selection |
| `apps/cli/src/lib/execution/runners.ts` | +96 | Modified | Add orchestrator Docker runner |
| `docker/orchestrator/Dockerfile` | +61 | New | Orchestrator container image |
| `docker/orchestrator/build.sh` | +82 | New | Build script |
| `docker/orchestrator/test.sh` | +136 | New | Test suite |
| `docker/orchestrator/README.md` | +197 | New | Docker-specific docs |
| `docs/orchestrator-docker.md` | +381 | New | Comprehensive guide |
| `docs/orchestrator-docker-migration.md` | +203 | New | Migration guide |

**Total**: 8 files, ~1,188 lines added

## Commits

1. `d98767c2` - Add Docker support with sibling container pattern
2. `59fcc06a` - Add Docker examples to orchestrator start command
3. `7ec7f94a` - Add comprehensive documentation
4. `10e28aeb` - Add test script
5. `f4d08fe1` - Add migration guide

## Next Steps

### For Reviewers

1. Review architecture and sibling container pattern implementation
2. Verify backward compatibility (default behavior unchanged)
3. Test Docker image build and orchestrator startup
4. Review documentation completeness
5. Check error handling and user experience

### For Users

1. See `docs/orchestrator-docker.md` for full usage guide
2. See `docs/orchestrator-docker-migration.md` for migration steps
3. Run `./docker/orchestrator/test.sh` to validate setup
4. Start with `prlt orchestrator start --docker`

### Future Enhancements

- [ ] Publish orchestrator image to Docker Hub
- [ ] Add health monitoring for orchestrator container
- [ ] Support custom Dockerfile extensions
- [ ] Add orchestrator container logs viewing command
- [ ] Implement orchestrator container restart/recovery

## Dependencies

- Docker installed and running
- prlt CLI built (for local development)
- Claude credentials (OAuth or API key)

## Troubleshooting

See `docs/orchestrator-docker.md#troubleshooting` for:
- Image not found errors
- Credential configuration issues
- Docker socket permission problems
- Container startup failures

## References

- Original ticket: TKT-1178
- Related issue: TKT-1177 (SSH auth keychain issue)
- Docker sibling pattern: See `docs/orchestrator-docker.md#architecture`
- Migration guide: `docs/orchestrator-docker-migration.md`
