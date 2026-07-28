import {
  LuPlus as Plus,
  LuX as X,
} from "@/icons/icons.tsrx";
import { useEffect, useRef, useState } from "octane";
import { tagColor } from "@/lib/tagColor";

type TagListProps = {
  tags: string[];
  onChange?: (tags: string[]) => void;
  onTagClick?: (tag: string) => void;
  activeTag?: string | null;
  editable?: boolean;
  removable?: boolean;
};

function chipStyle(tag: string, active: boolean) {
  const color = tagColor(tag);
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} ${active ? 26 : 14}%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} ${active ? 55 : 28}%, transparent)`,
  };
}

function parseTags(raw: string) {
  return raw
    .split(/[,\s]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean);
}

export function TagList(props: TagListProps) @{
  const {
    tags,
    onChange,
    onTagClick,
    activeTag,
    editable = true,
    removable = editable,
  } = props;
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = (raw: string) => {
    const next = parseTags(raw).filter((t) => !tags.includes(t));
    if (next.length) onChange?.([...tags, ...next]);
  };

  const commitInput = (input: HTMLInputElement) => {
    commit(input.value);
    input.value = "";
  };

  <div
    className="flex flex-wrap items-center gap-1"
    onClick={(event: MouseEvent) => event.stopPropagation()}
  >
    @for (const tag of tags; key tag) {
      <span
        style={chipStyle(tag, activeTag === tag)}
        className="group/tag inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium leading-none transition-colors"
      >
        <button
          type="button"
          className="max-w-[120px] truncate py-0.5"
          onClick={() => onTagClick?.(tag)}
        >
          #{tag}
        </button>
        @if (removable) {
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="grid place-items-center opacity-60 transition-opacity hover:opacity-100"
            onClick={() => onChange?.(tags.filter((candidate) => candidate !== tag))}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        }
      </span>
    }

    @if (editable) {
      @if (adding) {
        <input
          ref={inputRef}
          placeholder="tag…"
          className="w-16 rounded-full border border-line bg-transparent px-2 py-0.5 text-[11px] leading-none text-ink outline-none"
          onBlur={(event: FocusEvent) => {
            commitInput(event.currentTarget as HTMLInputElement);
            setAdding(false);
          }}
          onKeyDown={(event: KeyboardEvent) => {
            const input = event.currentTarget as HTMLInputElement;
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitInput(input);
            } else if (event.key === "Escape") {
              setAdding(false);
            }
          }}
        />
      } @else {
        <button
          type="button"
          aria-label="Add tag"
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-line px-1.5 py-[3px] text-[11px] leading-none text-faint transition-colors hover:text-muted"
          onClick={() => setAdding(true)}
        >
          <Plus size={11} strokeWidth={2.5} />
          @if (tags.length === 0) {
            <>tag</>
          }
        </button>
      }
    }
  </div>
}
