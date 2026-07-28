import { Input as BaseInput } from "@octanejs/base-ui/input";
import type { Octane } from "octane/jsx-runtime";
import { cn } from "@/lib/utils";

export type InputProps = Octane.JSX.IntrinsicElements["input"];

export function Input(props: InputProps) {
  const { className, type = "text", ...inputProps } = props;

  return (
    <BaseInput
      type={type}
      className={cn(
        "h-9 w-full rounded-lg border border-line-soft bg-panel px-3 text-[12.5px] text-ink outline-none",
        "transition-[border-color,box-shadow,background-color] duration-100 placeholder:text-faint",
        "focus-visible:border-ink/40 focus-visible:ring-2 focus-visible:ring-ink/10",
        "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/10",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...inputProps}
    />
  );
}
