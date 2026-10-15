import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { freshKhataHome, mainScriptPath, seededKhataHome } from "./run-khata.ts";

const openClients: Client[] = [];

async function connectToKhata(khataHome: string): Promise<Client> {
	const transport = new StdioClientTransport({
		command: "bun",
		args: [mainScriptPath, "mcp"],
		env: { PATH: process.env["PATH"] ?? "", KHATA_HOME: khataHome },
	});
	const client = new Client({ name: "khata-test", version: "0.0.0" });
	await client.connect(transport);
	openClients.push(client);
	return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
	return client.callTool({ name, arguments: args });
}

afterEach(async () => {
	await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe("khata MCP server", () => {
	test("lists its tools and marks only ingestion as writing", async () => {
		const client = await connectToKhata(freshKhataHome());
		const { tools } = await client.listTools();
		expect(tools.map(({ name, annotations }) => [name, annotations?.readOnlyHint])).toEqual([
			["status", true],
			["search_transactions", true],
			["summarize_transactions", true],
			["run_sql", true],
			["ingest", false],
		]);
	});

	test("reports an empty ledger through the status tool", async () => {
		const khataHome = freshKhataHome();
		const client = await connectToKhata(khataHome);
		expect((await call(client, "status", {})).structuredContent).toEqual({
			version: "0.0.0",
			databasePath: join(khataHome, "khata.db"),
			schemaVersion: 2,
			documentCount: 0,
			transactionCount: 0,
			firstOccurredAt: null,
			lastOccurredAt: null,
		});
	});

	test("finds every payment with a counterparty, newest first", async () => {
		const client = await connectToKhata(await seededKhataHome());
		expect((await call(client, "search_transactions", { counterparty: "counterparty 001" })).structuredContent).toEqual(
			{
				transactions: [
					{
						occurredAt: "2018-04-03T19:07:00+05:30",
						direction: "received",
						amount: "₹960",
						amountPaise: 96000,
						counterparty: "Counterparty 001",
						upiReference: "900000000012",
						fundingAccount: "Example Bank 0001",
						upiApp: "google_pay",
					},
					{
						occurredAt: "2018-04-01T09:11:00+05:30",
						direction: "sent",
						amount: "₹89.19",
						amountPaise: 8919,
						counterparty: "Counterparty 001",
						upiReference: "900000000001",
						fundingAccount: "Example Bank 0001",
						upiApp: "google_pay",
					},
				],
				totalMatching: 2,
				nextCursor: null,
			},
		);
	});

	test("pages through results with a cursor", async () => {
		const client = await connectToKhata(await seededKhataHome());
		const first = (await call(client, "search_transactions", { limit: 5 })).structuredContent;
		const second = (await call(client, "search_transactions", { limit: 5, cursor: "5" })).structuredContent;
		expect(first).toMatchObject({ totalMatching: 18, nextCursor: "5" });
		expect(second).toMatchObject({ totalMatching: 18, nextCursor: "10" });
	});

	test("summarizes spending by counterparty with exact totals", async () => {
		const client = await connectToKhata(await seededKhataHome());
		expect(
			(await call(client, "summarize_transactions", { groupBy: "counterparty", limit: 2 })).structuredContent,
		).toEqual({
			groups: [
				{
					group: "Counterparty 011",
					sent: "₹2,000",
					sentPaise: 200000,
					sentCount: 2,
					received: "₹0",
					receivedPaise: 0,
					receivedCount: 0,
				},
				{
					group: "Counterparty 016",
					sent: "₹1,435",
					sentPaise: 143500,
					sentCount: 1,
					received: "₹0",
					receivedPaise: 0,
					receivedCount: 0,
				},
			],
			totals: {
				sent: "₹12,761.55",
				sentPaise: 1276155,
				sentCount: 17,
				received: "₹960",
				receivedPaise: 96000,
				receivedCount: 1,
			},
			groupCount: 16,
		});
	});

	test("answers read-only SQL and refuses to write", async () => {
		const client = await connectToKhata(await seededKhataHome());
		expect(
			(await call(client, "run_sql", { sql: "select count(*) as n from transactions" })).structuredContent,
		).toEqual({ columns: ["n"], rows: [[18]], truncated: false });
		const write = await call(client, "run_sql", { sql: "delete from transactions" });
		expect(write.isError).toBe(true);
		expect(
			(await call(client, "run_sql", { sql: "select count(*) as n from transactions" })).structuredContent,
		).toEqual({
			columns: ["n"],
			rows: [[18]],
			truncated: false,
		});
	});

	test("reports a missing statement instead of failing the call", async () => {
		const khataHome = freshKhataHome();
		const client = await connectToKhata(khataHome);
		const missing = join(khataHome, "missing.pdf");
		expect((await call(client, "ingest", { paths: [missing] })).structuredContent).toEqual({
			results: [{ path: missing, outcome: "rejected", reason: "File not found." }],
		});
	});
});
