# Markd

**Local-first notes for people who write.**

> [!NOTE]
> This is [Celados' Octane-based fork](https://github.com/celados/markd) of
> [starc007/markd](https://github.com/starc007/markd). Electron is the only desktop runtime and release path.

Markd is a fast notes app for macOS, built for people who care about speed, privacy, and ownership.

No accounts.
No cloud.
No sync (for now).

Your notes live on your disk as plain `.md` files. Markd simply makes writing and finding them fast.

---

## Installing on macOS

Download the latest `.dmg` from [usemarkd.app](https://usemarkd.app) and drag Markd to Applications.

Markd releases are Developer ID signed and notarized by Apple before distribution.

---

## Features

- **WYSIWYG markdown editor:** write in a rich editor, saved as clean markdown on disk
- **Folders and subfolders:** organize notes in real, file-manager-visible folders
- **Todos:** a standalone task list with tags and filtering
- **Bookmarks:** save links with an auto-fetched title, image, and favicon
- **Command palette:** press Ctrl/Cmd+K to jump to any note, folder, or page instantly
- **Instant search:** title and content, ranked in milliseconds
- **Monochrome UI:** light, dark, or system theme with no color noise
- **Portable vault:** plain files, no IDs, no required metadata, no lock-in

---

## Vault model

Pick any folder on disk as your vault:

```
<vault>/
├── Note.md         plain .md files, filename is the title
├── projects/       real folders containing more notes
└── .markd/         app data: todos, bookmarks, tags, pasted images
```

Notes are addressed by path, never by ID. Deletes go to the OS trash. Edit notes externally with vim, VS Code,
or another editor. Markd picks up changes through its live Vault Index.

---

## Getting started

Requirements: [pnpm](https://pnpm.io) and macOS.

First render the private `@celados` registry authentication described in
[NOTARIZATION.md](./NOTARIZATION.md#local-package-gate); a clean checkout cannot install without it.

```bash
pnpm install
pnpm run dev
```

Build, inspect, and smoke-test an unsigned local Electron package:

```bash
pnpm run package:test
```

Maintainers can follow [NOTARIZATION.md](./NOTARIZATION.md) to configure Developer ID signing and Apple notarization for releases.

See [AGENTS.md](./AGENTS.md) for architecture details, or [CONTRIBUTING.md](./CONTRIBUTING.md) to send a PR.

---

## Data & Privacy

- Notes are stored locally as user-owned files
- No analytics, tracking, accounts, or note-content uploads
- Packaged builds check the Celados GitHub Releases channel for application updates
- Saving a bookmark fetches that page's title, preview image, and favicon
- Export your notes anytime because they are already just files

---

## Status

This fork is under active development. Its Octane/Electron application passes type, logic,
production-build, system-Chrome journey, Electron, and packaged native-payload gates.

Sync, encryption, and publishing may be added later without compromising local-first performance.

## License

[MIT](./LICENSE)

---

**Markd**
_Write at the speed of thought._
