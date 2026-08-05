import { memo, useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { toast } from "@octanejs/sonner";
import { NOTES_REWRITTEN, notifyBacklinksChanged } from "@/lib/backlinks";
import {
  VAULT_NOTE_CHANGED,
  type VaultNoteChangedDetail,
} from "@/lib/vault-note-events";
import { vaultDesktop } from "@/lib/desktop-services";
import { openWebUrl } from "@/lib/desktop";
import { invalidatePublishStatus } from "@/lib/queryClient";
import {
  joinFrontmatter,
  parseFrontmatter,
  removeFrontmatterProperty,
  splitFrontmatter,
  type Property,
  upsertFrontmatterProperty,
} from "@/lib/frontmatter";
import { decideExternalNoteChange } from "@/lib/editor-conflict";
import { registerNoteWriteFlush } from "@/lib/note-write-barrier";
import { hrefToRel } from "@/lib/noteLinks";
import { cx, debounce, noteTitle } from "@/lib/utils";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";
import { useVault } from "@/stores/vault";
import { rebaseAppendOnly, SerialNoteWrites } from "@/lib/serial-note-writes";
import { ReadonlyMarkdownView } from "@/markdown/readonly-markdown-view";
import { FindReplaceBar } from "./FindReplaceBar.tsrx";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { NoteProperties } from "./NoteProperties.tsrx";
import { PublishNoteModal } from "./PublishNoteModal.tsrx";
import { TitleInput } from "./TitleInput";
import { useNoteFindReplace } from "./useNoteFindReplace";

type NoteEditorProps = {
  rel: string;
  active?: boolean;
};

function NoteEditorComponent(props: NoteEditorProps) @{
  const { rel, active = true } = props;
  const renameEntry = useVault((state) => state.renameEntry);
  const setSaveState = useUi((state) => state.setSaveState);
  const markdownSource = useUi((state) => state.markdownSource);
  const [rawText, setRawText] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyAddRequest, setPropertyAddRequest] = useState(0);
  const [missing, setMissing] = useState(false);
  const [preserveMissingDraft, setPreserveMissingDraft] = useState(false);
  const [words, setWords] = useState(0);
  const [publishSnapshot, setPublishSnapshot] = useState<{
    rel: string;
    markdown: string;
  } | null>(null);

  const relRef = useRef(rel);
  const activeRef = useRef(active);
  activeRef.current = active;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScroll = useRef(0);
  const latestSource = useRef("");
  const lastSaved = useRef("");
  const pending = useRef<string | null>(null);
  const savesInFlight = useRef(0);
  const activePersists = useRef(new Set<Promise<boolean>>());
  const writers = useRef(new Map<string, SerialNoteWrites>());
  const loadedRel = useRef<string | null>(null);

  const acceptSource = useCallback((source: string) => {
    latestSource.current = source;
    setRawText(source);
    const { frontmatter, body } = splitFrontmatter(source);
    setProperties(parseFrontmatter(frontmatter));
    setWords(countWords(body));
  }, []);

  const performPersist = useCallback(
    async (source: string, targetRel: string): Promise<boolean> => {
      const draft = relRef.current === targetRel && pending.current !== null
        ? pending.current
        : source;
      if (relRef.current === targetRel && pending.current === draft) {
        pending.current = null;
      }
      let writer = writers.current.get(targetRel);
      if (!writer) {
        writer = new SerialNoteWrites(lastSaved.current);
        writers.current.set(targetRel, writer);
      }
      savesInFlight.current += 1;
      try {
        const { desired, committed } = await writer.save(
          draft,
          (content, expectedContent) =>
            vaultDesktop.notes.write(targetRel, content, expectedContent),
        );
        invalidatePublishStatus();
        notifyBacklinksChanged();
        if (relRef.current === targetRel) {
          lastSaved.current = committed;
          if (committed !== desired) {
            const reconciled = rebaseAppendOnly(
              desired,
              latestSource.current,
              committed,
            );
            const hasNewerDraft = pending.current !== null;
            acceptSource(reconciled);
            if (hasNewerDraft) pending.current = reconciled;
          }
          if (pending.current === null && savesInFlight.current === 1) {
            setSaveState("idle");
          }
        }
        toast.dismiss(`save-${targetRel}`);
        return true;
      } catch (error) {
        if (relRef.current === targetRel && pending.current === null) {
          pending.current = latestSource.current;
        }
        setSaveState("error");
        toast.error("Note could not be saved", {
          id: `save-${targetRel}`,
          description: error instanceof Error ? error.message : String(error),
          duration: Infinity,
        });
        return false;
      } finally {
        savesInFlight.current -= 1;
      }
    },
    [acceptSource, setSaveState],
  );

  const persist = useCallback((source: string, targetRel: string) => {
    const operation = performPersist(source, targetRel);
    activePersists.current.add(operation);
    void operation.finally(() => activePersists.current.delete(operation));
    return operation;
  }, [performPersist]);

  const debouncedPersist = useMemo(
    () => debounce((source: string) => void persist(source, relRef.current), 500),
    [persist],
  );

  const applyRawTextChange = useCallback(
    (source: string) => {
      acceptSource(source);
      pending.current = source;
      setSaveState("saving");
      debouncedPersist(source);
    },
    [acceptSource, debouncedPersist, setSaveState],
  );

  const flushPending = useCallback(async () => {
    debouncedPersist.cancel();
    while (pending.current !== null || activePersists.current.size > 0) {
      const source = pending.current;
      if (source !== null) void persist(source, relRef.current);
      const results = await Promise.all([...activePersists.current]);
      if (results.some((saved) => !saved)) {
        throw new Error(`Could not save ${relRef.current} before continuing.`);
      }
    }
  }, [debouncedPersist, persist]);

  useEffect(() => registerNoteWriteFlush(flushPending), [flushPending]);

  useEffect(() => {
    let cancelled = false;
    const previousRel = loadedRel.current;
    debouncedPersist.cancel();
    if (previousRel && previousRel !== rel && pending.current !== null) {
      void persist(pending.current, previousRel);
    }
    pending.current = null;
    relRef.current = rel;
    setMissing(false);
    setPreserveMissingDraft(false);

    vaultDesktop.notes
      .read(rel)
      .then((source) => {
        if (cancelled) return;
        lastSaved.current = source;
        const writer = writers.current.get(rel);
        if (writer) writer.reset(source);
        else writers.current.set(rel, new SerialNoteWrites(source));
        loadedRel.current = rel;
        acceptSource(source);
        savedScroll.current = 0;
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    return () => {
      cancelled = true;
    };
  }, [acceptSource, debouncedPersist, persist, rel]);

  useEffect(() => {
    return () => {
      debouncedPersist.cancel();
      if (pending.current !== null) void persist(pending.current, relRef.current);
    };
  }, [debouncedPersist, persist]);

  const reloadIfChanged = useCallback(async () => {
    const currentRel = relRef.current;
    try {
      const disk = await vaultDesktop.notes.read(currentRel);
      if (currentRel !== relRef.current) return;
      const decision = decideExternalNoteChange({
        disk,
        lastSaved: lastSaved.current,
        dirty: pending.current !== null || savesInFlight.current > 0,
      });
      if (decision === "reload") {
        setMissing(false);
        setPreserveMissingDraft(false);
        lastSaved.current = disk;
        writers.current.get(currentRel)?.reset(disk);
        acceptSource(disk);
      }
    } catch {
      // The Vault Change path owns removal; a failed refresh must not discard a draft.
    }
  }, [acceptSource]);

  useEffect(() => {
    const onFocus = () => {
      if (activeRef.current) void reloadIfChanged();
    };
    const onNotesRewritten = () => void reloadIfChanged();
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTES_REWRITTEN, onNotesRewritten);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTES_REWRITTEN, onNotesRewritten);
    };
  }, [reloadIfChanged]);

  useEffect(() => {
    const onVaultNoteChanged = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<VaultNoteChangedDetail>;
      if (event.detail.rel !== relRef.current) return;
      if (event.detail.kind === "modified") {
        void reloadIfChanged();
      } else if (pending.current !== null || savesInFlight.current > 0) {
        setMissing(true);
        setPreserveMissingDraft(true);
        event.preventDefault();
      } else {
        setMissing(true);
        setPreserveMissingDraft(false);
      }
    };
    window.addEventListener(VAULT_NOTE_CHANGED, onVaultNoteChanged);
    return () => window.removeEventListener(VAULT_NOTE_CHANGED, onVaultNoteChanged);
  }, [reloadIfChanged]);

  useEffect(() => {
    if (!active) return;
    if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
    void reloadIfChanged();
  }, [active, reloadIfChanged]);

  const scrollTopReq = useTabs((state) => state.scrollTopReq);
  const titleFocusReq = useTabs((state) => state.titleFocusReq);
  useEffect(() => {
    if (!scrollTopReq || scrollTopReq.rel !== rel) return;
    savedScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [rel, scrollTopReq]);

  const applyFrontmatter = useCallback(
    (nextFrontmatter: string) => {
      const { body } = splitFrontmatter(latestSource.current);
      applyRawTextChange(joinFrontmatter(nextFrontmatter, body));
    },
    [applyRawTextChange],
  );

  const upsertProperty = useCallback(
    (previousKey: string | null, property: Property) => {
      const { frontmatter } = splitFrontmatter(latestSource.current);
      applyFrontmatter(
        upsertFrontmatterProperty(frontmatter, previousKey, property),
      );
    },
    [applyFrontmatter],
  );

  const removeProperty = useCallback(
    (key: string) => {
      const { frontmatter } = splitFrontmatter(latestSource.current);
      applyFrontmatter(removeFrontmatterProperty(frontmatter, key));
    },
    [applyFrontmatter],
  );

  const consumePropertyAddRequest = useCallback(
    () => setPropertyAddRequest(0),
    [],
  );

  const noteFind = useNoteFindReplace({
    active: active && markdownSource,
    contentVersion: 0,
    editor: null,
    markdownSource,
    rawText,
    rel,
    applyRawTextChange,
  });

  const flushThen = (action: () => void) => {
    void flushPending().then(action).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  };

  useEffect(() => {
    if (!active) return;
    const handle = async (event: Event) => {
      try {
        const action = (event as CustomEvent<{ action?: string }>).detail?.action;
        if (action === "find" && markdownSource) {
          noteFind.openFind();
        } else if (action === "add-property") {
          setPropertyAddRequest((request) => request + 1);
        } else if (action === "copy") {
          await navigator.clipboard.writeText(latestSource.current);
          toast("Markdown copied");
        } else if (action === "export") {
          const path = await vaultDesktop.notes.export(
            relRef.current,
            latestSource.current,
          );
          if (path) toast("Note exported", { description: path });
        } else if (action === "publish") {
          await flushPending();
          setPublishSnapshot({
            rel: relRef.current,
            markdown: latestSource.current,
          });
        } else if (action === "delete") {
          await flushPending();
          await useVault.getState().deleteEntry(relRef.current);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener("riffle:note-action", handle);
    return () => window.removeEventListener("riffle:note-action", handle);
  }, [active, flushPending, markdownSource, noteFind.openFind]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      if (/^https?:\/\//i.test(href)) {
        void openWebUrl(href);
        return;
      }
      const target = hrefToRel(href);
      if (!target) return;
      const vault = useVault.getState();
      vault.expandTo(target);
      vault.setView({ type: "note", rel: target });
      useTabs.getState().requestScrollTop(target);
    };
    root.addEventListener("click", onClick, true);
    return () => root.removeEventListener("click", onClick, true);
  }, []);

  const { body } = splitFrontmatter(rawText);

  <div
    ref={scrollRef}
    data-note-editor={active ? "active" : undefined}
    className="page-scroll relative"
    onScroll={(event) => {
      savedScroll.current = event.currentTarget.scrollTop;
    }}
  >
    @if (active && markdownSource && noteFind.open) {
      <div className="pointer-events-none sticky top-3 z-40 h-0 px-4">
        <div className="pointer-events-auto ml-auto w-fit">
          <FindReplaceBar
            query={noteFind.query}
            replaceText={noteFind.replaceText}
            replaceOpen={noteFind.replaceOpen}
            current={noteFind.current}
            total={noteFind.total}
            onQueryChange={noteFind.setQuery}
            onReplaceTextChange={noteFind.setReplaceText}
            onReplaceOpenChange={noteFind.setReplaceOpen}
            onPrevious={noteFind.previous}
            onNext={noteFind.next}
            onReplace={noteFind.replaceCurrent}
            onReplaceAll={noteFind.replaceAll}
            onClose={noteFind.closeFind}
          />
        </div>
      </div>
    }
    <div className="mx-auto w-full max-w-[720px] px-10 pt-6">
      @if (missing) {
        <p className="pt-16 text-center text-[14px] text-faint">
          This note no longer exists.
          @if (preserveMissingDraft) {
            <span> Your local draft is preserved below.</span>
          }
        </p>
      } @else {
        <TitleInput
          key={rel}
          title={noteTitle(rel)}
          focusNonce={titleFocusReq?.rel === rel ? titleFocusReq.nonce : undefined}
          onEnter={() => undefined}
          onRename={(name) => flushThen(() => renameEntry(rel, name))}
        />
      }
      <div className={cx(missing && !preserveMissingDraft && "hidden")}>
        @if (markdownSource) {
          <MarkdownSourceEditor
            value={rawText}
            onChange={applyRawTextChange}
            selection={noteFind.sourceSelection}
            active={active && markdownSource}
          />
        } @else {
          <>
            <NoteProperties
              properties={properties}
              addRequest={propertyAddRequest}
              onAddRequestHandled={consumePropertyAddRequest}
              onUpsert={upsertProperty}
              onRemove={removeProperty}
            />
            <ReadonlyMarkdownView
              markdown={body}
              source={{ kind: "vault-note", rel }}
            />
          </>
        }
      </div>
    </div>
    @if (active) {
      <div
        className={cx(
          "pointer-events-none absolute bottom-3 right-4 text-[11px] tabular-nums text-faint transition-opacity duration-300",
          (words === 0 || missing) && "opacity-0",
        )}
      >
        {words} {words === 1 ? "word" : "words"}
      </div>
    }
    @if (active && publishSnapshot) {
      <PublishNoteModal
        open
        rel={publishSnapshot.rel}
        markdown={publishSnapshot.markdown}
        onClose={() => setPublishSnapshot(null)}
      />
    }
  </div>
}

export const NoteEditor = memo(NoteEditorComponent);

function countWords(markdown: string) {
  const text = markdown.trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}
