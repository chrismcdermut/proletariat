# Orchestrator Docker Image
#
# This image is designed for running the prlt orchestrator in a Docker container
# using the sibling container pattern. The orchestrator has the Docker socket
# mounted so it can spawn agent containers as siblings.
#
# Architecture:
# Host Docker daemon
# ├── orchestrator container (has /var/run/docker.sock mounted)
# ├── agent-1 container (spawned by orchestrator, sibling)
# ├── agent-2 container (spawned by orchestrator, sibling)
#
# Build:
#   docker build -t prlt-orchestrator:latest -f docker/orchestrator/Dockerfile .
#
# Usage:
#   prlt orchestrator start --docker

FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    bash \
    git \
    tmux \
    docker-cli \
    curl \
    openssh-client

# Install prlt CLI globally
# This will be replaced with proper package installation once published
# For now, you can either:
# 1. Install from npm: RUN npm install -g @proletariat/cli
# 2. Copy local build: COPY apps/cli/dist /usr/local/lib/node_modules/@proletariat/cli
RUN npm install -g @proletariat/cli@latest || \
    echo "WARNING: @proletariat/cli not published yet. Build locally and mount volume."

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Create workspace directory
RUN mkdir -p /hq /root/.proletariat

# Set working directory
WORKDIR /hq

# Set up git config (required for commits)
RUN git config --global user.name "Orchestrator" && \
    git config --global user.email "orchestrator@proletariat.dev"

# Health check - verify prlt CLI is available
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD prlt --version || exit 1

# Default command (overridden by docker run)
CMD ["/bin/bash"]
