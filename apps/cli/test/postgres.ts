import { afterAll } from "bun:test";
import { SQL } from "bun";

export const testPostgresUrl = process.env["KHATA_TEST_POSTGRES_URL"];

const createdDatabases: string[] = [];

export async function freshPostgresUrl(baseUrl: string): Promise<string> {
	const name = `khata_test_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new SQL(baseUrl);
	try {
		await admin.unsafe(`create database ${name}`);
	} finally {
		await admin.close();
	}
	createdDatabases.push(name);
	const url = new URL(baseUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

afterAll(async () => {
	if (testPostgresUrl === undefined || createdDatabases.length === 0) return;
	const admin = new SQL(testPostgresUrl);
	try {
		for (const name of createdDatabases.splice(0)) await admin.unsafe(`drop database if exists ${name} with (force)`);
	} finally {
		await admin.close();
	}
});
