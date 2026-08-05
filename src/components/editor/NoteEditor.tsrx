import { memo, useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { toast } from "@octanejs/sonner";
import { NOTES_REWRITTEN, notifyBacklinksChanged } from "@/lib/backlinks";
import {
  VAULT_NOTE_CHANGED,
  type VaultNoteChangedDetail,
} from "@/lib/vault-note-events";
import { vaultDesktop } from "@/lib/desktop-services";
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
import { cx, debounce, noteTitle } from "@/lib/utils";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";
import { useVault } from "@/stores/vault";
import {
  rebaseAppendOnly,
  SerialNoteWrites,
  type NoteSourceMutation,
} from "@/lib/serial-note-writes";
import { ReadonlyMarkdownView } from "@/markdown/readonly-markdown-view";
import { FindReplaceBar } from "./FindReplaceBar.tsrx";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { NoteProperties } from "./NoteProperties.tsrx";
import { PublishNoteModal } from "./PublishNoteModal.tsrx";
import { TitleInput } from "./TitleInput";
import { useSourceFindReplace } from "./use-source-find-replace";

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
  const pendingMutation = useRef<NoteSourceMutation | null>(null);
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
          if (
            pending.current === null && pendingMutation.current === null &&
            savesInFlight.current === 1
          ) {
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

  const performMutation = useCallback(
    async (mutation: NoteSourceMutation, targetRel: string): Promise<boolean> => {
      let writer = writers.current.get(targetRel);
      if (!writer) {
        writer = new SerialNoteWrites(lastSaved.current);
        writers.current.set(targetRel, writer);
      }
      savesInFlight.current += 1;
      try {
        const { committed } = await writer.mutateLatest(
          mutation,
          () => vaultDesktop.notes.read(targetRel),
          (content, expectedContent) =>
            vaultDesktop.notes.write(targetRel, content, expectedContent),
        );
        invalidatePublishStatus();
        notifyBacklinksChanged();
        if (relRef.current === targetRel) {
          lastSaved.current = committed;
          if (pending.current === null && pendingMutation.current === null) {
            acceptSource(committed);
          }
          if (
            pending.current === null && pendingMutation.current === null &&
            savesInFlight.current === 1
          ) {
            setSaveState("idle");
          }
        }
        toast.dismiss(`save-${targetRel}`);
        return true;
      } catch (error) {
        if (relRef.current === targetRel) {
          pendingMutation.current = pendingMutation.current
            ? composeMutations(mutation, pendingMutation.current)
            : mutation;
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

  const persistMutation = useCallback(
    (mutation: NoteSourceMutation, targetRel: string) => {
      const operation = performMutation(mutation, targetRel);
      activePersists.current.add(operation);
      void operation.finally(() => activePersists.current.delete(operation));
      return operation;
    },
    [performMutation],
  );

  const persistPendingMutation = useCallback(() => {
    const mutation = pendingMutation.current;
    if (mutation === null) return;
    pendingMutation.current = null;
    void persistMutation(mutation, relRef.current);
  }, [persistMutation]);

  const debouncedPersistMutation = useMemo(
    () => debounce(persistPendingMutation, 500),
    [persistPendingMutation],
  );

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
    debouncedPersistMutation.cancel();
    while (
      pending.current !== null || pendingMutation.current !== null ||
      activePersists.current.size > 0
    ) {
      const source = pending.current;
      if (source !== null) void persist(source, relRef.current);
      const mutation = pendingMutation.current;
      if (mutation !== null) {
        pendingMutation.current = null;
        void persistMutation(mutation, relRef.current);
      }
      const results = await Promise.all([...activePersists.current]);
      if (results.some((saved) => !saved)) {
        throw new Error(`Could not save ${relRef.current} before continuing.`);
      }
    }
  }, [debouncedPersist, debouncedPersistMutation, persist, persistMutation]);

  useEffect(() => registerNoteWriteFlush(flushPending), [flushPending]);

  useEffect(() => {
    let cancelled = false;
    const previousRel = loadedRel.current;
    debouncedPersist.cancel();
    debouncedPersistMutation.cancel();
    if (previousRel && previousRel !== rel && pending.current !== null) {
      void persist(pending.current, previousRel);
    }
    if (previousRel && previousRel !== rel && pendingMutation.current !== null) {
      const mutation = pendingMutation.current;
      pendingMutation.current = null;
      void persistMutation(mutation, previousRel);
    }
    pending.current = null;
    pendingMutation.current = null;
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
  }, [
    acceptSource,
    debouncedPersist,
    debouncedPersistMutation,
    persist,
    persistMutation,
    rel,
  ]);

  useEffect(() => {
    return () => {
      debouncedPersist.cancel();
      debouncedPersistMutation.cancel();
      if (pending.current !== null) void persist(pending.current, relRef.current);
      if (pendingMutation.current !== null) {
        const mutation = pendingMutation.current;
        pendingMutation.current = null;
        void persistMutation(mutation, relRef.current);
      }
    };
  }, [debouncedPersist, debouncedPersistMutation, persist, persistMutation]);

  const reloadIfChanged = useCallback(async () => {
    const currentRel = relRef.current;
    try {
      const disk = await vaultDesktop.notes.read(currentRel);
      if (currentRel !== relRef.current) return;
      const decision = decideExternalNoteChange({
        disk,
        lastSaved: lastSaved.current,
        dirty:
          pending.current !== null || pendingMutation.current !== null ||
          savesInFlight.current > 0,
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
      } else if (
        pending.current !== null || pendingMutation.current !== null ||
        savesInFlight.current > 0
      ) {
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

  const applySourceMutation = useCallback(
    (mutation: NoteSourceMutation) => {
      const queuedMutation = pendingMutation.current
        ? composeMutations(pendingMutation.current, mutation)
        : mutation;
      acceptSource(queuedMutation(latestSource.current));
      pendingMutation.current = queuedMutation;
      setSaveState("saving");
      debouncedPersistMutation();
    },
    [acceptSource, debouncedPersistMutation, setSaveState],
  );

  const upsertProperty = useCallback(
    (previousKey: string | null, property: Property) => {
      applySourceMutation((source) => {
        const { frontmatter, body } = splitFrontmatter(source);
        return joinFrontmatter(
          upsertFrontmatterProperty(frontmatter, previousKey, property),
          body,
        );
      });
    },
    [applySourceMutation],
  );

  const removeProperty = useCallback(
    (key: string) => {
      applySourceMutation((source) => {
        const { frontmatter, body } = splitFrontmatter(source);
        return joinFrontmatter(removeFrontmatterProperty(frontmatter, key), body);
      });
    },
    [applySourceMutation],
  );

  const consumePropertyAddRequest = useCallback(
    () => setPropertyAddRequest(0),
    [],
  );

  const noteFind = useSourceFindReplace({
    active: active && markdownSource,
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
              active={active}
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

function composeMutations(
  first: NoteSourceMutation,
  second: NoteSourceMutation,
): NoteSourceMutation {
  return (source) => second(first(source));
}
