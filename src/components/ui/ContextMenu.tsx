import { useEffect, useLayoutEffect, useRef, useState } from "octane";
import { createPortal } from "octane";
import type { IconComponent } from "@/icons/icon-types";
import { cx } from "@/lib/utils";

export type MenuItem = {
  label: string;
  icon?: IconComponent;
  danger?: boolean;
  onSelect: () => void;
};

export type MenuPosition = {
  x: number;
  y: number;
};

type ContextMenuProps = {
  position: MenuPosition;
  items: MenuItem[];
  onClose: () => void;
};

export function ContextMenu(props: ContextMenuProps) {
  const { position, items, onClose } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [adjusted, setAdjusted] = useState(position);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setAdjusted({
      x: Math.min(position.x, window.innerWidth - rect.width - 8),
      y: Math.min(position.y, window.innerHeight - rect.height - 8),
    });
  }, [position]);

  useEffect(() => {
    requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const menuItems = Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      const index = menuItems.indexOf(document.activeElement as HTMLElement);
      let next = index;
      if (event.key === "ArrowDown") next = (index + 1) % menuItems.length;
      else if (event.key === "ArrowUp") {
        next = (index - 1 + menuItems.length) % menuItems.length;
      } else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = menuItems.length - 1;
      else return;
      event.preventDefault();
      menuItems[next]?.focus();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-markd-no-drag
      className="fixed z-100 min-w-[168px] rounded-lg border border-line bg-bg p-1 shadow-lg shadow-black/8 dark:shadow-black/40"
      style={{ left: adjusted.x, top: adjusted.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={cx(
            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100",
            item.danger
              ? "text-danger hover:bg-danger/8"
              : "text-ink hover:bg-hover",
          )}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon ? <item.icon size={14} strokeWidth={1.75} /> : null}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
