export async function runWithEnvironment(command: readonly string[]): Promise<number> {
	const child = Bun.spawn([...command], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
	return child.exited;
}

if (import.meta.main) {
	const command = Bun.argv.slice(2);
	if (command.length === 0) {
		console.error("Usage: bun run with-env <command> [args...]");
		process.exit(64);
	}
	process.exit(await runWithEnvironment(command));
}
