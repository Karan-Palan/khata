---
name: answer-from-ledger
description: Answer questions about the user's UPI payments from their khata ledger, such as how much they spent or received in a period, who they paid most, finding a particular payment, or checking payments for an audit. Use whenever the user asks about their Google Pay or UPI spending, income, or transactions and the khata MCP server is available.
---

# Answer from the khata ledger

The khata MCP server holds the user's UPI transactions. Answer from it, never from memory or estimates.

## Before answering

Call `status` once to learn the dates the ledger covers. If the question reaches outside them, say which part the ledger cannot answer and offer the set-up-khata skill to add history.

## Choose the tool

- `summarize_transactions` for totals and breakdowns by month, counterparty, funding account, or UPI app.
- `search_transactions` for individual payments, filtered by dates, direction, counterparty, or amount. It returns 50 per page; pass `nextCursor` back as `cursor` for more.
- `run_sql` only when neither of those can answer. It is read-only and returns up to 200 rows.

## Read the numbers correctly

- `amountPaise` is exact. Add paise, never formatted rupee strings, and convert to rupees only to show the answer.
- "sent" means money left the user; "received" means it arrived. Times are India Standard Time.
- Within a statement's period, transactions come only from that statement and carry a UPI Reference. Outside every statement period, they come from Google Takeout: completed payments only, with no UPI Reference.
- Some Takeout payments have no counterparty name. Summaries group them as "(no counterparty name)". Never guess a name.

## Report

Give the period the answer covers, the totals with their counts, and how much of it rests on payments without a counterparty name when that matters. When checking against a bank statement, match by UPI Reference where there is one, and present any match by date and amount alone as unconfirmed.
