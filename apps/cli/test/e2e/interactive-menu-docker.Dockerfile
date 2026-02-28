# Dockerfile for running interactive CLI menu tests in Docker.
#
# This creates a lightweight container with prlt + tmux for running
# the interactive-menu.test.ts tests in CI environments where tmux
# may not be installed on the host.
#
# Usage:
#   # Build the test image
#   docker build -f test/e2e/interactive-menu-docker.Dockerfile -t prlt-interactive-tests .
#
#   # Run the tests (mount HQ for data)
#   docker run --rm \
#     -v "$PRLT_HQ_PATH/.proletariat:/hq/.proletariat:ro" \
#     -v "$PRLT_HQ_PATH/pmo:/hq/pmo:ro" \
#     prlt-interactive-tests
#
#   # Run with custom prlt version
#   docker build --build-arg PRLT_VERSION=0.3.36 \
#     -f test/e2e/interactive-menu-docker.Dockerfile \
#     -t prlt-interactive-tests .

FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install prlt CLI globally
ARG PRLT_VERSION=latest
RUN npm install -g @proletariat/cli@${PRLT_VERSION}

# Create test user and directories
RUN useradd -m -s /bin/bash testuser \
    && mkdir -p /hq/.proletariat /hq/pmo \
    && chown -R testuser:testuser /hq

USER testuser
WORKDIR /home/testuser

# Create .zshrc to prevent first-run prompts (in case zsh is used)
RUN touch ~/.zshrc

# Set environment
ENV TERM=xterm-256color
ENV PRLT_HQ_PATH=/hq
ENV PRLT_SKIP_NEW_VERSION_CHECK=true
ENV NODE_ENV=production

# Copy the test files (when building from apps/cli/ context)
COPY --chown=testuser:testuser package.json pnpm-lock.yaml* ./
COPY --chown=testuser:testuser test/ ./test/
COPY --chown=testuser:testuser tsconfig.json ./
COPY --chown=testuser:testuser .mocharc.json ./

# Install dev dependencies for running tests
RUN npm install --include=dev 2>/dev/null || true

# Default command: run the interactive menu tests
CMD ["npx", "mocha", "--forbid-only", "--timeout", "120000", "test/e2e/interactive-menu.test.ts"]
