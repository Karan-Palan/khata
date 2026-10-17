# khata

Your UPI payment history as a local ledger that AI agents can query through MCP.

khata reads the statements and activity exports that UPI apps already give you, turns every payment into one clean transaction table on your machine, and lets Claude Code, Codex, or any MCP client answer questions like "how much did I spend in June, and on whom?" from it.

khata never signs in to a payment app, never acts inside a payment-app session, and never asks for a UPI PIN or OTP.

## Status

Early development.

| UPI app | Status |
| --- | --- |
| Google Pay | Statement PDF and Google Takeout supported |
| PhonePe | Planned |
| Paytm | Planned |

## Install

The plugin gives Claude Code or Codex the khata MCP server plus skills for setting it up and answering from it.

```bash
claude plugin marketplace add Karan-Palan/khata
claude plugin install khata@khata
```

```bash
codex plugin marketplace add Karan-Palan/khata
codex plugin add khata@khata
```

Then ask your agent to "set up khata with my Google Pay history".

For any other MCP client, run the server as `npx -y khata mcp`. The command line is the same program: `npx -y khata <command>`, or `npm install -g khata` for a `khata` command. khata needs Node.js 18 or later to install, and runs on macOS and Linux (glibc) on arm64 and x64, and on Windows on x64.

## Add your history

Two Google Pay sources, best used together:

- **Statement PDF** for a verified period: in the Google Pay app, See transaction history, then More, then Get statement. A statement whose totals do not add up is rejected whole.
- **Google Takeout** for years of history: at takeout.google.com, Deselect all, select Google Pay and My Activity (only Google Pay, JSON format), and export. Ingest the zip, the unzipped `Takeout` folder, or `MyActivity.json`. Only completed payments count.

```bash
khata ingest ~/Downloads/gpay_statement.pdf ~/Downloads/Takeout
khata status
```

Within a statement's period only the statement counts; Takeout fills every other day. Ingesting the same file twice changes nothing, and the result is the same whatever order files arrive in. After upgrading khata, `khata reparse` rebuilds every transaction with the newest parsers.

## Keep it current

```bash
khata sources add-folder ~/Downloads          # pick up statements and Takeout exports you download
khata auth google --client-file client.json   # read-only Gmail attachments and Takeout zips in Drive
khata sync                                    # collect anything new from every source
khata schedule enable                         # run sync every 6 hours on this Mac
```

Files that are not statements are checked once and remembered, so later syncs skip them. Choosing Takeout's Add to Drive, every 2 months, makes new history arrive with no clicks. See [docs/integrations/google-sign-in.md](docs/integrations/google-sign-in.md) for creating the Google client. Ledger files are readable only by you.

The ledger lives in `~/.khata/khata.db`. Set `KHATA_HOME` to keep it elsewhere.

## Postgres and hosting

`khata database connect` moves the ledger to Postgres, for example Neon, reading the connection URL from stdin and keeping it in your Keychain. `khata ingest ~/.khata/khata.db` then copies your existing ledger across. `khata serve` runs the read-only MCP tools over HTTP behind a bearer token, ready to deploy on Fly.io with the `Dockerfile` and `fly.toml` here. See [docs/hosting.md](docs/hosting.md).

## MCP tools

| Tool | What it does |
| --- | --- |
| `status` | Where the ledger is, how many statements and transactions it holds, and the dates it covers |
| `search_transactions` | Individual payments filtered by date, direction, counterparty, or amount, 50 per page |
| `summarize_transactions` | Money sent and received grouped by month, counterparty, funding account, or UPI app |
| `run_sql` | One read-only SQL query, up to 200 rows |
| `ingest` | Add statement PDFs and Google Takeout exports |
| `sync` | Collect and ingest anything new from watched folders, Gmail, and Drive |

## Development

Requires [Bun](https://bun.com) 1.3 or later.

```bash
bun install
bun run khata status                   # the CLI from source
bun run check:ci                       # lint, types, comment check, and tests
bun run --cwd apps/cli build:npm       # compile the npm packages into apps/cli/dist/npm
```

See [AGENTS.md](AGENTS.md) for how this repository is built, [CONTEXT.md](CONTEXT.md) for its vocabulary, and [docs/releasing.md](docs/releasing.md) for releases.

## License

[MIT](LICENSE)
