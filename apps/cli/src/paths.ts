import { homedir } from "node:os";
import { join } from "node:path";

export type KhataPaths = {
	readonly home: string;
	readonly databasePath: string;
};

export function resolveKhataPaths(environment: Record<string, string | undefined>): KhataPaths {
	const home = environment["KHATA_HOME"] ?? join(homedir(), ".khata");
	return { home, databasePath: join(home, "khata.db") };
}
