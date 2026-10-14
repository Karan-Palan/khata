# khata

Your UPI payment history as a local ledger that AI agents can query through MCP.

khata reads the statements that UPI apps already give you, turns every payment into one clean transaction table on your machine, and lets Claude Code, Codex, or any MCP client answer questions like "how much did I spend on food last month?" from it.

khata never signs in to a payment app, never acts inside a payment-app session, and never asks for a UPI PIN or OTP.

## Status

Early development. The ledger, CLI, and MCP server run end to end; statement parsers arrive next, starting with Google Pay.

| UPI app | Status |
| --- | --- |
| Google Pay | In progress |
| PhonePe | Planned |
| Paytm | Planned |

## Try it

Requires [Bun](https://bun.com) 1.3 or later.

```bash
bun install
bun run khata status
```

Connect it to Claude Code:

```bash
claude mcp add khata -- bun /absolute/path/to/khata/apps/cli/src/main.ts mcp
```

Connect it to Codex:

```bash
codex mcp add khata -- bun /absolute/path/to/khata/apps/cli/src/main.ts mcp
```

The ledger lives in `~/.khata/khata.db`. Set `KHATA_HOME` to keep it elsewhere.

## Development

```bash
bun run check:ci
```

See [AGENTS.md](AGENTS.md) for how this repository is built and [CONTEXT.md](CONTEXT.md) for its vocabulary.

## License

[MIT](LICENSE)
