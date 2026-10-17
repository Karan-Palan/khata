# Hosting khata

A hosted khata lets agents that cannot run khata on your Mac, and the iPhone automation that forwards bank SMS, reach your ledger. It is optional; khata works fully on one machine without it.

## What runs where

- **Neon** holds the ledger in Postgres.
- **Fly.io** runs `khata serve`: MCP over HTTP at `/mcp`, with only the read-only tools (`status`, `search_transactions`, `summarize_transactions`, `run_sql`), behind a bearer token. `/health` is open.
- **Your Mac** runs khata as before, reading and writing the same Neon ledger: `ingest`, `sync`, and the schedule keep it current.

Every credential stays in the macOS Keychain under `app.khata` on your Mac, and in Fly secrets on the server. None is written to a file or passed on a command line.

## One-time setup

1. In Neon, create a project named `khata` in the region nearest you, and copy its connection string.
2. Point khata at it. With the connection string on the clipboard:
   ```bash
   pbpaste | khata database connect
   ```
3. Copy your existing ledger into it. Documents are identified by their bytes, so this is safe to repeat:
   ```bash
   khata ingest ~/.khata/khata.db
   ```
4. Create the server's bearer token: `khata server token`.
5. In Fly.io, from a checkout of this repository, with a new app name of your choice:
   ```bash
   fly auth login
   fly apps create <app>
   khata server secrets | fly secrets import --app <app>
   fly deploy --app <app>
   ```
6. Check it:
   ```bash
   KHATA_SERVER_TOKEN="$(khata server header | jq -r .Authorization | cut -c 8-)" bun apps/cli/release/server-smoke-test.ts https://<app>.fly.dev
   ```

## Connecting agents

- **Claude Code**, with the token read from the Keychain on every connection:
  ```bash
  claude mcp add-json khata-cloud '{"type":"http","url":"https://<app>.fly.dev/mcp","headersHelper":"khata server header"}'
  ```
- **Codex**, which reads the token from an environment variable:
  ```bash
  codex mcp add khata-cloud --url https://<app>.fly.dev/mcp --bearer-token-env-var KHATA_SERVER_TOKEN
  ```

On the Mac itself, the plugin's local server already reads Neon once `khata database connect` has run, so the hosted server matters for other machines and the phone.

## Known limits

- The server accepts only a bearer token. Clients that require OAuth, such as custom connectors in the Claude and ChatGPT apps, cannot connect yet.
- Rotating the token: `khata server token --rotate`, then `khata server secrets | fly secrets import --app <app>`.
- The Fly machine stops when idle and starts on the next request, so the first call after a quiet period takes a second or two longer.
- `fly` and other Go tools cannot verify certificates inside the Claude Code sandbox on macOS, so run the `fly` commands in your own terminal.
