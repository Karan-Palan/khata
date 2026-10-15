# Google sign-in for Gmail and Drive

khata reads statement attachments from Gmail and scheduled Takeout zips from Drive with read-only scopes. Each user brings their own Google OAuth client, so no shared client ever holds anyone's mail access.

## Creating the client

In the Google Cloud console, signed in as the account khata will read:

1. Create a project, for example `khata`.
2. Enable the Gmail API and the Google Drive API for it.
3. In Google Auth Platform, create the branding: app name and user support email. Choose the External audience and add a developer contact email.
4. Under Audience, add your own address as a test user.
5. Under Clients, create a client of type Desktop app and download its JSON.
6. Run `bun run khata auth google --client-file <downloaded.json>` and approve the consent screen in your browser.

khata stores the refresh token and the client secret in the macOS Keychain under the service `app.khata`, and records the account in `~/.khata/config.json`. Revoke access at any time from your Google Account's third-party connections.

## Known limits

- An app in Testing status gets refresh tokens that Google expires after 7 days for Gmail and Drive scopes, so scheduled sync stops until `khata auth google` runs again. Publishing the app to production removes the limit but requires an application home page, a privacy policy link, and an authorized domain you own on the branding page.
- Until the app is published, only listed test users can sign in, and Google shows an unverified-app warning on the consent screen.
- The Gmail query defaults to attachments named like `gpay_statement`; the Drive query to zips named like `takeout-`. Both are editable per source in `~/.khata/config.json`.

## Scheduled sync on macOS

`khata schedule enable` installs a LaunchAgent that runs `khata sync` at load and on an interval. The first scheduled run of `bun` may trigger macOS prompts to access protected folders such as Desktop or Downloads; until they are allowed the run waits. Keeping the repository and watched folders outside Desktop and Documents avoids the prompts.
