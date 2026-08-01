export type ChangelogEntry = {
  version: string;
  date: string;
  displayDate: string;
  title: string;
  summary: string;
  changes: string[];
  releaseUrl?: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.8",
    date: "2026-08-01",
    displayDate: "August 1, 2026",
    title: "Faster note navigation",
    summary:
      "Tabs and pinned notes now expose the actions needed to keep a busy vault organized.",
    changes: [
      "Right-click a note tab to pin it, close it, close other tabs, or copy its full or vault-relative path.",
      "Drag the app window from unused space beside open tabs.",
      "Unpin a note or folder directly from its sidebar row.",
      "Read folded and multiline YAML frontmatter values correctly in note properties.",
    ],
    releaseUrl: "https://github.com/celados/markd/releases/tag/v0.1.8",
  },
  {
    version: "0.1.7",
    date: "2026-08-01",
    displayDate: "August 1, 2026",
    title: "An Octane-native foundation",
    summary:
      "Markd now runs on Octane while preserving its local-first writing workflow.",
    changes: [
      "Move the complete desktop interface from React to Octane and TSRX.",
      "Keep editor, vault, search, todo, bookmark, and quick-capture behavior intact across the migration.",
      "Ship Apple Developer ID signed and notarized macOS builds from the Celados release pipeline.",
      "Verify future in-app updates with a Celados-owned updater signing key.",
    ],
    releaseUrl: "https://github.com/celados/markd/releases/tag/v0.1.7",
  },
  {
    version: "0.1.6",
    date: "2026-07-21",
    displayDate: "July 21, 2026",
    title: "Publish and stay in control",
    summary:
      "Publish connected notes while keeping every local file yours.",
    changes: [
      "Publish a note together with its linked pages and images as one connected site.",
      "Subscribe to Markd Cloud from the website or desktop app and manage billing in Settings.",
      "Find and replace text inside a note without leaving the editor.",
      "Add and edit typed note properties inline, including clickable URL properties.",
      "Customize keyboard shortcuts and move through notes, todos, and bookmarks faster.",
      "Keep Markdown files directly in the vault root with a safe upgrade for existing vaults.",
      "Use a faster command palette and clearer async states throughout the app.",
      "Read published notes with matching typography and automatic light or dark mode.",
    ],
    releaseUrl: "https://github.com/starc007/markd/releases/tag/v0.1.6",
  },
  {
    version: "0.1.5",
    date: "2026-07-16",
    displayDate: "July 16, 2026",
    title: "Capture and connect",
    summary:
      "A faster way to keep important notes close and see how ideas relate.",
    changes: [
      "Capture a thought over any app with the global Quick Capture window.",
      "Open today's daily note from the command palette or keyboard.",
      "See backlinks and linked mentions with context in a dedicated sidebar.",
      "Pin important notes and folders above the regular note tree.",
      "Add and edit note properties without writing YAML by hand.",
      "Apply text and highlight colors from the editor selection menu.",
      "Move through the new sidebar-based Settings layout.",
      "Install a Developer ID signed and Apple-notarized release.",
    ],
    releaseUrl: "https://github.com/starc007/markd/releases/tag/v0.1.5",
  },
  {
    version: "0.1.4",
    date: "2026-07-12",
    displayDate: "July 12, 2026",
    title: "A better writing flow",
    summary:
      "More control when writing, organizing, and moving through a growing vault.",
    changes: [
      "Edit the underlying Markdown directly with the new CodeMirror source view.",
      "Move notes and folders reliably across deeply nested folders.",
      "Copy code blocks in one click.",
      "Export, copy, and delete a note from its actions menu.",
      "Navigate more of the app from the keyboard.",
      "Enjoy calmer editor typography and a refined Settings experience.",
    ],
    releaseUrl: "https://github.com/starc007/markd/releases/tag/v0.1.4",
  },
  {
    version: "0.1.3",
    date: "2026-07-09",
    displayDate: "July 9, 2026",
    title: "Start with a fresh vault",
    summary: "Creating a new space in Markd is now a first-class flow.",
    changes: [
      "Create a new vault or open an existing folder from the welcome screen.",
      "Open a newly created note directly in the editor.",
      "Keep notifications readable across light and dark themes.",
    ],
  },
  {
    version: "0.1.2",
    date: "2026-07-09",
    displayDate: "July 9, 2026",
    title: "Updates, inside the app",
    summary: "Markd can now keep itself current without interrupting your work.",
    changes: [
      "Check for signed updates when Markd launches.",
      "Install an available update from the sidebar.",
      "See update status and check manually from Settings.",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-09",
    displayDate: "July 9, 2026",
    title: "A smoother first session",
    summary: "Small details that make a new vault easier to understand and use.",
    changes: [
      "Begin a new vault with a useful welcome note.",
      "Reveal the current vault in Finder from the command palette.",
      "Open Settings from the command palette.",
      "Recover cleanly if the interface encounters an unexpected error.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-07-09",
    displayDate: "July 9, 2026",
    title: "Markd is here",
    summary: "The first public release of local-first Markdown notes for macOS.",
    changes: [
      "Keep every note as a plain Markdown file in a folder you choose.",
      "Write in a focused rich-text editor while preserving portable Markdown.",
      "Organize notes with real folders, search, tabs, todos, and bookmarks.",
    ],
  },
];
