import { Tooltip as BaseTooltip } from "@octanejs/base-ui/tooltip";

type Side = "top" | "bottom" | "left" | "right";

const GAP = 6;
const DELAY_MS = 120;

type TooltipProps = {
  label: string;
  side?: Side;
  children: unknown;
};

export function Tooltip(props: TooltipProps) {
  const { label, side = "bottom", children } = props;

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        render={<span className="inline-flex" />}
        delay={DELAY_MS}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={GAP}>
          <BaseTooltip.Popup className="tooltip-pop z-110 whitespace-nowrap rounded-md bg-invert px-2 py-1 text-[11px] font-medium text-invert-ink shadow-md shadow-black/15">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
