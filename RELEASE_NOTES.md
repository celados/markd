# Markd 0.2.1

Markd 0.2.1 completes the first Electron-native macOS release path. It keeps the 0.2.0 application behavior and
adds a signed DMG container so Gatekeeper can assess the canonical download before publication.

## Release correction

- The app bundle and the DMG container are both signed with the Developer ID Application identity.
- The release workflow imports the real P12 into an isolated temporary keychain and proves the private key can
  sign before dependency installation, builds, or notarization begin.
- The canonical DMG must pass `codesign`, Apple notarization, stapling, Gatekeeper assessment, isolated install,
  and the background packaged journeys before draft promotion.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.

## Upgrade boundary

The public Tauri 0.1.9 build is not an Electron updater baseline. The release workflow proves an Electron
same-bundle upgrade through Squirrel/ShipIt and verifies the anonymous GitHub stable channel after publication.
