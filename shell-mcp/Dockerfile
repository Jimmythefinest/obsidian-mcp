# Containerizes the existing shell-mcp service, unmodified.
# Build context is this directory (build/ and node_modules/ already exist
# here from the current bare-metal deployment -- this Dockerfile just
# packages them, it doesn't touch the running screen-session process).
#
# Build:  docker build -t shell-mcp:latest -f Dockerfile .
# (run from /home/admin/obsidian-mcp/shell-mcp)

FROM node:20-slim

# mcp-proxy bridges the app's stdio MCP transport to HTTP/SSE, same as
# the bare-metal setup on port 9001 today.
RUN npm install -g mcp-proxy@6.6.0

WORKDIR /app
COPY build/ ./build/
COPY node_modules/ ./node_modules/

EXPOSE 9001
CMD ["mcp-proxy", "--port", "9001", "--", "node", "build/index.js"]
