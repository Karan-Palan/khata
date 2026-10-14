const conventionalSubject = /^(feat|fix|perf|refactor|test|docs|build|ci|chore)\([a-z0-9-]+(,[a-z0-9-]+)*\)!?: \S.*$/;
const attributionLine = /^\s*(co-authored-by:|.*generated with)/i;
const emDash = String.fromCodePoint(0x2014);

export function commitMessageProblems(message: string): string[] {
	const lines = message.split("\n").filter((line) => !line.startsWith("#"));
	const subject = lines[0] ?? "";
	const problems: string[] = [];
	if (!conventionalSubject.test(subject)) {
		problems.push(
			`Subject must be a Conventional Commit with a scope, for example "feat(parsers): read Google Pay statements". Got: "${subject}"`,
		);
	}
	if (lines.some((line) => attributionLine.test(line))) {
		problems.push("Remove agent or tool attribution lines such as Co-Authored-By.");
	}
	if (message.includes(emDash)) {
		problems.push("Use plain hyphens instead of em dashes.");
	}
	return problems;
}

if (import.meta.main) {
	const messagePath = Bun.argv[2];
	if (messagePath === undefined) {
		console.error("Usage: bun scripts/check-commit-message.ts <commit-message-file>");
		process.exit(64);
	}
	const problems = commitMessageProblems(await Bun.file(messagePath).text());
	for (const problem of problems) console.error(problem);
	if (problems.length > 0) process.exit(1);
}
