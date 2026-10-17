import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServer } from "./mcp/server.ts";
import { khataVersion } from "./status.ts";
import type { Store } from "./store/store.ts";

export const minimumServerTokenLength = 32;

function sha256(text: string): Buffer {
	return Buffer.from(new Bun.CryptoHasher("sha256").update(text).digest());
}

function carriesServerToken(request: Request, serverToken: string): boolean {
	const authorization = request.headers.get("authorization") ?? "";
	const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
	return timingSafeEqual(sha256(presented), sha256(serverToken));
}

export type KhataServer = {
	readonly fetch: (request: Request) => Promise<Response>;
	readonly close: () => Promise<void>;
};

export function createKhataServer(store: Store, serverToken: string): KhataServer {
	const mcp = createMcpHandler(() => createMcpServer(store, { kind: "remote" }));
	const fetch = async (request: Request): Promise<Response> => {
		const { pathname } = new URL(request.url);
		if (pathname === "/health") return Response.json({ status: "ok", version: khataVersion });
		if (!carriesServerToken(request, serverToken)) {
			return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": 'Bearer realm="khata"' } });
		}
		if (pathname === "/mcp") return mcp.fetch(request);
		return new Response("Not found", { status: 404 });
	};
	return { fetch, close: () => mcp.close() };
}
