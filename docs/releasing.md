# Releasing khata

Maintainer only. The release workflow publishes to npm through trusted publishing, so no npm token is stored anywhere.

## What ships

- `khata` on npm: a small Node launcher that runs the compiled executable for the user's platform.
- `@khata/cli-<platform>-<arch>`: one compiled executable each for darwin-arm64, darwin-x64, linux-arm64, linux-x64, and win32-x64. npm installs only the one matching the machine.
- The plugin in `plugin/`, served from this repository's marketplaces, which runs `npx -y khata@<version> mcp`.
- The same executables attached to the GitHub release, with their SHA-256 sums.

## Release a version

1. Set the new version in `apps/cli/package.json`, both plugin manifests, `plugin/.mcp.json`, and every `khata@<version>` in the plugin's skills and README. `bun test` names any file left behind.
2. Commit as `chore(release): <version>` and push to `main`.
3. Tag and push: `git tag v<version> && git push origin v<version>`.

The Release workflow builds every executable on macOS, installs each through npm on its own platform and checks the CLI and the MCP server, then publishes the executables before the launcher and attaches them to a GitHub release. Re-running it skips versions already on npm.

## First publish

`npm trust` works only on packages that already exist, so the first version of each package is published once by hand:

1. On npmjs.com, with two-factor authentication on, create the free `khata` organization that owns the `@khata` scope. Then `npm login` as its owner.
2. `bun run --cwd apps/cli build:npm`.
3. `for directory in apps/cli/dist/npm/cli-* apps/cli/dist/npm/khata; do npm publish "$directory" --access public; done`.
4. For `khata` and each `@khata/cli-*` package: `npm trust github <package> --repository Karan-Palan/khata --file release.yml --yes`.

Later versions go through the workflow alone.

## Why it is built this way

- Bun compiles khata into one executable that needs no runtime, but npm cannot choose a file by platform. The launcher package with one optional dependency per platform, as esbuild and Biome ship, lets `npx khata` work wherever Node does.
- Executables for macOS are built on macOS, because Bun signs macOS executables only when it builds on macOS, and Apple silicon refuses unsigned ones.
- The x64 executables use Bun's baseline builds, which run on processors without AVX2.
- The plugin pins an exact khata version, so a plugin update and a khata update are the same event, and `npx` can reuse its cached copy instead of asking the registry on every start.
- `khata schedule enable` copies the running executable into `~/.khata/bin`, so the scheduled sync does not depend on a cache npx may clear, or on a checkout in a protected folder such as Desktop.
- macOS executables are signed ad hoc, not notarized. Installs through npm are not quarantined; an executable downloaded from the GitHub release in a browser is, and macOS asks before its first run.
