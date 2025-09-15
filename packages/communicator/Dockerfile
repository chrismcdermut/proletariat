FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY packages/communicator/package*.json ./
RUN npm install

# Copy source code
COPY packages/communicator/src ./src
COPY packages/communicator/tsconfig.json ./

# Build TypeScript
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]