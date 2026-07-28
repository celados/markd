"use client";

import { Popover as BasePopover } from "@octanejs/base-ui/popover";
import { type OctaneNode, useRef } from "octane";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom";
type Align = "start" | "end";

export interface MorphPopoverProps {
  trigger: OctaneNode;
  content: OctaneNode;
  ariaLabel: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details?: { reason?: string }) => void;
  className?: string;
  contentClassName?: string;
  side?: Side;
  align?: Align;
  sideOffset?: number;
  radius?: number;
}

/**
 * Keeps trigger and popup payloads explicit because TSRX slots are executable
 * render regions, not React-style opaque children values.
 */
export function MorphPopover(props: MorphPopoverProps) @{
  const {
    trigger,
    content,
    ariaLabel,
    open,
    defaultOpen = false,
    onOpenChange,
    className,
    contentClassName,
    side = "bottom",
    align = "end",
    sideOffset = 8,
    radius = 16,
  } = props;
  const contentRef = useRef<HTMLDivElement | null>(null);

  const onMenuKeyDown = (event: NativeEvent<HTMLDivElement, KeyboardEvent>) => {
    const items = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>("[data-morph-item]") ??
        [],
    );
    if (items.length === 0) return;

    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") {
      next = (index - 1 + items.length) % items.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  <BasePopover.Root
    open={open}
    defaultOpen={defaultOpen}
    onOpenChange={(nextOpen: boolean, details: { reason?: string }) =>
      onOpenChange?.(nextOpen, details)
    }
  >
    <div className={cn("inline-flex", className)}>
      <BasePopover.Trigger render={trigger} className="inline-flex" />
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-30"
        >
          <BasePopover.Popup
            ref={contentRef}
            aria-label={ariaLabel}
            onKeyDown={onMenuKeyDown}
            style={{
              "--morph-hidden-clip": clipHidden(side, align, radius),
              "--morph-radius": `${radius}px`,
              clipPath: clipShown(radius),
              transformOrigin: originFor(side, align),
              borderRadius: radius,
            }}
            className={cn(
              "overflow-hidden border border-border bg-background outline-none",
              "[filter:drop-shadow(0_10px_18px_rgba(0,0,0,0.14))]",
              "transition-[clip-path,opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "data-[starting-style]:[clip-path:var(--morph-hidden-clip)] data-[ending-style]:[clip-path:var(--morph-hidden-clip)]",
              "data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0",
              "motion-reduce:transition-opacity",
              "motion-reduce:data-[starting-style]:[clip-path:inset(0_0_0_0_round_var(--morph-radius))]",
              "motion-reduce:data-[ending-style]:[clip-path:inset(0_0_0_0_round_var(--morph-radius))]",
              "motion-reduce:data-[starting-style]:transform-none motion-reduce:data-[ending-style]:transform-none",
              contentClassName,
            )}
          >
            {content}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </div>
  </BasePopover.Root>
}

const originFor = (side: Side, align: Align) =>
  `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`;

function clipHidden(side: Side, align: Align, radius: number) {
  const top = side === "bottom" ? "0%" : "92%";
  const bottom = side === "bottom" ? "92%" : "0%";
  const right = align === "end" ? "0%" : "92%";
  const left = align === "end" ? "92%" : "0%";
  return `inset(${top} ${right} ${bottom} ${left} round ${radius}px)`;
}

const clipShown = (radius: number) => `inset(0% 0% 0% 0% round ${radius}px)`;
