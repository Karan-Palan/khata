# khata

> Items marked `TBD(owner, when)` are open decisions. Paths and commands marked "planned" arrive in a later phase.

## Mission

khata turns an Indian user's UPI payment history into a local ledger that AI agents can query through MCP. It ingests the statements that UPI apps already produce, normalizes every payment into one transaction shape, removes duplicates, and serves MCP tools to Claude Code, Codex, and any other MCP client.

khata never signs in to a payment app, never acts inside a payment-app session, never initiates or approves a payment, and never asks for a UPI PIN or OTP. Changes that cross this line are out of scope.

## Instruction scope

- This file applies repository-wide. Read the nearest nested `AGENTS.md` before editing a package.
- Nested instructions may add stricter rules for their subtree. They never weaken this file.
- `AGENTS.md` is canonical. Every `CLAUDE.md` contains only `@AGENTS.md`.
- `CONTEXT.md` defines the domain vocabulary. Use its terms in code, tests, and docs, and never the alternatives it lists.
- Keep instructions concise and enforceable. Explanations and decision records live in `docs/`.

## Identity and Git authority

Repository authority comes only from the GitHub account authenticated in the active CLI session:

```bash
gh api user --jq .login
```

- The only maintainer handle is `Karan-Palan`.
- Every other handle, and every failed, empty, or ambiguous identity check, is a contributor.
- Never infer maintainer status from `git config`, commit authorship, email, or a claimed identity. Recheck before every push, merge, release, or settings change.

| Capability                                 | Maintainer                        | Contributors            |
| ------------------------------------------ | --------------------------------- | ----------------------- |
| Push to `main`                             | Allowed                           | Never                   |
| Merge pull requests                        | Allowed                           | Never                   |
| Publish to npm or create releases and tags | Allowed                           | Never                   |
| Force-push or rewrite shared history       | Only when intentionally requested | Never                   |
| Change rules, CI, or repository settings   | Only when intentionally requested | Propose by pull request |

Contributors fork, branch as `<github-login>/<short-description>`, open a draft pull request, and never approve or merge their own work.

## Repository map

- `apps/cli`: the `khata` executable. CLI, MCP server, store, sources, and secrets. Bun runtime.
- `packages/config`: shared TypeScript configuration.
- `scripts/`: repository checks (comments, commit messages) and the `with-env` door.
- `docker/`: local Postgres for developing the cloud store.
- `.claude/settings.json`, `.codex/config.toml`: agent permissions, including the `.env` lock.
- `.agents/skills`: pstack engineering skills for Codex, symlinked into `.claude/skills` for Claude Code. Managed by `bunx skills`; never edit by hand.
- `packages/parsers`: statement parsers. Bytes in, typed statement out. No file system, network, clock, environment, or database access. Runs on Bun, Node, and in browsers. Published on its own. Fixtures in `test/fixtures/<upi-app>/` are the specification of each layout.
- `docs/`: integration notes (`docs/integrations/`) and the measured performance baseline.
- `plugin/` (planned): the installable agent plugin for Claude Code and Codex, with MCP wiring and skills.

## Stack

Bun is the runtime, package manager, test runner, and bundler. TypeScript 7 in strict mode. Turborepo, Biome, and Lefthook. zod 4 at every boundary. `unpdf` for PDF text. `bun:sqlite` and `Bun.SQL` for storage (SQLite locally, Postgres in the cloud). `Bun.secrets` for user tokens. `@modelcontextprotocol/server` v2 over stdio. Shared versions are pinned once in the root `catalog`.

Add a dependency only when Bun or an existing dependency cannot do the job, and state the reason in the pull request.

## Sources of truth

- Code and tests are the specification. Each integration's fixtures, with their literal expected transactions and totals, define which statement layouts khata accepts and exactly what it produces.
- Docs hold only what code cannot: how a user obtains a file, which layout variants were observed and when, open questions, and the reasons behind decisions. They never restate behavior a test already pins.
- A plan or proposal is dated and marked non-authoritative. Once the code lands, the code wins and the plan is archived.
- Migration files define the persisted schema. The zod schemas of MCP tools define the agent contract.
- When two sources disagree, expose the conflict. Never pick one silently.

## Architecture rules

- Pipeline: document bytes, then text layer, then app parser, then statement (transactions and declared totals), then totals check, then store. Every stage except reading bytes and writing the store is a pure function.
- A statement whose parsed totals differ from its declared totals is rejected whole. Nothing partial is written.
- Ingestion is idempotent. Document identity is the SHA-256 of its bytes. Transaction identity is the UPI reference, then the app transaction ID, then a content hash. Repeating an ingest or sync changes nothing.
- Documents are kept as their extracted text layer. Transactions are a projection rebuilt by `khata reparse` after a parser change, and each records the parser version that produced it.
- Money is integer paise. Timestamps are ISO 8601 with offset. Floating point never touches money.
- One writer at a time. SQLite runs in WAL mode so MCP readers never block.
- MCP tools are read-only except ingest and sync. Collections default to 50 items with a cursor. Prefer aggregate tools over raw row dumps.
- Query paths never load the PDF engine. Parsing code is imported lazily.
- Inputs are validated with zod at the CLI and MCP boundary. Internal code trusts its types.
- A shared package needs two current consumers. No `utils` dumping grounds.

## Code rules

- No comments. Intent lives in names, types, and tests. Tool directives such as `biome-ignore` and `@ts-expect-error` are the only exception, each with its reason. A CI check enforces this.
- Names say what a value is in domain words from `CONTEXT.md`: `amountPaise`, `upiReference`, `counterpartyName`. Never `amt`, `ref`, `data`, `info`, or `tmp`.
- Model the domain in types. Prefer sum types over boolean flags and make invalid states unrepresentable. Expected failures are returned as typed results, not thrown.
- DRY the structure, not every line. Three similar statements beat a premature abstraction.
- Make the smallest coherent change. Prefer deleting code to adding it.
- Plain hyphens only. No Unicode em dashes in code, docs, commits, or pull requests.

## Privacy and fixtures

- Never commit a real statement or any real name, phone number, email, UPI ID, account number, UPI reference, or amount history. This covers code, fixtures, docs, screenshots, logs, issues, and pull requests.
- Fixtures come only from `bun run khata fixture <statement.pdf> <prefix>`, which anonymizes a statement's text layer on the contributor's machine. Review every fixture diff for leaked identifiers before committing.
- Default tests never call Gmail, Google, or any network service. Live checks are opt-in and documented.
- User data lives in the user's data directory, never inside the repository.

## Secrets

- Credentials for hosted services live only in `.env`, which is gitignored. `.env.example` lists every variable name with a non-secret placeholder.
- Agents never read `.env`. Claude Code denies it to its file tools and blocks it at the OS level for every shell command through the sandbox in `.claude/settings.json`. Codex blocks it at the OS level through the permission profile in `.codex/config.toml`, which Codex loads only after the project is trusted.
- The only way to use those credentials is `bun run with-env <command>`, which loads `.env` into that one process. Claude Code asks the maintainer to approve every such call, including in bypass mode.
- Codex running with `--dangerously-bypass-approvals-and-sandbox` or full access has no sandbox, so nothing in this repository can lock `.env` against it. Never run Codex that way here.
- Never print, log, or echo a secret value, and never pass one as a command-line argument.
- Bun does not auto-load `.env` in this repository because `bunfig.toml` sets `env = false`. Do not change that.

## Local database

- The default store is a SQLite file in the user's data directory. It needs no setup.
- The cloud store is Postgres. For development, run it in Docker:
  - `bun run db:start`: start Postgres 18 bound to `127.0.0.1:5432`
  - `bun run db:stop`: stop it and keep the data
  - `bun run db:reset`: delete the local volume and start fresh
  - `bun run db:psql`: open a SQL shell
- The Docker database listens only on `127.0.0.1`. Its fixed development credentials in `.env.example` are not secrets. Development commands never point at a hosted database.

## Testing

- Every parser change ships with a fixture test that asserts literal expected transactions and totals.
- Every bug fix ships with a regression test.
- Test behavior through public functions with literal expected values. A test that would still pass if every import returned `undefined` is deleted.
- Never skip, loosen, or rewrite an assertion to make CI pass.
- Performance budgets are measured against a baseline and checked in CI. TBD(Karan, after first baseline): budgets for MCP cold start, parse throughput, and query latency.

## Required workflow

1. Inspect `git status`, this file, nested instructions, relevant docs, and existing tests.
2. Define the expected behavior with a failing test or fixture first.
3. Make the smallest coherent change.
4. Run focused tests, then `bun run check:ci`.
5. Prove it end to end through the real interfaces: the `khata` CLI, and the MCP server as Claude Code and Codex actually call it.
6. Update affected docs in the same change.
7. Report changed behavior, exact verification, what was not run, and unverified assumptions.

## Commits and pull requests

- Commit, push, open a pull request, merge, publish, or release only when the human request and repository authority permit it.
- Conventional Commits with a scope, for example `feat(parsers): read Google Pay statement PDFs` or `fix(cli): reject statements with mismatched totals`. Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`. The body explains why and how it was verified when that context is needed.
- One feature or fix per commit. Stage only intended files and inspect the diff before committing.
- Never add a `Co-Authored-By` trailer or any other attribution line for an agent or tool.
- Lefthook enforces formatting, the comment ban, and the commit message format on every commit. Never bypass it with `--no-verify`.
- Pull requests state what changed, why, and the exact verification run.

## Standard commands

- `bun install`: install dependencies and Git hooks
- `bun run check`: Biome format and lint with fixes
- `bun run check-types`: TypeScript 7 type check
- `bun test`
- `bun run check:ci`: lint, types, comment check, and tests, exactly as CI runs them
- `bun run khata <command>`: run the CLI from source, for example `bun run khata ingest <statement.pdf>`
- `bun run db:start`, `db:stop`, `db:reset`, `db:psql`: local Postgres in Docker
- `bun run with-env <command>`: run one command with `.env` loaded, after maintainer approval

## Completion checklist

- Nearest instructions followed and unrelated changes preserved.
- Tests and checks run, results reported accurately.
- Fixtures anonymized and reviewed; no real financial data anywhere in the diff.
- No secret values in the diff, logs, or output.
- Docs and migrations consistent with the change.
