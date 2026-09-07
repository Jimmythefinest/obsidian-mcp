# Containerizes the existing shell-mcp service.
# Build context is this directory.
#
# Build:  docker build -t shell-mcp:latest -f Dockerfile .
# (run from /home/admin/obsidian-mcp/shell-mcp)

FROM node:20-slim

# mcp-proxy bridges the app's stdio MCP transport to HTTP/SSE, same as
# the bare-metal setup on port 9001 today.
RUN npm install -g mcp-proxy@6.6.0

WORKDIR /app

# Install deps from package.json inside the image rather than copying the
# host's node_modules/ -- node_modules is gitignored (so a fresh clone
# never has it) and copying it isn't portable across architectures anyway.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY build/ ./build/

EXPOSE 9001
CMD ["mcp-proxy", "--port", "9001", "--", "node", "build/index.js"]
