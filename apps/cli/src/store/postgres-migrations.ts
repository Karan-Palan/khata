import type { Migration } from "./migrations.ts";

export const postgresMigrations: readonly Migration[] = [
	{
		version: 3,
		sql: `
			create table documents (
				id text primary key,
				upi_app text not null,
				layout text not null,
				period_start text collate "C" not null,
				period_end text collate "C" not null,
				content_kind text not null,
				content text not null,
				source text not null,
				ingested_at text collate "C" not null
			);

			create table transactions (
				id text primary key,
				document_id text not null references documents (id),
				upi_app text not null,
				occurred_at text collate "C" not null,
				direction text not null check (direction in ('sent', 'received')),
				amount_paise bigint not null check (amount_paise > 0),
				counterparty_name text,
				counterparty_upi_id text,
				upi_reference text,
				app_transaction_id text,
				funding_account text,
				note text,
				parser_version text not null
			);

			create unique index transactions_upi_reference on transactions (upi_reference) where upi_reference is not null;
			create unique index transactions_app_transaction_id on transactions (upi_app, app_transaction_id)
				where app_transaction_id is not null;
			create index transactions_occurred_at on transactions (occurred_at);
			create index transactions_counterparty_name on transactions (counterparty_name);
			create index transactions_document_id on transactions (document_id);

			create table sync_items (
				source_key text not null,
				item_key text not null,
				outcome text not null,
				seen_at text not null,
				primary key (source_key, item_key)
			);
		`,
	},
];
