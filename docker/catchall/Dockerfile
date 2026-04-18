# Catch-all devcontainer image for ad-hoc prlt claude / prlt qa sessions.
#
# Used when the target directory has no .devcontainer/ of its own.
# Rebuilt automatically on every npm publish via build-devcontainer.yml.
#
# Image: ghcr.io/chrismcdermut/proletariat-claude:latest

FROM node:22

USER root

ARG TZ=America/Los_Angeles
ENV TZ=${TZ}

# Install system dependencies
RUN apt-get update && apt-get install -y \
    less git git-lfs procps sudo fzf zsh man-db unzip gnupg2 gh tmux \
    jq nano vim \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install

# Create workspace and home directories
RUN mkdir -p /workspace /home/node/.claude \
    && chown -R node:node /workspace /home/node/.claude

# Set up persistent bash history
RUN mkdir -p /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R node:node /commandhistory

# Install git-delta for better diffs (architecture-aware)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -L "https://github.com/dandavison/delta/releases/download/0.18.2/git-delta_0.18.2_${ARCH}.deb" -o /tmp/delta.deb && \
    dpkg -i /tmp/delta.deb && \
    rm /tmp/delta.deb

# Configure npm global directory
RUN mkdir -p /home/node/.npm-global/bin /home/node/.npm-global/lib \
    && chown -R node:node /home/node/.npm-global
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:$PATH

# Install pnpm, Claude Code, and prlt CLI via npm (not Homebrew)
USER node
RUN npm install -g pnpm \
    && npm install -g @anthropic-ai/claude-code \
    && npm install -g @proletariat/cli@latest
USER root

# Set default editor
ENV EDITOR=nano

# Configure shell history
ENV HISTFILE=/commandhistory/.bash_history

USER node
WORKDIR /workspace
