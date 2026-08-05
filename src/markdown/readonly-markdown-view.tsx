import { parseMarkdown, type Node } from "comark";
import {
  createElement,
  Fragment,
  useEffect,
  useState,
  type OctaneNode,
} from "octane";

export type MarkdownSourceContext = {
  kind: "vault-note";
  rel: string;
};

type ReadonlyMarkdownViewProps = {
  markdown: string;
  source: MarkdownSourceContext;
};

type RenderState =
  | { status: "loading" }
  | { status: "ready"; content: OctaneNode }
  | { status: "error"; diagnostic: string };

const elementTags = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

export function ReadonlyMarkdownView(props: ReadonlyMarkdownViewProps) {
  const { markdown, source } = props;
  const [state, setState] = useState<RenderState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void renderMarkdown(markdown)
      .then((content) => {
        if (!cancelled) setState({ status: "ready", content });
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
  }, [markdown]);

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
    <article
      data-readonly-markdown="true"
      data-source-rel={source.rel}
      aria-busy={state.status === "loading"}
      tabIndex={-1}
      className="prose-note"
    >
      {state.status === "ready" ? state.content : null}
    </article>
  );
}

async function renderMarkdown(markdown: string): Promise<OctaneNode> {
  // A fresh parser invocation makes every persisted Note render canonical and
  // keeps Comark's stateful streaming mode out of the production contract.
  const document = await parseMarkdown(markdown, {
    autoClose: false,
    html: false,
  });
  return createElement(
    Fragment,
    null,
    ...document.nodes.map((node) => projectNode(node, false)),
  );
}

function projectNode(node: Node, insideCode: boolean): OctaneNode {
  if (typeof node === "string") {
    return insideCode ? node : projectSoftBreaks(node);
  }
  if (node[0] === null) return null;

  const [tag, attributes, ...children] = node;
  if (tag === "input" && attributes.type === "checkbox") {
    const className = safeClassName(tag, stringAttribute(attributes.class));
    const inputAttributes = Object.keys(attributes);
    if (
      className !== "task-list-item-checkbox" ||
      attributes[":disabled"] !== "true" ||
      inputAttributes.some(
        (attribute) =>
          !["class", "type", ":disabled", ":checked", "$"].includes(attribute),
      )
    ) {
      throw new Error("Unsupported Markdown task input");
    }
    return createElement("input", {
      type: "checkbox",
      defaultChecked: attributes[":checked"] === "true",
      disabled: true,
      className,
    });
  }
  if (!elementTags.has(tag)) {
    throw new Error(`Unsupported Markdown node: ${tag}`);
  }

  const projected = children.map((child) => projectNode(child, tag === "code"));
  return createElement(tag, projectAttributes(tag, attributes), ...projected);
}

function projectSoftBreaks(text: string): OctaneNode {
  const lines = text.split("\n");
  if (lines.length === 1) return text;

  const children: OctaneNode[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0) children.push(createElement("br", null));
    children.push(line);
  }
  return createElement(Fragment, null, ...children);
}

function projectAttributes(
  tag: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  assertSupportedAttributes(tag, attributes);
  const className = safeClassName(tag, stringAttribute(attributes.class));
  const title = stringAttribute(attributes.title);
  if (className) props.className = className;
  if (title) props.title = title;

  if (/^h[1-6]$/.test(tag)) {
    const id = stringAttribute(attributes.id);
    if (id) props.id = id;
  } else if (tag === "a") {
    const href = safeHref(stringAttribute(attributes.href));
    if (href) props.href = href;
  } else if (tag === "img") {
    const src = stringAttribute(attributes.src);
    const alt = stringAttribute(attributes.alt);
    // Asset and remote-resource policy belongs to #39. Keeping the source as
    // inert metadata preserves image semantics without making viewing a Note
    // perform an unreviewed network or privileged-scheme request.
    if (src) props["data-markdown-src"] = src;
    if (alt) props.alt = alt;
  } else if (tag === "ol") {
    const start = numberAttribute(attributes.start);
    if (start !== undefined) props.start = start;
  } else if (tag === "th" || tag === "td") {
    const alignment = tableAlignment(stringAttribute(attributes.style));
    if (alignment) props.style = { textAlign: alignment };
  }

  return props;
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberAttribute(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function tableAlignment(
  style: string | undefined,
): "left" | "center" | "right" | undefined {
  const match = /^text-align:(left|center|right)$/.exec(style ?? "");
  return match?.[1] as "left" | "center" | "right" | undefined;
}

function safeClassName(tag: string, className: string | undefined) {
  if (!className) return undefined;
  if (tag === "ul" && className === "contains-task-list") return className;
  if (tag === "li" && className === "task-list-item") return className;
  if (tag === "input" && className === "task-list-item-checkbox") {
    return className;
  }
  if (tag === "code" && /^language-[a-z0-9_-]+$/i.test(className)) {
    return className;
  }
  throw new Error(`Unsupported Markdown attribute: ${tag}.class`);
}

function assertSupportedAttributes(
  tag: string,
  attributes: Record<string, unknown>,
) {
  const allowed = supportedAttributes[tag] ?? emptyAttributes;
  const unsupported = Object.keys(attributes).find(
    (attribute) => attribute !== "$" && !allowed.has(attribute),
  );
  if (unsupported) {
    throw new Error(`Unsupported Markdown attribute: ${tag}.${unsupported}`);
  }
}

const emptyAttributes = new Set<string>();
const supportedAttributes: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  h1: new Set(["id"]),
  h2: new Set(["id"]),
  h3: new Set(["id"]),
  h4: new Set(["id"]),
  h5: new Set(["id"]),
  h6: new Set(["id"]),
  img: new Set(["src", "alt", "title"]),
  li: new Set(["class"]),
  ol: new Set(["start"]),
  pre: new Set(["language"]),
  td: new Set(["style"]),
  th: new Set(["style"]),
  ul: new Set(["class"]),
};

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href.startsWith("/")) {
    return undefined;
  }
  const path = href.split(/[?#]/, 1)[0];
  return path.split("/").includes("..") ? undefined : href;
}
