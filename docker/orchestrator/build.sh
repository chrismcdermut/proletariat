#!/bin/bash
#
# Build the prlt orchestrator Docker image
#
# Usage:
#   ./docker/orchestrator/build.sh [--local]
#
# Options:
#   --local    Use local prlt CLI build instead of npm package
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="${PRLT_ORCHESTRATOR_IMAGE:-prlt-orchestrator:latest}"

echo "Building orchestrator Docker image: $IMAGE_NAME"
echo "Project root: $PROJECT_ROOT"
echo ""

# Check if --local flag is provided
USE_LOCAL=false
if [ "$1" = "--local" ]; then
  USE_LOCAL=true
  echo "Using local prlt CLI build"

  # Ensure CLI is built
  if [ ! -d "$PROJECT_ROOT/apps/cli/dist" ]; then
    echo "ERROR: apps/cli/dist not found. Run 'pnpm build' first."
    exit 1
  fi

  # Create a temporary Dockerfile that uses local build
  TEMP_DOCKERFILE="$SCRIPT_DIR/Dockerfile.local"
  cat > "$TEMP_DOCKERFILE" <<'EOF'
FROM node:20-alpine

RUN apk add --no-cache \
    bash \
    git \
    tmux \
    docker-cli \
    curl \
    openssh-client

# Copy local prlt CLI build
COPY apps/cli/dist /usr/local/lib/node_modules/@proletariat/cli/dist
COPY apps/cli/package.json /usr/local/lib/node_modules/@proletariat/cli/
COPY apps/cli/bin /usr/local/lib/node_modules/@proletariat/cli/bin

# Link prlt CLI
RUN cd /usr/local/lib/node_modules/@proletariat/cli && \
    npm link

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /hq /root/.proletariat
WORKDIR /hq

RUN git config --global user.name "Orchestrator" && \
    git config --global user.email "orchestrator@proletariat.dev"

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD prlt --version || exit 1

CMD ["/bin/bash"]
EOF

  docker build -t "$IMAGE_NAME" -f "$TEMP_DOCKERFILE" "$PROJECT_ROOT"
  rm "$TEMP_DOCKERFILE"
else
  docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile" "$PROJECT_ROOT"
fi

echo ""
echo "✓ Successfully built $IMAGE_NAME"
echo ""
echo "Test the image:"
echo "  docker run --rm $IMAGE_NAME prlt --version"
echo ""
echo "Run the orchestrator:"
echo "  prlt orchestrator start --docker"
