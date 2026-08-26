# Delta Exchange MCP

This folder is reserved for a user-owned Delta Exchange MCP setup.

## Current plan

Use the official `delta-exchange/delta-exchange-mcp` package as the base MCP server. The official server currently runs as a local stdio MCP server and is intended to be launched by an MCP client such as Claude Desktop, Cursor, VS Code, Claude Code, Codex, or another compatible client.

### Important

- Do not commit Delta API keys or secrets to GitHub.
- Start with read-only access.
- Use the Delta testnet before enabling live trading.
- Live trading requires explicit opt-in and a Delta API key with trading permission.
