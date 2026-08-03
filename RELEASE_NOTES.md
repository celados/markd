# Markd 0.2.0

Markd 0.2.0 is the first Electron-native release of the Celados fork. It is a clean desktop-runtime cut: existing
Vaults remain portable Markdown folders, while the application shell, filesystem authority, native search, Quick
Capture, updater, and release pipeline now run on Electron.

## Highlights

- One ignore-aware fff Vault Index now owns tree projection, search, backlinks, and external file changes.
- Notes, assets, Pins, Collections, Settings, Quick Capture, OS Trash, and the secure asset protocol run through a
  narrow isolated desktop bridge.
- The macOS package includes the exact Apple Silicon fff and ffi-rs native payloads and excludes retired Tauri
  runtime paths.
- Release artifacts are Developer ID signed, notarized, stapled, installed from the DMG, and exercised in the
  background before publication.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.

## Upgrade boundary

The previously published 0.1.9 build used Tauri and is not treated as an Electron updater baseline. The 0.2.0
workflow proves a same-bundle Electron baseline upgrade before publication and verifies the public stable channel
after publication. Future Electron releases must retain that same-base upgrade gate.
