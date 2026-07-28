import {
  LuChevronDown as ChevronDown,
  LuChevronUp as ChevronUp,
  LuReplace as Replace,
  LuX as X,
} from "@/icons/icons.tsrx";
import { type OctaneNode, useEffect, useRef } from "octane";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/utils";

type FindReplaceBarProps = {
  query: string;
  replaceText: string;
  replaceOpen: boolean;
  current: number;
  total: number;
  onQueryChange: (value: string) => void;
  onReplaceTextChange: (value: string) => void;
  onReplaceOpenChange: (open: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
};

export function FindReplaceBar(props: FindReplaceBarProps) @{
  const {
    query,
    replaceText,
    replaceOpen,
    current,
    total,
    onQueryChange,
    onReplaceTextChange,
    onReplaceOpenChange,
    onPrevious,
    onNext,
    onReplace,
    onReplaceAll,
    onClose,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const hasMatches = total > 0;

  useEffect(() => {
    const input = replaceOpen ? replaceInputRef.current : inputRef.current;
    input?.focus();
    input?.select();
  }, [replaceOpen]);

  const onFindKeyDown = (event: NativeEvent<HTMLInputElement, KeyboardEvent>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) onPrevious();
    else onNext();
  };

  const onReplaceKeyDown = (event: NativeEvent<HTMLInputElement, KeyboardEvent>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onReplace();
    }
  };

    <div
      className={cx(
        "note-find-panel note-find-enter w-[min(336px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line bg-bg",
        replaceOpen && "border-line",
      )}
    >
      <div className="flex h-11 items-center gap-0.5 px-2">
        <div className="flex min-w-0 flex-1 items-center pl-1.5">
          <input
            ref={inputRef}
            type="search"
            aria-label="Find in note"
            value={query}
            onInput={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={onFindKeyDown}
            placeholder="Find and replace"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        @if (query) {
          <>
            <span className="w-auto shrink-0 text-center text-[12px] font-medium tabular-nums text-faint">
              {`${current} of ${total}`}
            </span>
            <IconButton
              label="Previous match"
              tooltip="Previous match ⇧↵"
              disabled={!hasMatches}
              onClick={onPrevious}
              icon={<ChevronUp size={14} strokeWidth={2} />}
            />
            <IconButton
              label="Next match"
              tooltip="Next match ↵"
              disabled={!hasMatches}
              onClick={onNext}
              icon={<ChevronDown size={14} strokeWidth={2} />}
            />
            <IconButton
              label={replaceOpen ? "Hide replace" : "Show replace"}
              tooltip={`${replaceOpen ? "Hide" : "Show"} replace ⌃⌥F`}
              active={replaceOpen}
              onClick={() => onReplaceOpenChange(!replaceOpen)}
              icon={<Replace size={14} strokeWidth={2} />}
            />
          </>
        }
        <IconButton
          label="Close"
          tooltip="Close esc"
          onClick={onClose}
          icon={<X size={14} strokeWidth={2} />}
        />
      </div>
      <div
        className={cx(
          "grid transition-[grid-template-rows] duration-150 ease-in-out motion-reduce:transition-none",
          replaceOpen
            ? "grid-rows-[1fr]"
            : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            inert={!replaceOpen}
            aria-hidden={!replaceOpen}
            className={cx(
              "flex h-12 items-center gap-1 border-t border-line-soft px-2 transition-[opacity,transform] duration-150 motion-reduce:transition-none",
              replaceOpen
                ? "translate-y-0 opacity-100 ease-in-out"
                : "pointer-events-none -translate-y-1 opacity-0 ease-in-out",
            )}
          >
            <input
              ref={replaceInputRef}
              value={replaceText}
              onInput={(event) => onReplaceTextChange(event.currentTarget.value)}
              onKeyDown={onReplaceKeyDown}
              aria-label="Replace with"
              placeholder="Replace with…"
              className="h-9 min-w-0 flex-1 bg-transparent pl-1.5 text-[13px] font-medium text-ink outline-none placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={!hasMatches}
              onClick={onReplaceAll}
              className="h-9 shrink-0 rounded-md px-2 text-[12px] font-semibold text-muted transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
            >
              Replace All
            </button>
            <Tooltip label="Replace current match ↵" side="bottom">
              <span className="inline-flex shrink-0">
                <button
                  type="button"
                  disabled={!hasMatches}
                  onClick={onReplace}
                  aria-label="Replace current match"
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-muted transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent"
                >
                  Replace
                  <span className="font-mono text-[11px]">↵</span>
                </button>
              </span>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
}

function IconButton(props: {
  label: string;
  tooltip?: string;
  active?: boolean;
  disabled?: boolean;
  icon: OctaneNode;
  onClick: () => void;
}) @{
  const {
    label,
    tooltip,
    active = false,
    disabled = false,
    icon,
    onClick,
  } = props;

  @if (tooltip) {
    <Tooltip label={tooltip} side="bottom">
      <span className="inline-flex shrink-0">
        <IconButtonCore
          label={label}
          active={active}
          disabled={disabled}
          onClick={onClick}
          icon={icon}
        />
      </span>
    </Tooltip>
  } @else {
    <IconButtonCore
      label={label}
      active={active}
      disabled={disabled}
      onClick={onClick}
      icon={icon}
    />
  }
}

function IconButtonCore(props: {
  label: string;
  active: boolean;
  disabled: boolean;
  icon: OctaneNode;
  onClick: () => void;
}) @{
  const { label, active, disabled, icon, onClick } = props;

    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent",
        active && "bg-active text-ink",
      )}
    >
      {icon}
    </button>
}
