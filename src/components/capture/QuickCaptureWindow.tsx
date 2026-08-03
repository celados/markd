import {
  LuCornerDownLeft as CornerDownLeft,
  LuFeather as Feather,
  LuX as X,
} from "@/icons/icons.tsrx";
import { motion } from "@octanejs/motion";
import { useCallback, useEffect, useRef, useState } from "octane";
import { toast, Toaster } from "@octanejs/sonner";
import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { onQuickCaptureOpen, unwrapDesktopResult } from "@/lib/desktop";
import { EASE_OUT } from "@/lib/ease";
import { applyTheme } from "@/lib/theme";

type CaptureMode = "create" | "append";

async function syncCaptureTheme(): Promise<void> {
  if (window.markd) {
    const result = await window.markd.vault.snapshot();
    applyTheme(result.ok ? result.value.theme : "system");
    return;
  }
  applyTheme(await ipc.getTheme());
}

export function QuickCaptureWindow() {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode>("create");
  const [openNonce, setOpenNonce] = useState(0);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);

  const reset = useCallback(() => {
    if (savingRef.current) return;
    void syncCaptureTheme();
    setOpenNonce((nonce) => nonce + 1);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  useEffect(() => {
    void syncCaptureTheme();
    return onQuickCaptureOpen(reset);
  }, [reset]);

  const close = useCallback(async () => {
    if (savingRef.current) return;
    try {
      await ipc.closeQuickCapture();
      setTitle("");
      setValue("");
      setMode("create");
    } catch (error) {
      toast.error("Quick Capture could not close", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const save = async () => {
    const noteTitle = title.trim();
    const markdown = value.trim();
    const invalid =
      mode === "create"
        ? !noteTitle && !markdown
        : !noteTitle || !markdown;
    if (invalid || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    try {
      if (!window.markd) {
        await ipc.createNoteWithContent("", noteTitle || "Quick note", markdown);
      } else if (mode === "create") {
        await unwrapDesktopResult(
          window.markd.capture.create(noteTitle || "Quick note", markdown),
        );
      } else {
        await unwrapDesktopResult(window.markd.capture.append(noteTitle, markdown));
      }
    } catch (error) {
      savingRef.current = false;
      setSaving(false);
      const message = error instanceof Error ? error.message : String(error);
      setFailure(message);
      toast.error("Note could not be captured", {
        description: message,
      });
      return;
    }

    setTitle("");
    setValue("");
    setMode("create");
    try {
      await ipc.closeQuickCapture();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure(`The Note was saved, but Quick Capture could not close: ${message}`);
      toast.error("Note saved, but Quick Capture could not close", {
        description: message,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <motion.main
      key={openNonce}
      initial={{ opacity: 0, y: 6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.14, ease: EASE_OUT }}
      className="h-full overflow-hidden border border-line bg-bg shadow-2xl shadow-black/20 dark:shadow-black/60"
    >
      <header className="window-drag flex items-center gap-3 px-4 pb-2 pt-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-panel text-muted">
          <Feather size={15} strokeWidth={1.8} />
        </div>
        <div className="pointer-events-none">
          <h1 className="text-[14px] font-semibold tracking-[-0.01em]">Quick capture</h1>
          <p className="mt-0.5 text-[11.5px] text-faint">Save a thought without leaving your flow</p>
        </div>
        <button
          type="button"
          aria-label="Close Quick Capture"
          onClick={() => void close()}
          className="window-no-drag ml-auto grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </header>
      <div className="px-4 pb-4">
        <div className="mb-2 flex w-fit rounded-lg bg-panel p-0.5" role="group" aria-label="Capture mode">
          {(["create", "append"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-label={candidate === "create" ? "Create new note" : "Append to note"}
              aria-pressed={mode === candidate}
              disabled={saving}
              onClick={() => setMode(candidate)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] capitalize transition-colors ${mode === candidate ? "bg-invert text-invert-ink" : "text-muted hover:text-ink"}`}
            >
              {candidate}
            </button>
          ))}
        </div>
        <input
          ref={titleRef}
          disabled={saving}
          value={title}
          onInput={(event) => setTitle(event.currentTarget.value)}
          placeholder={mode === "create" ? "Title" : "Note path (for example Inbox.md)"}
          className="mb-2 h-10 w-full rounded-xl bg-panel px-3.5 text-[14px] font-medium text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-line"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) void save();
            else textareaRef.current?.focus();
          }}
        />
        <textarea
          ref={textareaRef}
          disabled={saving}
          value={value}
          onInput={(event) => setValue(event.currentTarget.value)}
          placeholder="Write something worth keeping…"
          rows={4}
          className="w-full resize-none rounded-xl bg-panel px-3.5 py-3 text-[14px] leading-6 text-ink outline-none placeholder:text-faint focus:ring-1 focus:ring-line"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          {failure ? (
            <span role="alert" className="max-w-72 truncate text-[11px] text-danger">
              {failure}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-faint">
              <span className="flex items-center gap-0.5 rounded border border-line px-1.5 py-0.5 font-mono">
                ⌘ <CornerDownLeft size={10} strokeWidth={2} />
              </span>
              to save
            </span>
          )}
          <Button
            size="sm"
            aria-label={mode === "create" ? "Create captured note" : "Append capture"}
            disabled={
              (mode === "create"
                ? !title.trim() && !value.trim()
                : !title.trim() || !value.trim()) || saving
            }
            loading={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : mode === "create" ? "Save note" : "Append"}
          </Button>
        </div>
      </div>
      <Toaster position="top-center" offset={12} />
    </motion.main>
  );
}
