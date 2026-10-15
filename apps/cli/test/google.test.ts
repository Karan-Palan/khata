import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { zipSync } from "fflate";
import { defaultDriveQuery, defaultGmailQuery, type GoogleSource } from "../src/config.ts";
import {
	authorizeGoogle,
	clientSecretName,
	refreshTokenName,
	type SecretStore,
	storedClient,
} from "../src/google/oauth.ts";
import { syncGoogle } from "../src/sources/google.ts";
import { openStore } from "../src/store/store.ts";
import { freshKhataHome, loadActivityFixture } from "./run-khata.ts";

function memorySecrets(initial: Record<string, string> = {}): SecretStore & { readonly values: Map<string, string> } {
	const values = new Map(Object.entries(initial));
	return {
		values,
		get: async (name) => values.get(name) ?? null,
		set: async (name, value) => {
			values.set(name, value);
		},
	};
}

function idToken(email: string): string {
	return ["header", Buffer.from(JSON.stringify({ email })).toString("base64url"), "signature"].join(".");
}

const source: GoogleSource = {
	kind: "google",
	account: "someone@example.com",
	clientId: "client-123",
	gmailQuery: defaultGmailQuery,
	driveQuery: defaultDriveQuery,
};

async function fakeGoogle() {
	const { entries } = await loadActivityFixture();
	const takeoutZip = zipSync({
		"Takeout/My Activity/Google Pay/MyActivity.json": new TextEncoder().encode(JSON.stringify(entries)),
	});
	const requested: string[] = [];
	const fetch = async (input: string): Promise<Response> => {
		const url = new URL(input);
		requested.push(url.pathname);
		if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "access-1" });
		if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: "m1" }] });
		if (url.pathname.endsWith("/messages/m1")) {
			return Response.json({
				payload: { parts: [{ filename: "gpay_statement_20180401_20180930.pdf", body: { attachmentId: "a1" } }] },
			});
		}
		if (url.pathname.endsWith("/attachments/a1")) {
			return Response.json({ data: Buffer.from("not really a pdf").toString("base64url") });
		}
		if (url.pathname === "/drive/v3/files") {
			return Response.json({ files: [{ id: "f1", name: "takeout-1.zip", modifiedTime: "2026-10-15T00:00:00Z" }] });
		}
		if (url.pathname === "/drive/v3/files/f1") return new Response(takeoutZip);
		return new Response("not found", { status: 404 });
	};
	return { fetch, requested };
}

describe("syncGoogle", () => {
	test("ingests Takeout zips from Drive, reports unreadable Gmail attachments, and skips both next time", async () => {
		const store = openStore(join(freshKhataHome(), "khata.db"));
		const secrets = memorySecrets({
			[refreshTokenName(source.account)]: "refresh-1",
			[clientSecretName(source.clientId)]: "secret-1",
		});
		const google = await fakeGoogle();
		const first = await syncGoogle(store, "google:someone@example.com", source, { fetch: google.fetch, secrets });
		expect(first.failure).toBeNull();
		expect(first.results.map(({ path, outcome }) => [path, outcome])).toEqual([
			["gmail:m1/gpay_statement_20180401_20180930.pdf", "rejected"],
			["drive:takeout-1.zip!/Takeout/My Activity/Google Pay/MyActivity.json", "ingested"],
		]);
		expect(store.status().transactionCount).toBe(15);

		const second = await syncGoogle(store, "google:someone@example.com", source, { fetch: google.fetch, secrets });
		expect([second.results.length, second.unchanged, second.failure]).toEqual([0, 2, null]);
		store.close();
	});

	test("explains when the account has not been connected", async () => {
		const store = openStore(join(freshKhataHome(), "khata.db"));
		const google = await fakeGoogle();
		expect(await syncGoogle(store, "google:x", source, { fetch: google.fetch, secrets: memorySecrets() })).toEqual({
			results: [],
			unchanged: 0,
			failure: "Not signed in as someone@example.com. Run khata auth google.",
		});
		store.close();
	});
});

describe("authorizeGoogle", () => {
	test("completes the loopback sign-in and keeps the tokens in the secret store", async () => {
		const secrets = memorySecrets();
		const tokenRequests: string[] = [];
		const outcome = await authorizeGoogle(
			{ clientId: "client-123", clientSecret: "secret-1" },
			{
				secrets,
				fetch: async (_input, init) => {
					tokenRequests.push(String(init?.body));
					return Response.json({
						refresh_token: "refresh-1",
						access_token: "access-1",
						id_token: idToken("someone@example.com"),
					});
				},
				openUrl: (url) => {
					const parameters = new URL(url).searchParams;
					void globalThis.fetch(`${parameters.get("redirect_uri")}/?code=code-1&state=${parameters.get("state")}`);
				},
			},
		);
		expect(outcome).toEqual({ kind: "authorized", account: "someone@example.com" });
		expect(Object.fromEntries(secrets.values)).toEqual({
			"google:someone@example.com:refresh-token": "refresh-1",
			"google:client-123:client-secret": "secret-1",
		});
		expect(tokenRequests[0]?.includes("code_verifier=")).toBe(true);
	});

	test("rejects a callback that does not carry the request's state", async () => {
		const outcome = await authorizeGoogle(
			{ clientId: "client-123", clientSecret: "secret-1" },
			{
				secrets: memorySecrets(),
				fetch: async () => Response.json({}),
				openUrl: (url) => {
					void globalThis.fetch(`${new URL(url).searchParams.get("redirect_uri")}/?code=code-1&state=forged`);
				},
			},
		);
		expect(outcome).toEqual({ kind: "failed", reason: "The sign-in response did not match this request." });
	});
});

describe("storedClient", () => {
	test("rebuilds the client from the Keychain so later sign-ins need no client file", async () => {
		const secrets = memorySecrets({ [clientSecretName("client-123")]: "secret-1" });
		expect(await storedClient("client-123", secrets)).toEqual({
			kind: "read",
			client: { clientId: "client-123", clientSecret: "secret-1" },
		});
		expect(await storedClient("client-456", secrets)).toEqual({
			kind: "failed",
			reason: "No stored Google client. Run khata auth google --client-file <path> once.",
		});
	});
});
