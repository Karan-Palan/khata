# khata

> Draft. The domain vocabulary for code, tests, docs, and agent conversations.

## Language

**UPI App**:
A payment app that produces statements khata can read, such as Google Pay, PhonePe, or Paytm.
_Avoid_: Provider, merchant, wallet

**Statement**:
One export a user obtains from a UPI App, covering a period, with its transactions and its declared totals.
_Avoid_: Report, file, export

**Document**:
The bytes of one Statement as received, identified by their SHA-256.
_Avoid_: Upload, attachment, blob

**Text Layer**:
The positioned words extracted from a Document. The input to every parser.
_Avoid_: Raw text, OCR output

**Parser**:
A pure function from a Text Layer to a Statement for one UPI App and layout.
_Avoid_: Extractor, scraper, reader

**Declared Totals**:
The sent and received totals a Statement prints about itself, used to verify a parse.
_Avoid_: Summary, header numbers

**Transaction**:
One money movement, sent or received, with its amount in paise, time, counterparty, and references.
_Avoid_: Payment record, entry, row, txn

**UPI Reference**:
The 12-digit number NPCI assigns to a UPI transaction. The primary identity of a Transaction.
_Avoid_: UTR, RRN, ref, transaction number

**App Transaction ID**:
The UPI App's own identifier for a Transaction, distinct from the UPI Reference.
_Avoid_: Order ID, txn id

**Counterparty**:
The person or business on the other side of a Transaction.
_Avoid_: Payee, merchant, recipient, sender

**Funding Account**:
The user's bank account or card that a Transaction debited or credited.
_Avoid_: Source account, payment method

**Source**:
A place khata collects Documents from, such as a folder or a Gmail inbox.
_Avoid_: Integration, connector, provider

**Ingest**:
Turning one Document into stored Transactions. Idempotent.
_Avoid_: Import, upload, load

**Sync**:
Collecting new Documents from every configured Source and ingesting them. Idempotent.
_Avoid_: Refresh, pull, fetch

**Reparse**:
Rebuilding Transactions from stored Text Layers after a Parser changes.
_Avoid_: Migrate, reprocess

**Fixture**:
An anonymized Text Layer with its literal expected Statement, used as a test and as the specification of a layout.
_Avoid_: Sample, mock, test data
