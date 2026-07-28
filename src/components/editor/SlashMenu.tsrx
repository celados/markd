import type { Editor } from "@octanejs/tiptap";
import type { IconComponent } from "@/icons/icon-types";
import {
  LuCode as Code,
  LuHeading1 as Heading1,
  LuHeading2 as Heading2,
  LuHeading3 as Heading3,
  LuLink2 as Link2,
  LuList as List,
  LuListOrdered as ListOrdered,
  LuListTodo as ListTodo,
  LuMinus as Minus,
  LuPilcrow as Pilcrow,
  LuTable as Table,
  LuTextQuote as TextQuote,
} from "@/icons/icons.tsrx";
import { motion } from "@octanejs/motion";
import { useEffect, useMemo, useRef, useState } from "octane";
import { cx } from "@/lib/utils";

export type SlashMenuState = {
  query: string;
  range: { from: number; to: number };
  position: { left: number; top: number };
  side: "top" | "bottom";
};

type SlashCommand = {
  id: string;
  label: string;
  icon: IconComponent;
  keywords: string;
  /** Edit to run on select. Omitted for special commands (e.g. note link). */
  run?: (editor: Editor) => void;
};

const commands: SlashCommand[] = [
  {
    id: "note-link",
    label: "Link to note",
    icon: Link2,
    keywords: "page link reference mention connect",
  },
  {
    id: "text",
    label: "Text",
    icon: Pilcrow,
    keywords: "paragraph plain",
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: "h1",
    label: "Heading 1",
    icon: Heading1,
    keywords: "title big",
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    icon: Heading2,
    keywords: "subtitle section",
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    icon: Heading3,
    keywords: "subheading",
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "Bullet list",
    icon: List,
    keywords: "unordered ul",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered list",
    icon: ListOrdered,
    keywords: "ordered ol",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "Task list",
    icon: ListTodo,
    keywords: "todo checkbox check",
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "quote",
    label: "Quote",
    icon: TextQuote,
    keywords: "blockquote",
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "Code block",
    icon: Code,
    keywords: "snippet pre fence",
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    icon: Minus,
    keywords: "rule hr line separator",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Table",
    icon: Table,
    keywords: "grid rows columns",
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

type SlashMenuProps = {
  editor: Editor | null;
  menu: SlashMenuState | null;
  onClose: () => void;
  onLinkToNote: (range: { from: number; to: number }) => void;
};

export function SlashMenu(props: SlashMenuProps) @{
  const { editor, menu, onClose, onLinkToNote } = props;
  const [selected, setSelected] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const query = menu?.query.toLowerCase().trim() ?? "";
    if (!query) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords}`.toLowerCase().includes(query),
    );
  }, [menu?.query]);

  useEffect(() => setSelected(0), [menu?.query]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!menu || !editor) return;
    const execute = (command: SlashCommand) => {
      // The note-link command hands off to the picker, which owns deleting
      // the "/…" range and inserting the link.
      if (command.id === "note-link") {
        onLinkToNote(menu.range);
        onClose();
        return;
      }
      editor.chain().focus().deleteRange(menu.range).run();
      command.run?.(editor);
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === " ") {
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length === 0) return;
        setSelected((i) => (i + 1) % filtered.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length === 0) return;
        setSelected((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = filtered[selected];
        if (command) execute(command);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editor, filtered, menu, onClose, onLinkToNote, selected]);

  if (!menu || !editor || filtered.length === 0) return null;
  // Position is materialized before keyed rendering to avoid compiler issue #333.
  const visibleCommands = filtered.map((command, index) => ({
    command,
    icon: command.icon,
    index,
  }));

  <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: menu.side === "bottom" ? -4 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="fixed z-90 max-h-[264px] w-[208px] overflow-y-auto rounded-lg border border-line bg-bg p-1 shadow-lg shadow-black/8 dark:shadow-black/40"
      style={{ left: menu.position.left, top: menu.position.top }}
    >
      @for (const item of visibleCommands; key item.command.id) {
        <button
          type="button"
          data-selected={item.index === selected}
          className={cx(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-75",
            item.index === selected ? "bg-hover text-ink" : "text-muted",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            if (item.command.id === "note-link") {
              onLinkToNote(menu.range);
              onClose();
              return;
            }
            editor.chain().focus().deleteRange(menu.range).run();
            item.command.run?.(editor);
            onClose();
          }}
          onMouseEnter={() => setSelected(item.index)}
        >
          <item.icon size={14.5} strokeWidth={1.75} className="shrink-0" />
          {item.command.label}
        </button>
      }
    </motion.div>
}
