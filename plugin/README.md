# khata plugin

Ask Claude Code or Codex about your UPI payments. The plugin bundles:

- **The khata MCP server**, run with `npx -y khata@0.0.0 mcp`. It reads and writes only the ledger in `~/.khata` on your machine.
- **Skills**: `set-up-khata` brings your Google Pay statements and Takeout exports in and keeps them current; `answer-from-ledger` answers money questions from the ledger with exact totals.

Requires Node.js 18 or later for `npx`. khata runs on macOS and Linux (glibc) on arm64 and x64, and on Windows on x64.

## Install in Claude Code

```bash
claude plugin marketplace add Karan-Palan/khata
claude plugin install khata@khata
```

Or, inside Claude Code: `/plugin marketplace add Karan-Palan/khata`, then `/plugin install khata@khata`.

## Install in Codex

```bash
codex plugin marketplace add Karan-Palan/khata
codex plugin add khata@khata
```

Then ask: "Set up khata with my Google Pay history", or "How much did I spend last month, and on whom?"
