import { NoteEditor } from "./NoteEditor.tsrx";
import { cx } from "@/lib/utils";
import { useTabs } from "@/stores/tabs";
import { useVault } from "@/stores/vault";

/**
 * One live Note pane per open tab. Keeping inactive Source Editors mounted
 * preserves their CodeMirror undo state; Readonly Views remain a projection of
 * the same pane source rather than a second document owner.
 */
export function NotesWorkspace(props: { visible: boolean }) @{
  const { visible } = props;
  const tabs = useTabs((s) => s.tabs);
  const view = useVault((s) => s.view);
  const active = view?.type === "note" ? view.rel : null;

  @if (tabs.length > 0) {
    <div className={cx("absolute inset-0", !visible && "hidden")}>
      @for (const rel of tabs; key rel) {
        <div
          className={cx(
            "absolute inset-0 overflow-hidden",
            rel !== active && "hidden",
          )}
        >
          <NoteEditor rel={rel} active={visible && rel === active} />
        </div>
      }
    </div>
  }
}
