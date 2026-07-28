import { Dialog as BaseDialog } from "@octanejs/base-ui/dialog";
import { cn } from "@/lib/utils";

type Align = "center" | "top";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: unknown;
  align?: Align;
  className?: string;
  ariaLabel?: string;
};

/**
 * Base UI owns dialog semantics, dismissal, transition lifetime, and focus.
 * CSS state transitions avoid introducing a second lifecycle owner.
 */
export function Modal(props: ModalProps) {
  const {
    open,
    onClose,
    children,
    align = "center",
    className,
    ariaLabel,
  } = props;

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            "fixed inset-0 z-80 bg-background/5 backdrop-blur-sm",
            "transition-opacity duration-200 ease-out",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          )}
        />
        <BaseDialog.Viewport
          className={cn(
            "fixed inset-0 z-80 flex justify-center",
            align === "center" ? "items-center" : "items-start",
          )}
        >
          <BaseDialog.Popup
            aria-modal="true"
            aria-label={ariaLabel}
            className={cn(
              "relative z-50 max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl shadow-black/20 outline-none dark:shadow-black/60",
              "transition-[opacity,transform] duration-200 ease-out",
              "data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0",
              align === "top"
                ? "data-[starting-style]:-translate-y-2 data-[ending-style]:-translate-y-1"
                : "data-[starting-style]:translate-y-2 data-[ending-style]:translate-y-1",
              "motion-reduce:data-[starting-style]:transform-none motion-reduce:data-[ending-style]:transform-none",
              className,
            )}
          >
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
