# aboard

A lightweight coordination system for local coding-agent sessions. One
coordinator session observes and coordinates any number of worker sessions,
organized into ephemeral, human-readable topics.

See [`spec.md`](./spec.md) for the full technical specification this
implementation follows.

## Install & run

```bash
npx aboard-server   # starts the local HTTP + SSE message bus (localhost only)
npx aboard-mcp      # starts the MCP adapter a coding agent talks to
```

Both are also available as regular npm dependencies/binaries once installed:

```bash
npm install -g aboard
aboard-server
aboard-mcp
```

`aboard-server` runs on `127.0.0.1:4870` by default (override with
`--port=<n>` or `ABOARD_PORT`) and writes a small runtime discovery file
(under `$TMPDIR/aboard/discovery.json`, override with
`ABOARD_DISCOVERY_FILE`) so `aboard-mcp` and other tooling can find it
automatically. The file only ever contains the current server URL, pid, and
start time — it is not persisted application state and is removed on clean
shutdown.

`aboard-mcp` resolves the server it talks to in this order: an explicit
`--server-url=` flag, the `ABOARD_SERVER_URL` environment variable, the
discovery file, then finally the default local port. It exposes the
`coordination_*` MCP tool set described in the spec and contains no
coordination logic of its own — it only translates tool calls into HTTP
requests against `aboard-server`.

## Claude Code skills

This package ships as a Claude Code plugin (`.claude-plugin/plugin.json`)
bundling three skills and the `aboard-mcp` server:

- `/manage` — start or attach the current session as coordinator.
- `/onboard [topic]` — register the current session as a worker.
- `/offboard [message]` — remove this session's worker registration.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (unit + integration)
npm run build       # compile to dist/
```

Tests live under `test/unit` (pure in-memory server state/logic) and
`test/integration` (a real HTTP+SSE server over the network, and the full
MCP tool set exercised through an in-memory MCP client/server pair).

## Design principles

Simple over comprehensive. Ephemeral over persistent. Local-first over
distributed. Messages over workflows. Topics over repositories. The
coordinator interprets message semantics; the server only routes messages;
the MCP adapter only translates transport. Workers remain fully usable even
if the coordinator disappears, and a user can always interact directly with
any worker.
