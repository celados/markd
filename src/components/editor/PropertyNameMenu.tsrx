import type { IconComponent } from "@/icons/icon-types";
import {
  LuCalendarDays as CalendarDays,
  LuCaseSensitive as CaseSensitive,
  LuCheck as Check,
  LuCheckSquare as CheckSquare,
  LuChevronDown as ChevronDown,
  LuHash as Hash,
  LuLink2 as Link2,
  LuList as List,
} from "@/icons/icons.tsrx";
import { useRef } from "octane";
import { MorphPopover } from "@/components/motion/popover-morph.tsrx";
import type { PropertyType } from "@/lib/frontmatter";

const PROPERTY_TYPES = [
  { type: "text", label: "Text", icon: CaseSensitive },
  { type: "number", label: "Number", icon: Hash },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "date", label: "Date", icon: CalendarDays },
  { type: "url", label: "URL", icon: Link2 },
  { type: "list", label: "List", icon: List },
] satisfies Array<{
  type: PropertyType;
  label: string;
  icon: IconComponent;
}>;

type PropertyNameMenuProps = {
  name: string;
  type: PropertyType;
  open: boolean;
  invalid: boolean;
  errorMessage: string;
  onOpenChange: (open: boolean) => void;
  onDismiss: (reason?: string) => void;
  onNameChange: (name: string) => void;
  onNameSubmit: () => void;
  onTypeChange: (type: PropertyType) => void;
};

export function PropertyNameMenu(props: PropertyNameMenuProps) @{
  const {
    name,
    type,
    open,
    invalid,
    errorMessage,
    onOpenChange,
    onDismiss,
    onNameChange,
    onNameSubmit,
    onTypeChange,
  } = props;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const TypeIcon =
    PROPERTY_TYPES.find((option) => option.type === type)?.icon ?? CaseSensitive;

  <MorphPopover
    open={open}
    onOpenChange={(nextOpen, details) => {
      if (nextOpen) onOpenChange(true);
      else onDismiss(details?.reason);
    }}
    className="w-40 shrink-0"
    ariaLabel="Edit property"
    align="start"
    sideOffset={4}
    radius={10}
    contentClassName="w-56 bg-bg p-1.5"
    trigger={
      <button
        ref={triggerRef}
        type="button"
        aria-label={name ? `Edit ${name} property` : "Name property"}
        className="flex h-9 w-full items-center gap-2 rounded-md bg-transparent px-2 text-left text-[12.5px] text-faint outline-none transition-[color,box-shadow,scale] duration-100 hover:text-ink focus-visible:ring-1 focus-visible:ring-line active:scale-[0.96]"
      >
        <TypeIcon size={14} strokeWidth={1.8} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {name || "Property name"}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    }
    content={
      <PropertyMenuContent
        name={name}
        type={type}
        invalid={invalid}
        errorMessage={errorMessage}
        nameRef={nameRef}
        triggerRef={triggerRef}
        onNameChange={onNameChange}
        onNameSubmit={onNameSubmit}
        onTypeChange={onTypeChange}
        onOpenChange={onOpenChange}
      />
    }
  />
}

type MutableRef<T> = { current: T | null };

function PropertyMenuContent(props: {
  name: string;
  type: PropertyType;
  invalid: boolean;
  errorMessage: string;
  nameRef: MutableRef<HTMLInputElement>;
  triggerRef: MutableRef<HTMLButtonElement>;
  onNameChange: (name: string) => void;
  onNameSubmit: () => void;
  onTypeChange: (type: PropertyType) => void;
  onOpenChange: (open: boolean) => void;
}) @{
  const {
    name,
    type,
    invalid,
    errorMessage,
    nameRef,
    triggerRef,
    onNameChange,
    onNameSubmit,
    onTypeChange,
    onOpenChange,
  } = props;

  <>
      <div className="pb-1.5">
        <input
          ref={nameRef}
          data-autofocus
          value={name}
          onInput={(event) => onNameChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onNameSubmit();
            }
          }}
          aria-invalid={invalid || undefined}
          aria-label="Property name"
          placeholder="Property name"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          title={invalid ? errorMessage : undefined}
          className="h-9 w-full rounded-lg bg-sunken px-2.5 text-[12.5px] text-ink outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:bg-panel focus:ring-1 focus:ring-line aria-invalid:ring-danger"
        />
      </div>
      <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
        Type
      </p>
      <div className="grid grid-cols-2 gap-0.5">
        @for (const option of PROPERTY_TYPES; key option.type) {
          <button
            type="button"
            data-morph-item
            onClick={() => {
              onTypeChange(option.type);
              if (!name.trim()) {
                nameRef.current?.focus();
                return;
              }
              triggerRef.current?.focus();
              onOpenChange(false);
            }}
            className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-none"
          >
            <option.icon size={13} strokeWidth={1.8} className="shrink-0" />
            <span className="flex-1">{option.label}</span>
            @if (type === option.type) {
              <Check size={11} strokeWidth={2.2} className="shrink-0" />
            }
          </button>
        }
      </div>
  </>
}
