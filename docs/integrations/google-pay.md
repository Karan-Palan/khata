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

## Google Takeout activity export

Takeout reaches much further back than the in-app statement, so khata reads it for the periods no statement covers.

### Getting the export

At takeout.google.com: Deselect all, select Google Pay, and select My Activity with only Google Pay in its content options and JSON as its format. Export once as a zip. Takeout to Drive, every month or every two months for a year, is the zero-touch alternative. Some browsers unzip the download into a `Takeout` folder; khata reads the folder, the zip, or `MyActivity.json` directly.

Delivered to Drive, observed in October 2026:

- Creating the schedule asked the user to confirm their identity with a passkey. The first export started at once and reached Drive in about three minutes; the rest follow on the same day every two months, and the schedule ends after a year.
- Each export lands in a `Takeout` folder as two zips: `takeout-<time>-001.zip` holds only `archive_browser.html`, and `takeout-<time>-1-001.zip` holds the Google Pay folder and `My Activity/Google Pay/MyActivity.json`.
- Drive labels both zips `application/x-zip`, not `application/zip`.

### Observed contents

Observed in October 2026 on an export covering almost three years.

- `My Activity/Google Pay/MyActivity.json` holds one entry per Google Pay action: `title`, `time` in UTC, `products`, and `details` with Google's identifier for the payment and, usually, its status.
- Titles take seven shapes: `Paid ₹<amount> to <name>`, `Paid ₹<amount>`, `Sent ₹<amount>`, `Received ₹<amount> from <name>`, `Received ₹<amount>`, each optionally followed by `using Bank Account XXXXXX<last 4>`. About a quarter of payments carry no counterparty name.
- Amounts use international digit grouping (`₹123,456.78`, and `₹1234.56` without a comma), unlike the statement.
- Statuses are Completed, Failed, Pending, and Cancelled; a few entries have no status. In the observed export, most failed and status-less payments in a period with a bank statement did not settle, so khata counts only completed payments.
- There is no UPI reference, so activity payments cannot be matched to bank rows or statement rows by identity.
- `Google Pay/My Activity/My Activity.html` repeats the activity as HTML. khata reads only the JSON and asks for a JSON re-export when that is all it finds.
- `Money sends and requests`, `Google transactions`, `Rewards earned`, and `Group expenses` are not payments khata reads.

### Combining with statements

- Within a statement's period, the statement alone supplies transactions, because its declared totals verify it. Matching activity payments to statement rows by amount and time is unreliable: identical amounts minutes apart get paired with the wrong partner, and some completed activity payments never reached the bank at all.
- Outside every statement period, completed activity payments are added, identified by Google's payment identifier, and the most recent export decides each payment's status.
- Google's payment identifier stayed the same for every payment across two exports taken a day apart, in October 2026, so a newer export replaces an older one's payments rather than adding to them.

### Not yet known

- How far back Takeout goes for accounts older than the one observed.
