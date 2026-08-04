# Markd 0.2.6

Markd 0.2.6 fixes the empty-Vault onboarding path in the Electron-native app.

## Fixed

- Creating the first note after opening an empty Vault keeps the file tree mounted and immediately shows
  `Untitled.md` in the sidebar.
- Electron regression tests use isolated Markd configuration directories instead of reading the user's real
  Vault selection.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.

## Upgrade boundary

The public Tauri 0.1.9 build is not an Electron updater baseline. The release workflow proves an Electron
same-bundle upgrade through Squirrel/ShipIt and verifies the anonymous GitHub stable channel after publication.
