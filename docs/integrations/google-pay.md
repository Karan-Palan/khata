# Google Pay

Facts about Google Pay statements that the parser and its fixtures cannot hold. The fixtures in `packages/parsers/test/fixtures/google-pay` are the specification of what khata reads.

## Getting the statement

In the Google Pay app: See transaction history, then More, then Get statement. Pick the period and save or share the PDF.

## Observed layout

Observed in October 2026 on a six-month statement produced by the app's `dart_pdf` generator.

- Page 1 carries the statement period and the declared Sent and Received totals. Every page repeats the account holder's phone number and email.
- Each transaction is three lines: the date with `Paid to <name>` or `Received from <name>` and the amount; the time with `UPI Transaction ID: <12 digits>`; and `Paid by <bank> <last 4>` for money sent or `Paid to <bank> <last 4>` for money received.
- The statement never shows the counterparty's UPI ID.
- Self transfers are excluded from the declared totals. None appeared in the observed statement, so their line format is unknown; the parser rejects any line it does not recognize rather than guessing.

## Behaviour verified against a bank statement

- The `UPI Transaction ID` is the same 12-digit UPI reference the bank prints. Every transaction in the observed statement was found in the matching bank statement.
- All but one agreed on direction and amount. The exception was a payment Google Pay listed as paid that the bank reversed through UDIR (the UPI dispute and refund flow), crediting the same amount back under the same UPI reference. A Google Pay statement can therefore list a payment that never settled.
- The same counterparty can appear with different capitalization, for example one merchant written three different ways. khata groups counterparties case-insensitively and labels each group with its most recent spelling.

## Not yet known

- The longest period a single statement can cover.
- Whether statements are ever password-protected.
- The line format for self transfers, failed payments, and UPI Lite.
