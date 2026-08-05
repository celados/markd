export type GuideSection = {
  heading: string;
  paragraphs: string[];
};

export type Guide = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  eyebrow: string;
  publishedAt: string;
  updatedAt: string;
  takeaways: string[];
  sections: GuideSection[];
  faqs: { question: string; answer: string }[];
};

export const GUIDES: Guide[] = [
  {
    slug: "local-first-markdown-notes",
    title: "Local-first Markdown notes without lock-in",
    shortTitle: "Local-first Markdown notes",
    description:
      "Learn what local-first note-taking means, where Riffle stores your Markdown files, and how the model keeps your writing portable.",
    eyebrow: "Local-first notes",
    publishedAt: "2026-07-19",
    updatedAt: "2026-08-05",
    takeaways: [
      "Your vault is a normal folder you choose.",
      "Every note is a readable .md file, not a database record.",
      "Cloud publishing is explicit and separate from the local source files.",
    ],
    sections: [
      {
        heading: "What local-first means in Riffle",
        paragraphs: [
          "Riffle treats the files on your computer as the source of truth. You choose a folder, Riffle keeps notes inside it as standard Markdown files, and folders in the sidebar are real folders on disk. The app does not require an account to create, edit, search, or organize a vault.",
          "That model is different from an offline cache. A cache is a temporary copy of data owned by a remote service. A Riffle vault is the primary copy: it remains useful with no network connection and can be opened by other text editors or command-line tools.",
        ],
      },
      {
        heading: "Portability is a product feature",
        paragraphs: [
          "Plain Markdown reduces the cost of leaving. Titles come from filenames, hierarchy comes from folders, and optional YAML frontmatter remains in the note. Riffle can present a rendered Readonly View, editable source, backlinks, properties, tabs, todos, and bookmarks without hiding the underlying document format.",
          "You can back up the vault with Time Machine, git, Syncthing, Dropbox, iCloud Drive, or another file-sync tool. Riffle does not force a particular sync provider, although native Riffle sync is planned for the future.",
        ],
      },
      {
        heading: "What happens when you publish",
        paragraphs: [
          "Publishing is an explicit action. Riffle prepares the selected note, its linked pages, and referenced images for a public web copy. The original vault stays on your disk and remains the editable source of truth.",
          "This separation makes the boundary clear: local writing does not silently become cloud data. You choose what becomes public, and unpublishing removes the hosted site without changing the local notes.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does local-first mean Riffle never uses the internet?",
        answer:
          "Core note editing works locally. Network access is used only for features that require it, such as checking for updates, fetching bookmark details, signing in, or publishing a site.",
      },
      {
        question: "Can I open a Riffle vault without Riffle?",
        answer:
          "Yes. Notes are ordinary Markdown files in ordinary folders, so any compatible text editor can read them.",
      },
    ],
  },
  {
    slug: "plain-text-notes-app",
    title: "A plain-text notes app with a real editor",
    shortTitle: "Plain-text notes app",
    description:
      "See how Riffle combines portable plain-text Markdown files with a rendered reading view, editable source, search, links, and properties.",
    eyebrow: "Plain-text notes",
    publishedAt: "2026-07-19",
    updatedAt: "2026-08-05",
    takeaways: [
      "Read rendered Markdown or edit the source directly.",
      "Use standard links and optional YAML frontmatter.",
      "Keep filenames and folders meaningful outside the app.",
    ],
    sections: [
      {
        heading: "Plain text does not have to feel primitive",
        paragraphs: [
          "A portable file format and a polished reading experience are not opposites. Riffle's Readonly View renders headings, lists, tasks, code blocks, tables, links, images, and safe embedded markup. The Source Editor exposes the underlying Markdown in CodeMirror for direct editing.",
          "Both views derive from the same note. Body changes happen in the Source Editor, while the Properties Editor owns frontmatter; there is no second proprietary document representation to keep in sync.",
        ],
      },
      {
        heading: "Files stay understandable outside the app",
        paragraphs: [
          "A note named Roadmap is stored as Roadmap.md. A project folder is a folder. Internal note links are saved as standard Markdown links, even when you type familiar wiki-link syntax. This keeps the vault readable by other editors, static-site tools, scripts, and version-control systems.",
          "Riffle also preserves YAML frontmatter written by other tools. Properties are added only when you explicitly use the properties interface; the app does not inject metadata into every note automatically.",
        ],
      },
      {
        heading: "Organization without a database",
        paragraphs: [
          "Full-text search, tabs, backlinks, quick capture, daily notes, todos, bookmarks, and pinned items add structure around the files. App-specific supporting data lives beside the vault in its .markd folder rather than changing the meaning of each Markdown document.",
          "The result is a notes system that can grow more capable without making your writing dependent on one vendor’s database format.",
        ],
      },
    ],
    faqs: [
      {
        question: "Is Markdown source mode read-only?",
        answer:
          "No. Source mode is an editable CodeMirror view, and changes are saved back to the same Markdown file.",
      },
      {
        question: "Does Riffle add frontmatter to every note?",
        answer:
          "No. Existing frontmatter is preserved, and Riffle authors properties only after an explicit action in the properties interface.",
      },
    ],
  },
  {
    slug: "markdown-notes-macos",
    title: "A Markdown notes app built for macOS",
    shortTitle: "Markdown notes for macOS",
    description:
      "Use plain Markdown notes on Apple Silicon Macs with a signed, notarized desktop app, quick capture, keyboard navigation, and Finder access.",
    eyebrow: "Riffle for macOS",
    publishedAt: "2026-07-19",
    updatedAt: "2026-07-19",
    takeaways: [
      "Native desktop packaging for Apple Silicon and macOS 12 or newer.",
      "Developer ID signed and notarized releases.",
      "Global quick capture and Finder-friendly vaults.",
    ],
    sections: [
      {
        heading: "A desktop app around files you control",
        paragraphs: [
          "Riffle runs as a desktop application while keeping the vault in a folder you select. You can reveal a note or folder in Finder, use your existing backup workflow, and inspect or edit the Markdown with other Mac tools whenever you want.",
          "The current macOS build supports Apple Silicon Macs running macOS 12 or newer. Releases are signed with a Developer ID certificate and notarized by Apple before distribution.",
        ],
      },
      {
        heading: "Capture and navigate from the keyboard",
        paragraphs: [
          "A global Quick Capture window can save a thought without first finding the main Riffle window. Inside the app, the command palette, customizable shortcuts, quick search, tabs, daily notes, and focus controls reduce the amount of pointer travel needed to work through a vault.",
          "Because the result is still a Markdown file, fast capture does not create an inbox that can only be processed inside a proprietary service.",
        ],
      },
      {
        heading: "Install and keep Riffle current",
        paragraphs: [
          "The macOS download is distributed as a DMG. Move Riffle to Applications, open a new or existing vault, and the app can check signed update metadata for later releases.",
          "Riffle is currently built for Apple Silicon. An Intel macOS build is not listed, so Intel Mac users should not assume compatibility with the current download.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does Riffle support Intel Macs?",
        answer:
          "The current published macOS build targets Apple Silicon. Riffle lists macOS 12 or newer as the supported system version.",
      },
      {
        question: "Is the macOS app notarized?",
        answer:
          "Yes. Published macOS releases are Developer ID signed and notarized by Apple.",
      },
    ],
  },
  {
    slug: "obsidian-compatible-markdown-editor",
    title: "Use Riffle with an existing Obsidian vault",
    shortTitle: "Riffle and Obsidian vaults",
    description:
      "Understand which Markdown, folders, links, and frontmatter Riffle can share with an Obsidian vault, and where app-specific differences remain.",
    eyebrow: "Vault compatibility",
    publishedAt: "2026-07-19",
    updatedAt: "2026-08-05",
    takeaways: [
      "Point Riffle at a folder of existing Markdown notes.",
      "Real folders and YAML frontmatter remain portable.",
      "Plugin data, themes, and app settings are not interchangeable.",
    ],
    sections: [
      {
        heading: "What the two apps can share",
        paragraphs: [
          "Both Riffle and Obsidian can work with folders of Markdown files. That common foundation means an existing vault does not need to be imported into a new database before Riffle can read it. Filenames, folders, Markdown content, standard links, and common YAML frontmatter remain visible on disk.",
          "Riffle's Readonly View resolves wiki-link syntax alongside standard Markdown links without rewriting the source. You should still test link behavior on a copy if your vault relies on unusual aliases, embeds, or plugin-defined syntax.",
        ],
      },
      {
        heading: "What is not automatically compatible",
        paragraphs: [
          "A shared file format does not make two applications identical. Obsidian plugins, themes, workspace state, graph settings, and files inside its app-specific configuration folder do not become Riffle features. Likewise, Riffle’s todos, bookmarks, and local app state are not Obsidian plugins.",
          "Markdown extensions can also render differently. Back up the vault and review representative notes, especially complex embeds, callouts, plugin queries, and custom HTML, before adopting a two-app workflow.",
        ],
      },
      {
        heading: "A safe way to try the same vault",
        paragraphs: [
          "Start with a backup or a small copy of the vault. Open it in Riffle, inspect folders and frontmatter, follow internal links, and compare a few notes in both editors. Keep only the syntax and features that both applications interpret the way you expect.",
          "If the vault uses mostly standard Markdown, links, images, and flat frontmatter, the file-based model makes experimentation straightforward and reversible.",
        ],
      },
    ],
    faqs: [
      {
        question: "Does Riffle import an Obsidian vault?",
        answer:
          "There is no database import. You select the folder containing the Markdown files and Riffle reads that folder as a vault.",
      },
      {
        question: "Will every Obsidian plugin feature work in Riffle?",
        answer:
          "No. Plugin-defined syntax and application-specific settings are not guaranteed to work. Standard Markdown and simple frontmatter are the most portable parts of a vault.",
      },
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
