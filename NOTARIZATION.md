---
type: Playbook
title: Markd macOS signing and notarization
description: Build, sign, notarize, verify, and publish Markd macOS releases locally or on the celados self-hosted runner.
when: Setting up or diagnosing Markd Developer ID signing, Apple notarization, Tauri updater signatures, or macOS releases.
---

# macOS signing and notarization

Markd releases are signed with a Developer ID Application certificate, submitted to Apple's notary service, and stapled before distribution. Tauri updater artifacts use a separate minisign keypair; the public verifier lives in `src-tauri/tauri.conf.json`, while the private key remains in Vaultwarden and GitHub Secrets.

The authoritative CI path is `.github/workflows/release-macos.yml`. Manual dispatches build and notarize without publishing by default; tag pushes publish only when the tag matches the app version.

## 1. Install the signing certificate

In Apple Developer, create a **Developer ID Application** certificate using a certificate signing request from this Mac. Download and install the certificate in the login keychain.

Confirm that the certificate and its private key are available:

```bash
security find-identity -v -p codesigning
```

Copy the complete identity, including the team name and ID:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

Do not use an Apple Development, Apple Distribution, or ad-hoc identity for direct downloads.

## 2. Configure notarization credentials

The App Store Connect API key flow is recommended for releases. Create a key with Developer access in App Store Connect under **Users and Access → Integrations**, then set:

```bash
export APPLE_API_ISSUER="issuer-id"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="$HOME/.private_keys/AuthKey_key-id.p8"
```

The private key can only be downloaded once. Keep it outside the repository. `.p8`, `.p12`, `.key`, and environment files are ignored by Git.

Alternatively, use an Apple ID with an app-specific password:

```bash
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="team-id"
```

## 3. Verify the environment

```bash
pnpm run release:check
```

The check rejects ad-hoc signing, Apple Development certificates, missing private keys, and partial notarization credentials.
It also requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, because a release without a signed updater archive must not be published.

## 4. Release

```bash
pnpm run release 0.1.7 --type=feature "Release notes"
```

The release script removes stale artifacts and asks Tauri to build an unsigned app, avoiding a redundant signing pass that cannot address CI's ephemeral Keychain explicitly. It then applies the final Developer ID signature with the selected Keychain, notarizes and staples that exact app, creates a fresh updater archive from it, and signs the archive. Only then does it create and notarize the DMG. The script verifies the app and DMG with `codesign`, `hdiutil`, `stapler`, and Gatekeeper before generating updater metadata.

If DMG creation or notarization fails after the app has passed verification, resume without rebuilding it:

```bash
pnpm run release 0.1.7 --type=feature --resume "Release notes"
```

The resume path validates the existing app version, signature, notarization ticket, updater archive, and updater signature before using them. If Tauri's DMG command fails, the release automatically retries with Tauri's generated `create-dmg` helper.

Never use `--skip-stapling` for a public release.

## 5. CI secret mapping

The workflow imports the certificate into an ephemeral Keychain and deletes it in an `always()` cleanup step. It passes the imported certificate fingerprint to `codesign`, avoiding an older same-named identity that may already exist on a persistent runner. Repository secrets are populated from Vaultwarden rather than copied from a developer shell:

- `DEVELOPER_ID_CERT_BASE64`, `P12_PASSWORD`, `KEYCHAIN_PASSWORD`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The current Apple material is shared with OnType at the team/certificate level. `APPLE_ID_PWD` is mapped to Markd's `APPLE_PASSWORD`; no new Apple app record is required for direct Developer ID distribution.

The current certificate chains through Apple's Developer ID G2 intermediate. Because release scripts explicitly restrict `codesign` to the ephemeral Keychain, the runner downloads Apple Root CA and both public Developer ID intermediates, verifies their pinned SHA-256 values, and imports the complete chain only into that Keychain. Keeping G1 as well as G2 preserves support for certificates from either valid chain, as required by [Developer ID Intermediate Certificate Updates](https://developer.apple.com/support/developer-id-intermediate-certificate/); root material comes from [Apple PKI](https://www.apple.com/certificateauthority/).
