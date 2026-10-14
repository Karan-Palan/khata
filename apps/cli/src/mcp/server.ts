import { McpServer } from "@modelcontextprotocol/server";
import { khataVersion, ledgerStatusSchema, readLedgerStatus } from "../status.ts";
import type { Store } from "../store/store.ts";

export function createMcpServer(store: Store): McpServer {
	const server = new McpServer({ name: "khata", version: khataVersion }, { capabilities: { tools: {} } });

	server.registerTool(
		"status",
		{
			title: "Ledger status",
			description: "Report where the khata ledger is stored and how many statements and transactions it holds.",
			outputSchema: ledgerStatusSchema,
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async () => {
			const status = readLedgerStatus(store);
			return { content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status };
		},
	);

	return server;
}
