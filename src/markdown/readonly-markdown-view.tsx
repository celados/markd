import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type OctaneNode,
} from "octane";
import { vaultDesktop } from "@/lib/desktop-services";
import { openWebUrl } from "@/lib/desktop";
import { flattenNotes } from "@/lib/tree";
import { relToHref } from "@/lib/noteLinks";
import { useTabs } from "@/stores/tabs";
import { useUi } from "@/stores/ui";
import { useVault } from "@/stores/vault";
import {
  projectRiffleMarkdown,
  type ProjectedDocument,
  type ProjectedNode,
} from "./riffle-markdown";

export type MarkdownSourceContext = {
  kind: "vault-note";
  rel: string;
};

type ReadonlyMarkdownViewProps = {
  markdown: string;
  source: MarkdownSourceContext;
  active?: boolean;
};

type RenderState =
  | { status: "loading" }
  | { status: "ready"; document: ProjectedDocument }
  | { status: "error"; diagnostic: string };

type ProjectionActions = {
  openNote: (rel: string) => void;
  openExternal: (href: string) => void;
  assetUrl: (rel: string) => string | null;
};

const readonlyFindHighlight = "riffle-readonly-find";
const readonlyFindActiveHighlight = "riffle-readonly-find-active";
let activeHighlightOwner: object | null = null;

export function ReadonlyMarkdownView(props: ReadonlyMarkdownViewProps) {
  const { markdown, source, active = true } = props;
  const tree = useVault((state) => state.tree);
  const noteRels = useMemo(
    () => flattenNotes(tree).map((note) => note.rel),
    [tree],
  );
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const articleRef = useRef<HTMLElement | null>(null);
  const highlightOwner = useRef<object>({});
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void projectRiffleMarkdown(markdown, source.rel, noteRels)
      .then((document) => {
        if (!cancelled) setState({ status: "ready", document });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          diagnostic: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [markdown, noteRels, source.rel]);

  const openFind = useCallback(() => setFindOpen(true), []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setQuery("");
    setActiveMatch(0);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        (!event.metaKey && !event.ctrlKey) ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.settingsOpen) return;
      event.preventDefault();
      openFind();
    };
    const onNoteAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "find") openFind();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("riffle:note-action", onNoteAction);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("riffle:note-action", onNoteAction);
    };
  }, [active, openFind]);

  useEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen]);

  useEffect(() => {
    const highlights = CSS.highlights;
    const owner = highlightOwner.current;
    const clear = () => {
      if (activeHighlightOwner !== owner) return;
      highlights.delete(readonlyFindHighlight);
      highlights.delete(readonlyFindActiveHighlight);
      activeHighlightOwner = null;
    };
    clear();
    const root = articleRef.current;
    if (!active || !findOpen || !query || !root || state.status !== "ready") {
      setMatchCount(0);
      return clear;
    }

    const ranges = findTextRanges(root, query);
    installReadonlyFindStyles();
    activeHighlightOwner = owner;
    const selected = ranges.length === 0
      ? 0
      : Math.min(activeMatch, ranges.length - 1);
    if (selected !== activeMatch) setActiveMatch(selected);
    setMatchCount(ranges.length);
    if (ranges.length > 0) {
      highlights.set(readonlyFindHighlight, new Highlight(...ranges));
      highlights.set(
        readonlyFindActiveHighlight,
        new Highlight(ranges[selected]!),
      );
      scrollRangeIntoView(ranges[selected]!);
    }
    return clear;
  }, [active, activeMatch, findOpen, query, state]);

  const selectMatch = useCallback((offset: number) => {
    if (matchCount === 0) return;
    setActiveMatch((current) => (current + offset + matchCount) % matchCount);
  }, [matchCount]);

  const actions = useMemo<ProjectionActions>(() => ({
    openNote: (rel) => {
      const vault = useVault.getState();
      vault.expandTo(rel);
      vault.setView({ type: "note", rel });
      useTabs.getState().requestScrollTop(rel);
    },
    openExternal: (href) => void openWebUrl(href),
    assetUrl: (rel) => vaultDesktop.assets.url(rel),
  }), []);
  const content = useMemo(
    () => state.status === "ready"
      ? state.document.nodes.map((node) => renderProjectedNode(node, actions))
      : null,
    [actions, state],
  );

  if (state.status === "error") {
    return (
      <section
        role="alert"
        data-markdown-error="true"
        data-source-rel={source.rel}
        className="rounded-lg border border-line bg-panel p-4 text-[13px] text-ink"
      >
        <h2 className="text-[14px] font-semibold">Markdown rendering failed</h2>
        <p className="mt-1 text-muted">
          Open Markdown source to inspect and repair this Note.
        </p>
        <code className="mt-3 block font-mono text-[12px] text-faint">
          {state.diagnostic}
        </code>
      </section>
    );
  }

  return (
    <>
      {findOpen ? (
        <ReadonlyFindBar
          inputRef={findInputRef}
          query={query}
          current={query && matchCount > 0 ? activeMatch + 1 : 0}
          total={query ? matchCount : 0}
          onQueryChange={(value) => {
            setQuery(value);
            setActiveMatch(0);
          }}
          onPrevious={() => selectMatch(-1)}
          onNext={() => selectMatch(1)}
          onClose={closeFind}
        />
      ) : null}
      <article
        ref={articleRef}
        data-readonly-markdown="true"
        data-source-rel={source.rel}
        aria-busy={state.status === "loading"}
        tabIndex={-1}
        className="prose-note"
      >
        {content}
      </article>
    </>
  );
}

function renderProjectedNode(
  node: ProjectedNode,
  actions: ProjectionActions,
): OctaneNode {
  if (typeof node === "string") return node;
  if (node.kind === "fragment") {
    return createElement(
      Fragment,
      null,
      ...node.children.map((child) => renderProjectedNode(child, actions)),
    );
  }
  if (node.kind === "element") {
    return createElement(
      node.tag,
      node.attributes,
      ...node.children.map((child) => renderProjectedNode(child, actions)),
    );
  }
  if (node.kind === "task") {
    return createElement("input", {
      type: "checkbox",
      checked: node.checked,
      disabled: true,
      className: "task-list-item-checkbox",
      "aria-label": node.checked ? "Completed task" : "Incomplete task",
    });
  }
  if (node.kind === "asset") {
    const src = node.rel ? actions.assetUrl(node.rel) : null;
    return createElement("img", {
      ...(src ? { src } : {}),
      ...(node.alt ? { alt: node.alt } : {}),
      ...(node.title ? { title: node.title } : {}),
      "data-markdown-src": node.source,
      "data-resource-status": src ? "ready" : "rejected",
    });
  }
  if (node.kind === "code-block") {
    return createElement(ReadonlyCodeBlock, {
      code: node.code,
      language: node.language,
    });
  }

  const children = node.children.map((child) => renderProjectedNode(child, actions));
  if (node.kind === "note-link") {
    if (!node.exists) {
      return createElement(
        "span",
        {
          ...(node.title ? { title: node.title } : {}),
          "aria-disabled": "true",
          "data-note-rel": node.rel,
          "data-note-status": "missing",
          className: "markdown-link-missing",
        },
        ...children,
      );
    }
    return createElement(
      "a",
      {
        href: relToHref(node.rel),
        ...(node.title ? { title: node.title } : {}),
        "data-note-rel": node.rel,
        "data-note-status": "existing",
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          actions.openNote(node.rel);
        },
      },
      ...children,
    );
  }
  if (node.kind === "external-link") {
    return createElement(
      "a",
      {
        href: node.href,
        ...(node.title ? { title: node.title } : {}),
        "data-link-kind": "external",
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          actions.openExternal(node.href);
        },
      },
      ...children,
    );
  }
  if (node.kind === "fragment-link") {
    return createElement(
      "a",
      { href: node.href, ...(node.title ? { title: node.title } : {}) },
      ...children,
    );
  }
  return createElement(
    "span",
    { "aria-disabled": "true", "data-link-status": "rejected" },
    ...children,
  );
}

function ReadonlyCodeBlock(props: { code: string; language?: string }) {
  const { code, language } = props;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="code-block-wrap">
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy code"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void copy().catch(() => undefined)}
        className="code-block-copy"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ReadonlyFindBar(props: {
  inputRef: { current: HTMLInputElement | null };
  query: string;
  current: number;
  total: number;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const {
    inputRef,
    query,
    current,
    total,
    onQueryChange,
    onPrevious,
    onNext,
    onClose,
  } = props;
  const hasMatches = total > 0;
  const onKeyDown = (event: NativeEvent<HTMLInputElement, KeyboardEvent>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    }
  };

  return (
    <div className="pointer-events-none sticky top-3 z-40 h-0 px-4">
      <div className="note-find-panel note-find-enter pointer-events-auto ml-auto flex h-11 w-[min(300px,calc(100vw-32px))] items-center gap-1 rounded-xl border border-line bg-bg px-2">
        <input
          ref={inputRef}
          type="search"
          aria-label="Find in readonly note"
          value={query}
          onInput={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Find"
          className="h-9 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] font-medium text-ink outline-none placeholder:text-faint"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-faint">
            {`${current} of ${total}`}
          </span>
        ) : null}
        <FindButton label="Previous match" disabled={!hasMatches} onClick={onPrevious}>
          ↑
        </FindButton>
        <FindButton label="Next match" disabled={!hasMatches} onClick={onNext}>
          ↓
        </FindButton>
        <FindButton label="Close" disabled={false} onClick={onClose}>
          ×
        </FindButton>
      </div>
    </div>
  );
}

function FindButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  const { label, disabled, onClick, children } = props;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function findTextRanges(root: HTMLElement, query: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("button")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let text = "";
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const start = text.length;
    text += node.data;
    segments.push({ node, start, end: text.length });
    current = walker.nextNode();
  }

  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const ranges: Range[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const end = index + query.length;
    const startSegment = segments.find(
      (segment) => segment.start <= index && segment.end > index,
    );
    const endSegment = segments.find(
      (segment) => segment.start < end && segment.end >= end,
    );
    if (startSegment && endSegment) {
      const range = new Range();
      range.setStart(startSegment.node, index - startSegment.start);
      range.setEnd(endSegment.node, end - endSegment.start);
      ranges.push(range);
    }
    index = haystack.indexOf(needle, index + needle.length);
  }
  return ranges;
}

function scrollRangeIntoView(range: Range): void {
  const pane = range.startContainer.parentElement?.closest<HTMLElement>(".page-scroll");
  if (!pane) return;
  const bounds = range.getBoundingClientRect();
  const paneBounds = pane.getBoundingClientRect();
  const visibleTop = paneBounds.top + 64;
  const visibleBottom = paneBounds.bottom - 24;
  if (bounds.top >= visibleTop && bounds.bottom <= visibleBottom) return;
  pane.scrollTop +=
    (bounds.top + bounds.bottom) / 2 -
    (paneBounds.top + paneBounds.bottom) / 2;
}

function installReadonlyFindStyles(): void {
  if (document.querySelector("style[data-riffle-readonly-find]")) return;
  const style = document.createElement("style");
  style.dataset.riffleReadonlyFind = "true";
  // Vite's current CSS optimizer rejects the standard ::highlight syntax,
  // so keep these constant browser-owned rules out of its transform pipeline.
  style.textContent = `
    ::highlight(${readonlyFindHighlight}) {
      color: var(--ink);
      background: color-mix(in srgb, var(--ink) 12%, transparent);
    }
    ::highlight(${readonlyFindActiveHighlight}) {
      color: var(--ink);
      background: color-mix(in srgb, var(--ink) 28%, transparent);
    }
  `;
  document.head.append(style);
}
