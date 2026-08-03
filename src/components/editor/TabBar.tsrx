import {
  LuCopy as Copy,
  LuPin as Pin,
  LuPinOff as PinOff,
  LuX as X,
} from "@/icons/icons.tsrx";
import { motion } from "@octanejs/motion";
import { toast } from "@octanejs/sonner";
import { useState } from "octane";
import {
  ContextMenu,
  type MenuItem,
  type MenuPosition,
} from "@/components/ui/ContextMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { SPRING_LAYOUT } from "@/lib/ease";
import { ipc } from "@/lib/ipc";
import { cx, noteTitle } from "@/lib/utils";
import { usePins } from "@/stores/pins";
import { nextAfterClose, useTabs } from "@/stores/tabs";
import { useVault } from "@/stores/vault";

/**
 * Code-editor style tab strip for open notes. Active tab is derived from
 * `vault.view`; the strip only owns which tabs exist and their order.
 */
export function TabBar() @{
  const tabs = useTabs((s) => s.tabs);
  const view = useVault((s) => s.view);
  const active = view?.type === "note" ? view.rel : null;
  const pins = usePins((s) => s.pins);
  const [menu, setMenu] = useState<{
    rel: string;
    position: MenuPosition;
  } | null>(null);
  // Octane #333 currently cannot lower a key that refers to an @for index
  // binding, so positional focus identity is materialized before rendering.
  const entries = tabs.map((rel, index) => ({ rel, index }));

  @if (entries.length > 0) {
    <>
    // layoutRoot scopes the sliding active-tab fill to this strip so the
    // horizontal scroll offset can't smear its projection.
    <motion.div
      layoutRoot
      role="tablist"
      className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]"
    >
      @for (const entry of entries; key entry.rel) {
        <Tab
          rel={entry.rel}
          active={entry.rel === active}
          focusable={entry.rel === active || (!active && entry.index === 0)}
          openMenu={(position) => setMenu({ rel: entry.rel, position })}
        />
      }
      <div
        data-markd-drag-region
        data-tab-strip-drag-region
        aria-hidden="true"
        className="min-w-12 flex-1 shrink-0"
      />
    </motion.div>

    @if (menu) {
      <ContextMenu
        position={menu.position}
        items={tabMenuItems(menu.rel, pins.includes(menu.rel))}
        onClose={() => setMenu(null)}
      />
    }
    </>
  }
}

/** Close `rel`; if it was the active note, activate its neighbor. */
export function closeTab(rel: string) {
  const { tabs, close } = useTabs.getState();
  const vault = useVault.getState();
  const wasActive = vault.view?.type === "note" && vault.view.rel === rel;
  const next = wasActive ? nextAfterClose(tabs, rel) : null;
  close(rel);
  if (wasActive) {
    vault.setView(next ? { type: "note", rel: next } : null);
  }
}

function closeOtherTabs(rel: string) {
  useTabs.getState().closeOthers(rel);
  useVault.getState().setView({ type: "note", rel });
}

function copyText(value: string, success: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast(success),
    () => toast.error("Path could not be copied"),
  );
}

function tabMenuItems(rel: string, pinned: boolean): MenuItem[] {
  return [
    {
      label: pinned ? "Unpin note" : "Pin note",
      icon: pinned ? PinOff : Pin,
      onSelect: () => void usePins.getState().toggle(rel),
    },
    {
      label: "Close",
      icon: X,
      onSelect: () => closeTab(rel),
    },
    {
      label: "Close others",
      icon: X,
      onSelect: () => closeOtherTabs(rel),
    },
    {
      label: "Copy path",
      icon: Copy,
      onSelect: () => {
        void ipc.notePath(rel).then(
          (path) => copyText(path, "Path copied"),
          () => toast.error("Path could not be resolved"),
        );
      },
    },
    {
      label: "Copy relative path",
      icon: Copy,
      onSelect: () => copyText(rel, "Relative path copied"),
    },
  ];
}

function Tab(props: {
  rel: string;
  active: boolean;
  focusable: boolean;
  openMenu: (position: MenuPosition) => void;
}) @{
  const { rel, active, focusable, openMenu } = props;
  const setView = useVault((s) => s.setView);

    <div
      role="tab"
      data-markd-no-drag
      aria-selected={active}
      tabIndex={focusable ? 0 : -1}
      title={rel}
      className={cx(
        "group/tab relative flex h-full min-w-0 max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1 pl-3 pr-1.5 text-[12.5px] transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink",
        active ? "text-ink" : "text-muted hover:text-ink",
      )}
      onClick={() => {
        if (!active) setView({ type: "note", rel });
      }}
      onAuxClick={(event: NativeEvent<HTMLDivElement, MouseEvent>) => {
        // middle-click closes, like every code editor
        if (event.button === 1) closeTab(rel);
      }}
      onContextMenu={(event: NativeEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event: NativeEvent<HTMLDivElement, KeyboardEvent>) => {
        const tabs = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
            '[role="tab"]',
          ) ?? [],
        );
        const index = tabs.indexOf(event.currentTarget);
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") {
          next = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setView({ type: "note", rel });
          return;
        } else return;
        event.preventDefault();
        tabs[next]?.focus();
        tabs[next]?.click();
      }}
    >
      {/* Active fill glides between tabs via shared layout; inactive rows get
          a plain hover tint that doesn't participate in the projection. */}
      @if (active) {
        <motion.div
          layoutId="tab-active-fill"
          transition={SPRING_LAYOUT}
          className="absolute inset-0 bg-bg"
        />
      } @else {
        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-hover/tab:bg-hover/60 group-hover/tab:opacity-100" />
      }
      <span className="relative z-10 truncate">{noteTitle(rel)}</span>
      <Tooltip label="Close ⌘W" side="bottom">
        <button
          type="button"
          aria-label={`Close ${noteTitle(rel)}`}
          className={cx(
            "relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded transition-opacity duration-75 hover:bg-hover",
            active
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover/tab:opacity-60 group-hover/tab:hover:opacity-100",
          )}
          onClick={(event: NativeEvent<HTMLButtonElement, MouseEvent>) => {
            event.stopPropagation();
            closeTab(rel);
          }}
        >
          <X size={11} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
}
