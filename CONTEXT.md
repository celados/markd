# Riffle

Riffle is a local-first knowledge workspace whose durable source of truth is a user-selected folder of portable Markdown files. Product language describes user-visible data and behavior independently of the current desktop runtime.

## Language

**Vault**:
The user-selected folder whose Markdown files and real subfolders form one Riffle knowledge workspace.
_Avoid_: Repository, project, workspace root

**Note**:
A Markdown file inside a Vault, identified by its Vault-relative path rather than an application-generated ID.
_Avoid_: Document record, page entity

**Note Title**:
The user-facing filename stem of a Note. Editing the title renames the Note within its current Vault folder; it is not a frontmatter field or body mutation.
_Avoid_: Frontmatter title, document heading

**Readonly View**:
A rendered, non-editable projection of a mutable Note. It constrains only this view: the Note can still change through a source editor, Quick Capture, an agent, or an external tool.
_Avoid_: Read-only Note, editor

**Source Editor**:
The editable view of a Note's raw Markdown source. It is distinct from the Readonly View and does not provide rich-text or WYSIWYG editing.
_Avoid_: Rich-text editor, Tiptap mode

**Properties Editor**:
The structured, editable projection of a Note's frontmatter. It owns frontmatter mutations only and must not rewrite the Note body from a stale snapshot.
_Avoid_: Body editor, metadata database

**Embedded Markup**:
HTML syntax inside a Note body that the Readonly View renders through an explicit element, attribute, and resource policy. It is document markup, not executable application code.
_Avoid_: Trusted HTML, embedded app

**Riffle Markdown**:
The Note body dialect: CommonMark and GFM plus wiki links, Vault-relative assets, and Embedded Markup. MDX, executable HTML, Comark components, Mermaid, math, and agent-native UI components are not part of the current dialect.
_Avoid_: Comark syntax, MDX

**Markdown Stream**:
The ordered in-memory cumulative snapshots for one in-progress Markdown output, identified by a stream ID. It does not pass through the Vault file-change path; provider chunks are accumulated before this boundary, and a non-prefix snapshot is a correction that requires full reparse.
_Avoid_: Token stream, parser chunks

**Persisted Note Update**:
A body or frontmatter change committed to the Vault file by the Source Editor, Properties Editor, an agent, or an external tool. The Readonly View refreshes from the latest accepted Note source rather than an editor-local body snapshot.
_Avoid_: Preview patch, editor transaction

**Vault App Data**:
Riffle-owned data stored below `<vault>/.markd/`, including collections and pasted assets; it is not part of the user's Note tree. The directory name is a stable on-disk format identifier, not the product name.
_Avoid_: Hidden notes, internal vault

**Vault Index**:
The live, ignore-aware projection of searchable Notes and folders in a Vault. It is derived from disk and can always be rebuilt.
_Avoid_: Database, file cache

**Vault Snapshot**:
A coherent point-in-time view used to initialize the application after opening a Vault.
_Avoid_: Initial payload, tree response

**Vault Change**:
A normalized creation, modification, move, or removal that has already been accepted into the Vault Index.
_Avoid_: Raw filesystem event, watcher event

**Pin**:
A user-maintained shortcut to an existing Note or folder; it does not move or duplicate the target.
_Avoid_: Favorite copy, pinned note record

**Collection**:
Riffle-owned structured items stored in Vault App Data, currently Todos and Bookmarks.
_Avoid_: Note metadata, database table

**Quick Capture**:
A lightweight shortcut for creating a new Note without navigating through the main window.
_Avoid_: Mini editor, secondary app

**Published Share**:
A remote, revocable representation of selected Note content. The Note in the Vault remains the authoring source of truth.
_Avoid_: Cloud note, synchronized note
