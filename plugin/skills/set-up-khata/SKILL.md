---
name: set-up-khata
description: Set up khata, the user's local UPI payment ledger, or bring it up to date. Use when the user wants to add Google Pay statements or Google Takeout exports, connect Gmail or Drive so new files arrive on their own, schedule sync, or asks why khata is empty or missing recent payments.
---

# Set up khata

khata keeps the user's UPI payments in a ledger on their own machine, in `~/.khata`, and serves it through the `khata` MCP server that comes with this plugin. Its command line is the same program; run it as `npx -y khata@0.1.0 <command>`.

khata never signs in to a payment app, never acts inside one, and never asks for a UPI PIN or OTP. Neither do you. The user gets every file themselves, and signs in to Google themselves.

## 1. See what the ledger holds

Call the `status` tool. It reports how many statements and transactions the ledger holds and the dates they cover. If that already covers what the user needs, say so and stop.

## 2. Get Google Pay history

Two sources, best used together:

- **Statement PDF**, a verified period. In the Google Pay app: See transaction history, then More, then Get statement. Ask for the longest period offered.
- **Google Takeout**, years of history. At takeout.google.com: Deselect all, select Google Pay, then select My Activity and, in its options, keep only Google Pay with JSON as the format. For new history to arrive on its own, choose Add to Drive and Export every 2 months for 1 year; otherwise export once and download the zip.

Within a statement's period only the statement counts, because its totals are checked. Takeout fills every other day, with completed payments only.

## 3. Ingest the files

Call the `ingest` tool with absolute paths: the statement PDF, the Takeout zip, an unzipped `Takeout` folder, or `MyActivity.json`. Ingesting the same file twice changes nothing.

Report each result in plain words. A rejected file names its reason: a statement whose totals do not add up is rejected whole, and a Takeout export holding only HTML needs to be exported again with My Activity in JSON.

## 4. Keep it current

Offer these; each is optional.

- **A watched folder**, such as Downloads: `npx -y khata@0.1.0 sources add-folder ~/Downloads`.
- **Gmail and Drive**, read-only: the user needs their own Google OAuth client; [docs/integrations/google-sign-in.md](https://github.com/Karan-Palan/khata/blob/main/docs/integrations/google-sign-in.md) walks through creating one. Then the user runs `npx -y khata@0.1.0 auth google --client-file <path to the client file>` in their own terminal. It opens Google's consent page in their browser. Never type their password or a verification code for them.
- **Sync now**: call the `sync` tool and report what each source collected.
- **On a schedule, macOS only**: `npx -y khata@0.1.0 schedule enable` runs sync every 6 hours from a copy of khata in `~/.khata/bin`.

While the user's Google OAuth app is in Testing, Google ends the sign-in every 7 days, and sync reports a sign-in failure until the user runs `auth google` again.
