# Markd 0.2.5

Markd 0.2.5 completes the first Electron-native macOS release path. It keeps the 0.2.4 application behavior and
uses one stable GitHub release identity throughout the draft transaction.

## Release correction

- The app bundle and the DMG container are both signed with the Developer ID Application identity.
- The release workflow imports the real P12 into an isolated temporary keychain and proves the private key can
  sign before dependency installation, builds, or notarization begin. The probe temporarily adds that keychain
  to the user search list, matching the runner-proven signing path, then restores the exact prior list.
- The packaged smoke runner consumes pnpm's `--` argument delimiter instead of treating it as the app path, and
  rejects ambiguous extra arguments before launching Playwright.
- Draft resume, asset upload, authenticated readback, and publication all use the exact authenticated release ID;
  a public mismatch or more than one matching draft fails closed without clobbering assets.
- The canonical DMG must pass `codesign`, Apple notarization, stapling, Gatekeeper assessment, isolated install,
  and the background packaged journeys before draft promotion.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.

## Upgrade boundary

The public Tauri 0.1.9 build is not an Electron updater baseline. The release workflow proves an Electron
same-bundle upgrade through Squirrel/ShipIt and verifies the anonymous GitHub stable channel after publication.
