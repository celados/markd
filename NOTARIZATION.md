---
type: Playbook
title: Electron macOS release
description: Build, sign, notarize, verify, and publish the macOS arm64 Electron application.
when: Preparing or diagnosing a Markd macOS release.
status: active
generated: { by: codex/gpt-5, at: 2026-08-03T20:45:00+08:00 }
---

# Release boundary

Markd publishes one desktop target: Electron on macOS arm64. The release path does not invoke Tauri, Rust
bundling, minisign, a custom update server, Linux builders, or Intel builders.

The executable contract is split across three files:

- [`electron-builder.yml`](./electron-builder.yml) owns ASAR layout, signing inputs, GitHub updater provider,
  target architecture, and artifact naming;
- [`scripts/verify-electron-package.mjs`](./scripts/verify-electron-package.mjs) fails closed on native payload,
  updater metadata, and stale or extra artifacts;
- [`.github/workflows/release-macos.yml`](./.github/workflows/release-macos.yml) owns tag validation, signing,
  notarization, Gatekeeper checks, background packaged smoke, and upload.

# Local package gate

Authenticate private `@celados` dependencies through the team `publish-package` workflow. A clean checkout
must copy the managed template, then render its sibling `.npmrc` before install:

```bash
cp "$HOME/.agents/.skills/celados/agents/publish-package/resources/.npmrc.tpl" .npmrc.tpl
hq secret.render "{ file: '.npmrc.tpl' }"
pnpm install --frozen-lockfile
pnpm test
pnpm run package:test
```

Both `.npmrc.tpl` and the rendered `.npmrc` are local-only and gitignored: the template contains a secret
locator, while the rendered file contains the registry credential. Neither may be committed.

`package:test` builds an unsigned local macOS arm64 DMG and ZIP, checks the exact ASAR-unpacked fff/ffi native
payload, validates `latest-mac.yml`, and launches the packaged app with `MARKD_E2E_BACKGROUND=1`.

# Release workflow

Create a `v<package.json version>` tag whose commit is reachable from `origin/main`, then run or observe the
`Release Electron macOS` workflow for that tag. A manual branch dispatch fails before reaching the persistent
runner. The self-hosted build uses `[self-hosted, macOS, ARM64]` and installs private dependencies with the
step-scoped `NPM_TOKEN`.

The workflow accepts these secrets only at their owning steps:

- `NPM_TOKEN` for private dependency installation;
- `DEVELOPER_ID_CERT_BASE64` and `P12_PASSWORD` for Developer ID signing;
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` for Apple notarization;
- the workflow-scoped GitHub token for release upload.

The canonical release payload for version `<version>` is exactly:

```text
Markd-<version>-mac-arm64.dmg
Markd-<version>-mac-arm64.zip
Markd-<version>-mac-arm64.zip.blockmap
latest-mac.yml
```

The workflow verifies the signed app and both unpacked native libraries with `codesign`, validates the app and
DMG notarization tickets with `stapler`, assesses them with Gatekeeper, then runs the packaged Vault Index smoke
without activating Markd in the foreground.

# Publication boundary

The website continues linking the real legacy `v0.1.9` DMG until #15 uploads the first canonical Electron asset.
That issue must switch the website URL and release asset atomically; pointing the site at a not-yet-published
canonical filename would create a public 404.
