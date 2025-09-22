# =====================
# 1. Build Stage
# =====================
FROM node:24-slim AS build

WORKDIR /usr/src/app

# Install build dependencies 
RUN apt-get update \
  && apt-get install -y libcurl4 \
  && rm -rf /var/lib/apt/lists/*

# Copy package files and TypeScript config
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev)
RUN npm install

# Copy source code
COPY . .

# Build the app
RUN npm run build

# =====================
# 2. Production Stage
# =====================
FROM node:24-slim

WORKDIR /usr/src/app

# Only install production dependencies
COPY package*.json ./
RUN npm install 

# Install PM2 globally for process management
RUN npm install -g pm2

# Copy built files from build stage
COPY --from=build /usr/src/app/dist ./dist

EXPOSE 3000

# Start the app with PM2
CMD ["pm2-runtime", "dist/src/server.js"]