# Contributing to Markd

Thanks for considering a contribution. Markd stays small on purpose — please open an issue before starting on anything beyond a bug fix, so we can agree on the approach first.

## Setup

Requirements: [pnpm](https://pnpm.io), Node.js 24, and Xcode Command Line Tools.

```bash
pnpm install
pnpm run dev
```

## Before opening a PR

```bash
pnpm run typecheck         # typecheck
pnpm test                  # domain and process-contract tests
pnpm run test:browser      # system Chrome journeys
MARKD_E2E_BACKGROUND=1 pnpm run test:electron
```

All gates must pass clean. Electron tests run in background mode so they do not activate the desktop app.

## Code conventions

See [AGENTS.md](./AGENTS.md) for the full architecture guide. The short version:

- **The Vault Engine owns filesystem and collection work.** Renderer code consumes domain-shaped services over the typed `window.markd` preload bridge; it never imports Node or Electron.
- **Main owns OS authority.** Dialogs, Trash, external navigation, Finder reveal, updater, and window lifecycle stay in Electron main; recursive scans and Markdown parsing stay in the utility process.
- **Strict monochrome UI.** Only the semantic tokens in `src/styles.css` (`bg`, `panel`, `ink`, `muted`, `faint`, `line`, `hover`, `invert`…). Never hardcode a color — `danger` is the one exception, for destructive actions only.
- Keep motion subtle: 100–160ms ease-out, nothing bouncier.

## Commit messages

[Conventional commits](https://www.conventionalcommits.org/), subject line ≤50 chars where possible (`feat: ...`, `fix: ...`, `chore: ...`).

## What we won't merge

- Sticky notes, wiki-links, note IDs/frontmatter, or a plugin system — these were deliberately cut, see AGENTS.md.
- Anything that adds a color outside the monochrome token set.
- Cloud sync / accounts — out of scope for now (see README status).

## Reporting bugs

Open an issue with your operating system, Markd version, and reproduction steps. If it is a vault or data issue, mention whether it reproduces with a fresh vault folder.
