import { LuX as X } from "@/icons/icons.tsrx";
import { motion } from "@octanejs/motion";
import { useId, useState } from "octane";
import { SPRING_LAYOUT } from "@/lib/ease";
import { tagColor } from "@/lib/tagColor";
import { cx } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type TagRailProps = {
  tags: string[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
  onDelete: (tag: string) => void;
  counts?: Record<string, number>;
  total?: number;
};

export function TagRail(props: TagRailProps) @{
  const {
    tags,
    activeTag,
    onSelect,
    onDelete,
    counts = {},
    total,
  } = props;
  const pillId = useId();
  const [confirmTag, setConfirmTag] = useState<string | null>(null);

  const requestDelete = (tag: string) => {
    if (counts[tag] > 0) {
      setConfirmTag(tag);
    } else {
      onDelete(tag);
    }
  };

  const confirmCount = confirmTag ? (counts[confirmTag] ?? 0) : 0;

  <aside className="sticky top-6 hidden w-[152px] shrink-0 self-start sm:block">
    <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
      Tags
    </p>
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cx(
          "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
          activeTag === null
            ? "text-ink"
            : "text-muted hover:bg-hover hover:text-ink",
        )}
      >
        @if (activeTag === null) {
          <motion.span
            layoutId={pillId}
            transition={SPRING_LAYOUT}
            className="absolute inset-0 rounded-md bg-active"
          />
        }
        <span className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full border border-faint" />
        <span className="relative z-10 truncate">All</span>
        @if (total !== undefined) {
          <span className="relative z-10 ml-auto shrink-0 tabular-nums text-[11px] text-faint">
            {String(total) as string}
          </span>
        }
      </button>

      @for (const tag of tags; key tag) {
        <div className="group/rail flex items-center">
          <button
            type="button"
            onClick={() => onSelect(activeTag === tag ? null : tag)}
            className={cx(
              "relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
              activeTag === tag
                ? "text-ink"
                : "text-muted hover:bg-hover hover:text-ink",
            )}
          >
            @if (activeTag === tag) {
              <motion.span
                layoutId={pillId}
                transition={SPRING_LAYOUT}
                className="absolute inset-0 rounded-md bg-active"
              />
            }
            <span
              className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tagColor(tag) }}
            />
            <span className="relative z-10 truncate">{tag}</span>
            <span
              className={cx(
                "relative z-10 ml-auto shrink-0 tabular-nums text-[11px]",
                activeTag === tag ? "text-muted" : "text-faint",
              )}
            >
              {String(counts[tag] ?? 0) as string}
            </span>
          </button>
          <button
            type="button"
            aria-label={`Delete tag ${tag}`}
            onClick={() => requestDelete(tag)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-danger group-hover/rail:opacity-100"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      }
    </div>

    @if (tags.length === 0) {
      <p className="mt-1 px-2 text-[12px] leading-relaxed text-faint">
        Create a tag from the top bar to start filtering.
      </p>
    }

    <Modal
      open={confirmTag !== null}
      onClose={() => setConfirmTag(null)}
      ariaLabel="Delete tag"
    >
      <div className="w-[320px] p-5">
        <h2 className="text-[14px] font-semibold text-ink">
          Delete #{confirmTag ?? ""}?
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          {String(confirmCount) as string} item{confirmCount === 1 ? "" : "s"} tagged
          #{confirmTag ?? ""} will be untagged. This can’t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmTag(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (confirmTag) onDelete(confirmTag);
              setConfirmTag(null);
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  </aside>
}
