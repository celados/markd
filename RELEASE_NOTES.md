# Riffle 0.4.0

Riffle 0.4.0 makes plain Markdown the only Note body source of truth. The former rich-text editor is gone; Readonly View renders through Comark, while Source Editor and Properties remain editable.

## Changed

- Replace the Tiptap reading and editing surface with a Comark-backed Readonly View.
- Remove all Tiptap and ProseMirror runtime packages, source paths, and compatibility machinery.
- Keep CodeMirror Source Editor, editable YAML Properties, Quick Capture, external Note changes, and autosave behavior intact.
- Preserve vault-relative Note links, wiki links, local assets, embedded markup policy, code copy, task display, and Readonly find.

## Fixed

- Converge Property edits, Source edits, and external or agent writes on the latest committed Markdown without losing newer changes.
- Keep the last valid Note view visible when a render update fails, with an explicit error for invalid static content.

## Supported platform

This release supports macOS on Apple Silicon (`arm64`). Intel macOS, Windows, and Linux are not release targets.
