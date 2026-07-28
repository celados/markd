import {
  LuCheck as Check,
  LuTag as Tag,
} from "@/icons/icons.tsrx";
import { AnimatePresence, motion } from "@octanejs/motion";
import { useEffect, useRef, useState } from "octane";
import { EASE_OUT } from "@/lib/ease";
import { tagColor } from "@/lib/tagColor";
import { Tooltip } from "@/components/ui/Tooltip";

type TagPickerProps = {
  assigned: string[];
  registry: string[];
  onChange: (tags: string[]) => void;
};

export function TagPicker(props: TagPickerProps) @{
  const { assigned, registry, onChange } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (tag: string) =>
    onChange(
      assigned.includes(tag)
        ? assigned.filter((t) => t !== tag)
        : [...assigned, tag],
    );

  <div
    ref={ref}
    className="relative"
    onClick={(event: MouseEvent) => event.stopPropagation()}
  >
    <Tooltip label="Assign tags" side="top">
      <button
        type="button"
        aria-label="Assign tags"
        onClick={() => setOpen((o) => !o)}
        className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-active hover:text-ink"
      >
        <Tag size={13} strokeWidth={2} />
      </button>
    </Tooltip>

    <AnimatePresence>
      @if (open) {
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -4 }}
          transition={{ duration: 0.14, ease: EASE_OUT }}
          style={{ transformOrigin: "top right" }}
          className="absolute right-0 top-8 z-50 max-h-64 w-48 overflow-y-auto rounded-lg border border-line bg-bg p-1 shadow-lg shadow-black/8 dark:shadow-black/40"
        >
          @if (registry.length === 0) {
            <p className="px-2 py-2 text-[12px] leading-relaxed text-faint">
              No tags yet. Create one from the top bar.
            </p>
          } @else {
            @for (const tag of registry; key tag) {
              <button
                type="button"
                onClick={() => toggle(tag)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-hover"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tagColor(tag) }}
                />
                <span className="min-w-0 flex-1 truncate text-left text-ink">
                  {tag}
                </span>
                @if (assigned.includes(tag)) {
                  <Check size={13} strokeWidth={2.5} className="shrink-0 text-ink" />
                }
              </button>
            }
          }
        </motion.div>
      }
    </AnimatePresence>
  </div>
}
