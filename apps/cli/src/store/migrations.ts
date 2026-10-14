export type Migration = {
	readonly version: number;
	readonly sql: string;
};

export const migrations: readonly Migration[] = [
	{
		version: 1,
		sql: `
			create table documents (
				id text primary key,
				upi_app text not null,
				layout text not null,
				period_start text not null,
				period_end text not null,
				text_layer text not null,
				source text not null,
				ingested_at text not null
			) strict;

			create table transactions (
				id text primary key,
				document_id text not null references documents (id),
				upi_app text not null,
				occurred_at text not null,
				direction text not null check (direction in ('sent', 'received')),
				amount_paise integer not null check (amount_paise > 0),
				counterparty_name text not null,
				counterparty_upi_id text,
				upi_reference text,
				app_transaction_id text,
				funding_account text,
				note text,
				parser_version text not null
			) strict;

			create unique index transactions_upi_reference on transactions (upi_reference) where upi_reference is not null;
			create index transactions_occurred_at on transactions (occurred_at);
			create index transactions_counterparty_name on transactions (counterparty_name);
			create index transactions_document_id on transactions (document_id);
		`,
	},
];
