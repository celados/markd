import { Button as BaseButton } from "@octanejs/base-ui/button";
import type { Octane } from "octane/jsx-runtime";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<Variant, string> = {
  primary: "bg-invert text-invert-ink hover:opacity-90",
  secondary: "bg-hover text-ink border border-line",
  outline: "border border-line text-ink hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-ink",
  danger: "text-danger hover:bg-danger/10",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-[12.5px]",
  md: "h-9 gap-2 rounded-lg px-4 text-[13.5px]",
  lg: "h-11 gap-2.5 rounded-lg px-5 text-[14.5px]",
  icon: "h-7 w-7 rounded-md",
};

export type ButtonProps = Omit<Octane.JSX.IntrinsicElements["button"], "children"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: unknown;
};

export function Button(props: ButtonProps) {
  const {
    variant = "secondary",
    size = "md",
    className,
    disabled,
    loading,
    children,
    ...buttonProps
  } = props;
  const isDisabled = disabled || loading;

  return (
    <BaseButton
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "flex select-none items-center justify-center font-medium leading-none transition-[color,background-color,border-color,opacity,transform] duration-100",
        "active:scale-[0.96] motion-reduce:active:scale-100",
        "[&>svg]:block [&>svg]:shrink-0",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...buttonProps}
    >
      {loading ? <Spinner size={14} /> : null}
      {children}
    </BaseButton>
  );
}
