# khata

Your UPI payment history as a local ledger that AI agents can query through MCP.

khata reads the statements that UPI apps already give you, turns every payment into one clean transaction table on your machine, and lets Claude Code, Codex, or any MCP client answer questions like "how much did I spend in June, and on whom?" from it.

khata never signs in to a payment app, never acts inside a payment-app session, and never asks for a UPI PIN or OTP.

## Status

Early development.

| UPI app | Status |
| --- | --- |
| Google Pay | Statement PDF supported |
| PhonePe | Planned |
| Paytm | Planned |

## Try it

Requires [Bun](https://bun.com) 1.3 or later.

```bash
bun install
bun run khata ingest ~/Downloads/gpay_statement.pdf
bun run khata status
```

Get the statement in the Google Pay app: See transaction history, then More, then Get statement. Ingesting the same statement twice changes nothing, and a statement whose totals do not add up is rejected whole.

Connect it to Claude Code:

```bash
claude mcp add khata -- bun /absolute/path/to/khata/apps/cli/src/main.ts mcp
```

Connect it to Codex:

```bash
codex mcp add khata -- bun /absolute/path/to/khata/apps/cli/src/main.ts mcp
```

The ledger lives in `~/.khata/khata.db`. Set `KHATA_HOME` to keep it elsewhere.

## MCP tools

| Tool | What it does |
| --- | --- |
| `status` | Where the ledger is, how many statements and transactions it holds, and the dates it covers |
| `search_transactions` | Individual payments filtered by date, direction, counterparty, or amount, 50 per page |
| `summarize_transactions` | Money sent and received grouped by month, counterparty, funding account, or UPI app |
| `run_sql` | One read-only SQL query, up to 200 rows |
| `ingest_statements` | Add statement PDFs or folders of them |

## Development

```bash
bun run check:ci
```

See [AGENTS.md](AGENTS.md) for how this repository is built and [CONTEXT.md](CONTEXT.md) for its vocabulary.

## License

[MIT](LICENSE)
