#!/bin/sh
# Install dependencies once, then run the phone connector. npm output goes to stderr so stdio stays clean for MCP.
cd "$(dirname "$0")" || exit 1
[ -d node_modules/@modelcontextprotocol/sdk ] || npm install --omit=dev --no-audit --no-fund --silent 1>&2 || exit 1
exec node server.mjs
