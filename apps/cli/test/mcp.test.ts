import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { freshKhataHome, mainScriptPath } from "./run-khata.ts";

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

afterEach(async () => {
	await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe("khata MCP server", () => {
	test("lists the status tool as read-only", async () => {
		const client = await connectToKhata(freshKhataHome());
		const { tools } = await client.listTools();
		expect(tools.map(({ name, annotations }) => ({ name, readOnly: annotations?.readOnlyHint }))).toEqual([
			{ name: "status", readOnly: true },
		]);
	});

	test("reports an empty ledger through the status tool", async () => {
		const khataHome = freshKhataHome();
		const client = await connectToKhata(khataHome);
		const result = await client.callTool({ name: "status", arguments: {} });
		expect(result.structuredContent).toEqual({
			version: "0.0.0",
			databasePath: join(khataHome, "khata.db"),
			schemaVersion: 1,
			documentCount: 0,
			transactionCount: 0,
		});
	});
});
