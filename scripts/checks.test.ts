import { describe, expect, test } from "bun:test";
import { findComments, isSourcePath } from "./check-comments.ts";
import { commitMessageProblems } from "./check-commit-message.ts";

describe("findComments", () => {
	test("reports line and block comments but not comment-like strings", () => {
		const source = [
			"#!/usr/bin/env bun",
			'const url = "https://example.com"; // trailing',
			"const template = `/* inside a template */`;",
			"/* block */",
		].join("\n");
		expect(findComments("sample.ts", source)).toEqual([
			{ path: "sample.ts", line: 2, text: "trailing" },
			{ path: "sample.ts", line: 4, text: "block" },
		]);
	});

	test("allows tool directives only when they carry a reason", () => {
		const source = [
			"// biome-ignore lint/style/noNonNullAssertion: length checked above",
			"// @ts-expect-error upstream types omit this overload",
			"// @ts-expect-error",
			"// @ts-ignore because",
		].join("\n");
		expect(findComments("sample.ts", source).map(({ line }) => line)).toEqual([3, 4]);
	});
});

describe("isSourcePath", () => {
	test("leaves out installed dependencies and build output", () => {
		expect(
			[
				"apps/cli/src/main.ts",
				"apps/cli/release/launcher.ts",
				"apps/cli/dist/npm/khata/bin/khata.js",
				"packages/parsers/node_modules/unpdf/dist/index.mjs",
			].map(isSourcePath),
		).toEqual([true, true, false, false]);
	});
});

describe("commitMessageProblems", () => {
	test("accepts a scoped Conventional Commit", () => {
		expect(commitMessageProblems("feat(parsers): read Google Pay statements\n\nWhy and how verified.\n")).toEqual([]);
	});

	test("rejects a subject without a scope", () => {
		expect(commitMessageProblems("feat: read statements")).toEqual([
			'Subject must be a Conventional Commit with a scope, for example "feat(parsers): read Google Pay statements". Got: "feat: read statements"',
		]);
	});

	test("rejects agent attribution and em dashes", () => {
		expect(
			commitMessageProblems(
				`fix(cli): handle empty input ${String.fromCodePoint(0x2014)} safely\n\nCo-Authored-By: Some Agent <agent@example.com>\n`,
			),
		).toEqual([
			"Remove agent or tool attribution lines such as Co-Authored-By.",
			"Use plain hyphens instead of em dashes.",
		]);
	});
});
