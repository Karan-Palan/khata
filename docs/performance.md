# Performance baseline

Measured on 14 October 2026 on an Apple Silicon Mac with Bun 1.3.14. Non-authoritative: rerun the measurements before relying on them.

| Measurement | Result |
| --- | --- |
| Ingest a real 89-page Google Pay statement (886 transactions), end to end | 0.33 s wall time, of which 225 ms is PDF text extraction and 3 ms is parsing |
| `khata status` | 0.08 to 0.10 s wall time |
| MCP server cold start until tools are listed | 100 to 118 ms |
| MCP calls on an 886-transaction ledger, p95 of 20 | under 5 ms for every tool |
| `search_transactions` on a 100,118-transaction ledger, p95 of 20 | 9 ms by date range, 22 ms by counterparty |
| `summarize_transactions` on a 100,118-transaction ledger, p95 of 20 | 154 ms |

The stored text layer for the 89-page statement is 308 KB.
