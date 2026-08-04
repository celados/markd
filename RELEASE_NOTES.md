# Markd 0.2.3

Markd 0.2.3 completes the first Electron-native macOS release path. It keeps the 0.2.2 application behavior and
corrects signing-identity discovery for the hardened release runner.

## Release correction

- The app bundle and the DMG container are both signed with the Developer ID Application identity.
- The release workflow imports the real P12 into an isolated temporary keychain and proves the private key can
  sign before dependency installation, builds, or notarization begin. The probe temporarily adds that keychain
  to the user search list, matching the runner-proven signing path, then restores the exact prior list.
- The canonical DMG must pass `codesign`, Apple notarization, stapling, Gatekeeper assessment, isolated install,
  and the background packaged journeys before draft promotion.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.

## Upgrade boundary

The public Tauri 0.1.9 build is not an Electron updater baseline. The release workflow proves an Electron
same-bundle upgrade through Squirrel/ShipIt and verifies the anonymous GitHub stable channel after publication.
