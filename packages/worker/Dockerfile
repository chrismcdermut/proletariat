FROM node:18-alpine

# Install git for worktree management
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY packages/worker/package*.json ./
RUN npm install

# Copy source code
COPY packages/worker/src ./src
COPY packages/worker/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Create workspace directory
RUN mkdir -p /workspace

WORKDIR /workspace

CMD ["node", "/app/dist/index.js"]