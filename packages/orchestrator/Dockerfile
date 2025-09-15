FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY packages/orchestrator/package*.json ./
RUN npm install

# Copy source code
COPY packages/orchestrator/src ./src
COPY packages/orchestrator/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Create PMO directory
RUN mkdir -p /app/pmo

EXPOSE 3000

CMD ["npm", "start"]