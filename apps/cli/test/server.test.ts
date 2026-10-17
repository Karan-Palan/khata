import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createKhataServer, type KhataServer } from "../src/server.ts";
import { openStore, type Store } from "../src/store/store.ts";
import { seededKhataHome } from "./run-khata.ts";

const serverToken = "a-server-token-that-is-long-enough-for-tests";
const openStores: Store[] = [];
const openServers: KhataServer[] = [];
const openClients: Client[] = [];

async function seededHandler() {
	const store = await openStore({ kind: "sqlite", path: join(await seededKhataHome(), "khata.db") });
	openStores.push(store);
	const server = createKhataServer(store, serverToken);
	openServers.push(server);
	return server;
}

afterEach(async () => {
	await Promise.all(openClients.splice(0).map((client) => client.close()));
	await Promise.all(openServers.splice(0).map((server) => server.close()));
	await Promise.all(openStores.splice(0).map((store) => store.close()));
});

describe("khata server", () => {
	test("answers its health check without a token", async () => {
		const server = await seededHandler();
		const response = await server.fetch(new Request("https://khata.example/health"));
		expect([response.status, await response.json()]).toEqual([200, { status: "ok", version: "0.1.0" }]);
	});

	test("refuses every other request without the server token", async () => {
		const server = await seededHandler();
		const statuses = await Promise.all(
			[
				new Request("https://khata.example/mcp", { method: "POST", body: "{}" }),
				new Request("https://khata.example/mcp", {
					method: "POST",
					body: "{}",
					headers: { authorization: "Bearer not-the-token" },
				}),
				new Request("https://khata.example/anything", { headers: { authorization: `Bearer ${serverToken}` } }),
			].map(async (request) => (await server.fetch(request)).status),
		);
		expect(statuses).toEqual([401, 401, 404]);
	});

	test("serves the ledger's read-only tools over MCP to a client with the token", async () => {
		const server = await seededHandler();
		const transport = new StreamableHTTPClientTransport(new URL("https://khata.example/mcp"), {
			fetch: (input, init) => server.fetch(new Request(String(input), init as RequestInit)),
			requestInit: { headers: { authorization: `Bearer ${serverToken}` } },
		});
		const client = new Client({ name: "khata-test", version: "0.1.0" });
		await client.connect(transport);
		openClients.push(client);
		const { tools } = await client.listTools();
		const status = await client.callTool({ name: "status", arguments: {} });
		expect({
			tools: tools.map(({ name }) => name),
			transactionCount: (status.structuredContent as { transactionCount: number }).transactionCount,
		}).toEqual({ tools: ["status", "search_transactions", "summarize_transactions", "run_sql"], transactionCount: 18 });
	});
});
