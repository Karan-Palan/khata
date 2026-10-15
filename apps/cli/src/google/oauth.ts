const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const keychainService = "app.khata";
const signInTimeoutMilliseconds = 5 * 60_000;

export const googleScopes = [
	"openid",
	"email",
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/drive.readonly",
] as const;

export type GoogleClient = { readonly clientId: string; readonly clientSecret: string };

export type SecretStore = {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const keychain: SecretStore = {
	get: (name) => Bun.secrets.get({ service: keychainService, name }),
	set: (name, value) => Bun.secrets.set({ service: keychainService, name, value }),
};

export function refreshTokenName(account: string): string {
	return `google:${account}:refresh-token`;
}

export function clientSecretName(clientId: string): string {
	return `google:${clientId}:client-secret`;
}

function base64Url(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64url");
}

function randomToken(byteLength: number): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export type ClientFileOutcome =
	| { readonly kind: "read"; readonly client: GoogleClient }
	| { readonly kind: "failed"; readonly reason: string };

export async function readClientFile(path: string): Promise<ClientFileOutcome> {
	const file = Bun.file(path);
	if (!(await file.exists())) return { kind: "failed", reason: `No file at ${path}.` };
	const content: unknown = await file.json().catch(() => null);
	const installed =
		typeof content === "object" && content !== null && "installed" in content ? content.installed : null;
	if (
		typeof installed === "object" &&
		installed !== null &&
		"client_id" in installed &&
		typeof installed.client_id === "string" &&
		"client_secret" in installed &&
		typeof installed.client_secret === "string"
	) {
		return { kind: "read", client: { clientId: installed.client_id, clientSecret: installed.client_secret } };
	}
	return { kind: "failed", reason: "Not a Google OAuth client file for a desktop app." };
}

type TokenResponse = { readonly access_token?: string; readonly refresh_token?: string; readonly id_token?: string };

async function requestTokens(fetchImplementation: Fetch, parameters: Record<string, string>): Promise<TokenResponse> {
	const response = await fetchImplementation(tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(parameters).toString(),
	});
	if (!response.ok) throw new Error(`Google refused the token request (${response.status}).`);
	return (await response.json()) as TokenResponse;
}

function accountFromIdToken(idToken: string | undefined): string | null {
	const payload = idToken?.split(".")[1];
	if (payload === undefined) return null;
	const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	return typeof claims === "object" && claims !== null && "email" in claims && typeof claims.email === "string"
		? claims.email
		: null;
}

export type AuthorizationOutcome =
	| { readonly kind: "authorized"; readonly account: string }
	| { readonly kind: "failed"; readonly reason: string };

export type AuthorizationDependencies = {
	readonly fetch: Fetch;
	readonly secrets: SecretStore;
	readonly openUrl: (url: string) => void;
	readonly timeoutMilliseconds?: number;
};

export async function authorizeGoogle(
	client: GoogleClient,
	{
		fetch: fetchImplementation,
		secrets,
		openUrl,
		timeoutMilliseconds = signInTimeoutMilliseconds,
	}: AuthorizationDependencies,
): Promise<AuthorizationOutcome> {
	const verifier = randomToken(32);
	const challenge = base64Url(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
	);
	const state = randomToken(16);
	const { promise: callback, resolve: settle } = Promise.withResolvers<{ code: string } | { reason: string }>();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const parameters = new URL(request.url).searchParams;
			const code = parameters.get("code");
			if (parameters.get("state") !== state) {
				settle({ reason: "The sign-in response did not match this request." });
				return new Response("khata could not verify this sign-in. Run khata auth google again.", { status: 400 });
			}
			if (code === null) {
				settle({ reason: `Google sign-in was not completed: ${parameters.get("error") ?? "no code returned"}.` });
				return new Response("khata was not connected. You can close this tab.", { status: 400 });
			}
			settle({ code });
			return new Response("khata is connected to your Google account. You can close this tab.");
		},
	});
	const redirectUri = `http://127.0.0.1:${server.port}`;
	const authorizationUrl = new URL(authorizationEndpoint);
	for (const [name, value] of Object.entries({
		client_id: client.clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: googleScopes.join(" "),
		code_challenge: challenge,
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "consent",
		state,
	})) {
		authorizationUrl.searchParams.set(name, value);
	}

	const timer = setTimeout(() => settle({ reason: "Timed out waiting for Google sign-in." }), timeoutMilliseconds);
	openUrl(authorizationUrl.toString());
	const outcome = await callback;
	clearTimeout(timer);
	await server.stop();
	if ("reason" in outcome) return { kind: "failed", reason: outcome.reason };

	try {
		const tokens = await requestTokens(fetchImplementation, {
			code: outcome.code,
			client_id: client.clientId,
			client_secret: client.clientSecret,
			code_verifier: verifier,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		});
		const account = accountFromIdToken(tokens.id_token);
		if (account === null || tokens.refresh_token === undefined) {
			return { kind: "failed", reason: "Google did not return an account and a refresh token." };
		}
		await secrets.set(refreshTokenName(account), tokens.refresh_token);
		await secrets.set(clientSecretName(client.clientId), client.clientSecret);
		return { kind: "authorized", account };
	} catch (error) {
		return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
	}
}

export type AccessTokenOutcome =
	| { readonly kind: "token"; readonly accessToken: string }
	| { readonly kind: "failed"; readonly reason: string };

export async function refreshAccessToken(
	account: string,
	clientId: string,
	{ fetch: fetchImplementation, secrets }: Pick<AuthorizationDependencies, "fetch" | "secrets">,
): Promise<AccessTokenOutcome> {
	const refreshToken = await secrets.get(refreshTokenName(account));
	const clientSecret = await secrets.get(clientSecretName(clientId));
	if (refreshToken === null || clientSecret === null) {
		return { kind: "failed", reason: `Not signed in as ${account}. Run khata auth google.` };
	}
	try {
		const tokens = await requestTokens(fetchImplementation, {
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		});
		return tokens.access_token === undefined
			? { kind: "failed", reason: "Google returned no access token." }
			: { kind: "token", accessToken: tokens.access_token };
	} catch (error) {
		return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
	}
}
