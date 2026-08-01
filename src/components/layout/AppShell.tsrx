import {
  LuCheck as Check,
  LuCode2 as Code2,
  LuCopy as Copy,
  LuDownload as Download,
  LuFilePlus as FilePlus,
  LuFolderOpen as FolderOpen,
  LuGlobe2 as Globe2,
  LuListPlus as ListPlus,
  LuMoreVertical as MoreVertical,
  LuPanelLeft as PanelLeft,
  LuPin as Pin,
  LuPinOff as PinOff,
  LuPilcrow as Pilcrow,
  LuSearch as Search,
  LuTag as Tag,
  LuTrash2 as Trash2,
  LuX as X,
} from "@/icons/icons.tsrx";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "@octanejs/motion";
import { type OctaneNode, useEffect, useRef, useState } from "octane";
import { toast } from "@octanejs/sonner";
import {
  BacklinksSidebar,
  BacklinksToggle,
} from "@/components/editor/BacklinksSidebar";
import { NoteBreadcrumb } from "@/components/editor/NoteBreadcrumb.tsrx";
import { NotesWorkspace } from "@/components/editor/NotesWorkspace.tsrx";
import { TabBar } from "@/components/editor/TabBar.tsrx";
import { BookmarksPage } from "@/components/bookmarks/BookmarksPage.tsrx";
import { TodosPage } from "@/components/todos/TodosPage.tsrx";
import { EASE_OUT, SPRING_LAYOUT, SPRING_PANEL } from "@/lib/ease";
import { ipc } from "@/lib/ipc";
import { cx, isMac } from "@/lib/utils";
import {
  ActionSwapIcon,
  ActionSwapText,
} from "@/components/motion/action-swap.tsrx";
import { MorphPopover } from "@/components/motion/popover-morph.tsrx";
import { ResizableSidebar } from "./ResizableSidebar";
import { Sidebar } from "./Sidebar.tsrx";
import { CopyButton } from "@/components/ui/CopyButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { useBookmarks } from "@/stores/bookmarks";
import { useTodos } from "@/stores/todos";
import { usePins } from "@/stores/pins";
import { useUi } from "@/stores/ui";
import { useVault } from "@/stores/vault";

/** Absolute on-disk path for the current view — handy to hand to an agent. */
function viewPath(
  root: string,
  view: ReturnType<typeof useVault.getState>["view"],
): string | null {
  if (!root || !view) return null;
  if (view.type === "note") return `${root}/${view.rel}`;
  if (view.type === "todos") return `${root}/.markd/todos.json`;
  if (view.type === "bookmarks") return `${root}/.markd/bookmarks.json`;
  return null;
}

export function AppShell() @{
  const view = useVault((s) => s.view);
  const root = useVault((s) => s.root);
  const sidebarHidden = useUi((s) => s.sidebarHidden);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const backlinksHidden = useUi((s) => s.backlinksHidden);
  const markdownSource = useUi((s) => s.markdownSource);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);
  const toggleBacklinks = useUi((s) => s.toggleBacklinks);
  const toggleMarkdownSource = useUi((s) => s.toggleMarkdownSource);
  const createBookmarkTag = useBookmarks((s) => s.createTag);
  const exportBookmarks = useBookmarks((s) => s.exportAll);
  const createTodoTag = useTodos((s) => s.createTag);
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);
  const [noteMenuOpen, setNoteMenuOpen] = useState(false);
  const [publishedByRel, setPublishedByRel] = useState<Record<string, boolean>>(
    {},
  );
  const [cloudSignedIn, setCloudSignedIn] = useState(false);

  const path = viewPath(root, view);
  const noteRel = view?.type === "note" ? view.rel : null;
  const notePublished = noteRel
    ? cloudSignedIn && publishedByRel[noteRel] === true
    : false;

  useEffect(() => {
    if (!noteRel) return;
    let disposed = false;
    void Promise.all([ipc.isNotePublished(noteRel), ipc.cloudAccountStatus()]).then(
      ([published, status]) => {
        if (disposed) return;
        setPublishedByRel((current) => ({ ...current, [noteRel]: published }));
        setCloudSignedIn(Boolean(status.account));
      },
      (error) => {
        if (disposed) return;
        toast.error("Publish status could not be loaded", {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      disposed = true;
    };
  }, [noteRel]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ signedIn?: boolean }>).detail;
      if (typeof detail?.signedIn !== "boolean") return;
      setCloudSignedIn(detail.signedIn);
    };
    window.addEventListener("markd:cloud-account", update);
    return () => window.removeEventListener("markd:cloud-account", update);
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (
        event as CustomEvent<{ rel?: string; published?: boolean }>
      ).detail;
      if (!detail?.rel || typeof detail.published !== "boolean") return;
      setPublishedByRel((current) => ({
        ...current,
        [detail.rel as string]: detail.published as boolean,
      }));
    };
    window.addEventListener("markd:publish-status", update);
    return () => window.removeEventListener("markd:publish-status", update);
  }, []);

  <div className="flex h-full bg-bg">
      <ResizableSidebar
        hidden={sidebarHidden}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      >
        <Sidebar />
      </ResizableSidebar>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Row 1 — titlebar: sidebar toggle + open-note tabs. The strip is
            recessed (panel); the active tab takes the content bg so it reads
            as merged with the pane below, code-editor style. */}
        <motion.div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-stretch gap-1.5 bg-sunken pr-3"
          animate={{ paddingLeft: sidebarHidden ? 84 : 10 }}
          initial={false}
          transition={SPRING_PANEL}
        >
          <div className="flex shrink-0 items-center">
            <Tooltip label={"Toggle sidebar ⌘\\"} side="right">
              <button
                type="button"
                onClick={toggleSidebar}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <PanelLeft size={15.5} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
          <TabBar />
        </motion.div>

        {/* Row 2 — current view title + right-side actions. */}
        <div className="flex h-10 bg-transparent shrink-0 items-center px-3">
          @if (view?.type === "note") {
            <NoteBreadcrumb rel={view.rel} />
          } @else {
            <ActionSwapText
              value={view?.type ?? "none"}
              text={
                view?.type === "todos"
                  ? "Todos"
                  : view?.type === "bookmarks"
                    ? "Bookmarks"
                    : ""
              }
              animation="cascade"
              className="text-[14px] font-semibold text-ink"
            />
          }
            <div className="ml-auto flex items-center gap-2">
              @if (view?.type === "note") {
                <BacklinksToggle
                  open={!backlinksHidden}
                  onToggle={toggleBacklinks}
                />
              }
              @if (view?.type === "note") {
                <Tooltip
                  label={markdownSource ? "Show rich editor" : "Show Markdown source"}
                  side="bottom"
                >
                  <button
                    type="button"
                    aria-label={
                      markdownSource
                        ? "Show rich editor"
                        : "Show Markdown source"
                    }
                    aria-pressed={markdownSource}
                    onClick={toggleMarkdownSource}
                    className={cx(
                      "grid h-7 w-7 place-items-center rounded-md border transition-[color,background-color,border-color,transform] duration-100 active:scale-[0.96]",
                      markdownSource
                        ? "border-line-soft bg-invert text-invert-ink"
                        : "border-line-soft bg-hover text-muted hover:bg-active hover:text-ink",
                    )}
                  >
                    <ActionSwapIcon
                      value={markdownSource ? "rich" : "markdown"}
                      animation="roll"
                      className="h-[15px] w-[15px]"
                      icon={
                        markdownSource ? (
                          <Pilcrow size={15} strokeWidth={1.9} />
                        ) : (
                          <Code2 size={15} strokeWidth={1.9} />
                        )
                      }
                    />
                  </button>
                </Tooltip>
              }
              @if (view?.type === "note") {
                <button
                  type="button"
                  onClick={() => dispatchNoteAction("publish")}
                  className={cx(
                    "inline-flex h-7 select-none items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors duration-100",
                    notePublished
                      ? "border-success/10 bg-success-bg text-success hover:brightness-95"
                      : "border-line-soft bg-hover text-ink hover:bg-active",
                  )}
                >
                  <Globe2 size={13} strokeWidth={1.9} />
                  {notePublished ? "This page is live" : "Publish"}
                </button>
              }
              @if (path && view?.type !== "note") {
                <motion.div layout transition={SPRING_LAYOUT}>
                  <CopyButton
                    value={path}
                    text="Copy path"
                    copiedText="Copied"
                  />
                </motion.div>
              }
              @if (view?.type === "bookmarks") {
                <>
                  <Tooltip label="Export as markdown" side="bottom">
                    <button
                      type="button"
                      onClick={exportBookmarks}
                      className="inline-flex h-7 select-none items-center gap-1.5 rounded-md border border-line bg-hover px-2.5 text-[12.5px] font-medium text-ink transition-colors duration-100 hover:bg-active"
                    >
                      <Download size={13} strokeWidth={2} />
                      Export
                    </button>
                  </Tooltip>
                  <NewTagButton onCreate={createBookmarkTag} />
                </>
              }
              @if (view?.type === "todos") {
                <NewTagButton onCreate={createTodoTag} />
              }
              @if (view?.type === "note") {
                <MorphPopover
                  open={noteMenuOpen}
                  onOpenChange={setNoteMenuOpen}
                  align="end"
                  sideOffset={6}
                  radius={10}
                  ariaLabel="Note actions"
                  contentClassName="w-48 bg-bg p-1"
                  trigger={
                    <button
                      type="button"
                      aria-label="Note actions"
                      className="grid h-7 w-7 place-items-center rounded-md border border-line-soft bg-hover text-muted transition-colors duration-100 hover:bg-active hover:text-ink"
                    >
                      <MoreVertical size={15} strokeWidth={2} />
                    </button>
                  }
                  content={
                    <NoteMenuContent
                      pinned={pins.includes(noteRel!)}
                      rel={noteRel!}
                      markdownSource={markdownSource}
                      onClose={() => setNoteMenuOpen(false)}
                      onTogglePin={() => void togglePin(noteRel!)}
                      onToggleMarkdownSource={toggleMarkdownSource}
                    />
                  }
                />
              }
            </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {/* Workspace stays mounted (hidden) across view switches — open
              tabs keep their live editors, so returning to notes is instant. */}
          <NotesWorkspace visible={view?.type === "note"} />
          @if (view?.type === "todos") {
            <div className="absolute inset-0">
              <TodosPage />
            </div>
          }
          @if (view?.type === "bookmarks") {
            <div className="absolute inset-0">
              <BookmarksPage />
            </div>
          }
          @if (!view) {
            <EmptyState />
          }
        </div>
      </main>

      <BacklinksSidebar
        rel={view?.type === "note" ? view.rel : null}
        open={!backlinksHidden}
        onClose={toggleBacklinks}
      />
  </div>
}

type NoteAction =
  | "find"
  | "add-property"
  | "publish"
  | "export"
  | "copy"
  | "delete";

function dispatchNoteAction(action: NoteAction) {
  window.dispatchEvent(
    new CustomEvent("markd:note-action", { detail: { action } }),
  );
}

type NoteMenuButtonProps = {
  icon: typeof Download;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

function NoteMenuContent(props: {
  pinned: boolean;
  rel: string;
  markdownSource: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMarkdownSource: () => void;
}) @{
  const {
    pinned,
    rel,
    markdownSource,
    onClose,
    onTogglePin,
    onToggleMarkdownSource,
  } = props;

  <>
    <NoteMenuButton
      icon={pinned ? PinOff : Pin}
      label={pinned ? "Unpin note" : "Pin note"}
      onClick={() => {
        onClose();
        onTogglePin();
      }}
    />
    <NoteMenuButton
      icon={ListPlus}
      label="Add property"
      onClick={() => {
        onClose();
        if (markdownSource) onToggleMarkdownSource();
        dispatchNoteAction("add-property");
      }}
    />
    <div className="mx-1 my-1 border-t border-line-soft" />
    <NoteMenuButton
      icon={Copy}
      label="Copy path"
      onClick={() => {
        onClose();
        void ipc.notePath(rel).then(
          (path) =>
            navigator.clipboard.writeText(path).then(
              () => toast("Path copied"),
              () => toast.error("Path could not be copied"),
            ),
          () => toast.error("Path could not be resolved"),
        );
      }}
    />
    <NoteMenuButton
      icon={FolderOpen}
      label={isMac() ? "Reveal in Finder" : "Reveal in File Manager"}
      onClick={() => {
        onClose();
        void ipc.notePath(rel).then(
          (path) =>
            revealItemInDir(path).catch((error) =>
              toast.error("Could not reveal note", {
                description:
                  error instanceof Error ? error.message : String(error),
              }),
            ),
          () => toast.error("Path could not be resolved"),
        );
      }}
    />
    <div className="mx-1 my-1 border-t border-line-soft" />
    <NoteMenuButton
      icon={Download}
      label="Export as Markdown"
      onClick={() => {
        onClose();
        dispatchNoteAction("export");
      }}
    />
    <NoteMenuButton
      icon={Copy}
      label="Copy Markdown"
      onClick={() => {
        onClose();
        dispatchNoteAction("copy");
      }}
    />
    <div className="mx-1 my-1 border-t border-line-soft" />
    <NoteMenuButton
      icon={Trash2}
      label="Delete note"
      danger
      onClick={() => {
        onClose();
        dispatchNoteAction("delete");
      }}
    />
  </>
}

function NoteMenuButton(props: NoteMenuButtonProps) @{
  const { icon: Icon, label, danger = false, onClick } = props;

  <button
      type="button"
      data-morph-item
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-100",
        danger
          ? "text-danger hover:bg-danger/8"
          : "text-ink hover:bg-hover",
      )}
    >
      <Icon size={14} strokeWidth={1.75} />
      {label}
  </button>
}

type NewTagButtonProps = {
  onCreate: (name: string) => void;
};

function NewTagButton(props: NewTagButtonProps) @{
  const { onCreate } = props;
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commit = () => {
    const value = inputRef.current?.value.trim();
    if (value) onCreate(value);
    setOpen(false);
  };

  <div>
      {/* Single morphing pill: the container reshapes (layout spring) while its
          contents cross-fade, so button → input feels like one object. */}
      <motion.div
        layout
        transition={SPRING_LAYOUT}
        className="flex h-7 items-center overflow-hidden rounded-md border border-line bg-hover"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          @if (open) {
            <motion.div
              key="form"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: EASE_OUT }}
              className="flex items-center pl-2 pr-1"
            >
              <input
                ref={inputRef}
                placeholder="Tag name…"
                className="w-28 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                  if (event.key === "Escape") setOpen(false);
                }}
              />
              <Tooltip label="Save ↵" side="bottom">
                <button
                  type="button"
                  onClick={commit}
                  className="grid h-5 w-5 place-items-center rounded text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
                >
                  <Check size={13} strokeWidth={2.25} />
                </button>
              </Tooltip>
              <Tooltip label="Cancel esc" side="bottom">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-5 w-5 place-items-center rounded text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
                >
                  <X size={13} strokeWidth={2.25} />
                </button>
              </Tooltip>
            </motion.div>
          } @else {
            <motion.button
              key="button"
              layout
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: EASE_OUT }}
              onClick={() => setOpen(true)}
              className="flex h-7 select-none items-center gap-1.5 px-2.5 text-[12.5px] font-medium text-ink transition-colors duration-100 hover:bg-hover"
            >
              <Tag size={13} strokeWidth={2} />
              New tag
            </motion.button>
          }
        </AnimatePresence>
      </motion.div>
  </div>
}

function HashMark() @{
  <div className="grid h-16 w-16 place-items-center rounded-2xl border border-line-soft bg-panel">
      <svg width="34" height="34" viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
        <g
          stroke="var(--faint)"
          strokeWidth="84"
          strokeLinecap="round"
        >
          <line x1="390" y1="280" x2="390" y2="744" />
          <line x1="634" y1="280" x2="634" y2="744" />
          <line x1="280" y1="390" x2="744" y2="390" />
          <line x1="280" y1="634" x2="744" y2="634" />
        </g>
      </svg>
  </div>
}

type EmptyActionProps = {
  icon: OctaneNode;
  label: string;
  keys: string;
  onClick: () => void;
};

function EmptyAction(props: EmptyActionProps) @{
  const { icon, label, keys, onClick } = props;

  <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
    >
      {icon}
      {label}
      <kbd className="ml-1 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10.5px] text-faint">
        {keys}
      </kbd>
  </button>
}

function EmptyState() @{
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const createNote = useVault((s) => s.createNote);

  <div className="flex h-full flex-col items-center justify-center gap-6 pb-24">
      <HashMark />
      <div className="text-center">
        <p className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
          Nothing open yet
        </p>
        <p className="mt-1 text-[13px] text-faint">
          Jump to a note, or start something new.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <EmptyAction
          icon={<Search size={14} strokeWidth={2} />}
          label="Search"
          keys="⌘K"
          onClick={() => setPaletteOpen(true)}
        />
        <EmptyAction
          icon={<FilePlus size={14} strokeWidth={2} />}
          label="New note"
          keys="⌘N"
          onClick={() => createNote("")}
        />
      </div>
  </div>
}
