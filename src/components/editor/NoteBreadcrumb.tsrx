import { LuChevronRight as ChevronRight } from "@/icons/icons.tsrx";
import { ActionSwapText } from "@/components/motion/action-swap.tsrx";
import { noteTitle } from "@/lib/utils";

/**
 * Folder path → title breadcrumb for the active note. Folders are static and
 * muted; only the title cascades (via ActionSwapText) on note change, so the
 * animation stays short and fast regardless of how deep the note is nested.
 */
export function NoteBreadcrumb(props: { rel: string }) @{
  const { rel } = props;
  const folders = rel
    .split("/")
    .slice(0, -1)
    .map((folder, index) => ({ folder, index }));

  <div
      aria-label="Current note"
      className="flex min-w-0 items-center gap-1.5 text-[13.5px]"
    >
      @for (const entry of folders; key entry.index) {
        <>
          <span className="max-w-[140px] shrink-0 truncate text-muted">
            {entry.folder}
          </span>
          <ChevronRight
            size={13}
            strokeWidth={2}
            className="shrink-0 text-faint"
          />
        </>
      }
      <ActionSwapText
        value={rel}
        text={noteTitle(rel)}
        animation="roll"
        className="shrink-0 font-semibold text-ink"
      />
  </div>
}
