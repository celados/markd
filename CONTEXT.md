# Riffle

Riffle is a local-first knowledge workspace whose durable source of truth is a user-selected folder of portable Markdown files. Product language describes user-visible data and behavior independently of the current desktop runtime.

## Language

**Vault**:
The user-selected folder whose Markdown files and real subfolders form one Riffle knowledge workspace.
_Avoid_: Repository, project, workspace root

**Note**:
A Markdown file inside a Vault, identified by its Vault-relative path rather than an application-generated ID.
_Avoid_: Document record, page entity

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
A lightweight entry surface that creates or appends Note content without requiring navigation through the main window.
_Avoid_: Mini editor, secondary app

**Published Share**:
A remote, revocable representation of selected Note content. The Note in the Vault remains the authoring source of truth.
_Avoid_: Cloud note, synchronized note
