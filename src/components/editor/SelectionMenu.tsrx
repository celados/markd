import type { Editor } from "@octanejs/tiptap";
import { BubbleMenu } from "@octanejs/tiptap/menus";
import {
  LuArrowLeft as ArrowLeft,
  LuBold as Bold,
  LuCode as Code,
  LuHighlighter as Highlighter,
  LuItalic as Italic,
  LuLink as LinkIcon,
  LuPalette as Palette,
  LuRotateCcw as RotateCcw,
  LuStrikethrough as Strikethrough,
  LuUnderline as Underline,
} from "@/icons/icons.tsrx";
import { type OctaneNode, useEffect, useRef, useState } from "octane";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/utils";
import { BACKGROUND_COLORS, TEXT_COLORS } from "./textColors";

type ColorMode = "text" | "background";

export function SelectionMenu(props: { editor: Editor }) @{
  const { editor } = props;
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (linkOpen) linkInputRef.current?.focus();
  }, [linkOpen]);

  const applyLink = () => {
    const url = linkInputRef.current?.value.trim();
    setLinkOpen(false);
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  <BubbleMenu
      editor={editor}
      pluginKey="selection-menu"
      shouldShow={({ state }) => !state.selection.empty}
      options={{ placement: "top", offset: 8 }}
    >
      <div className="flex items-center rounded-lg border border-line bg-bg p-0.5 shadow-lg shadow-black/8 dark:shadow-black/40">
        @if (linkOpen) {
          <div className="flex items-center gap-1 px-1">
            <input
              ref={linkInputRef}
              defaultValue={editor.getAttributes("link").href ?? ""}
              placeholder="Paste a link…"
              className="h-7 w-[200px] bg-transparent px-1 text-[12.5px] text-ink outline-none placeholder:text-faint"
              onKeyDown={(event) => {
                if (event.key === "Enter") applyLink();
                if (event.key === "Escape") setLinkOpen(false);
              }}
              onBlur={() => setLinkOpen(false)}
            />
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[12px] font-medium text-ink hover:bg-hover"
              onMouseDown={(event) => {
                event.preventDefault();
                applyLink();
              }}
            >
              Set
            </button>
          </div>
        } @else if (colorMode) {
          <ColorPicker
            editor={editor}
            mode={colorMode}
            onBack={() => setColorMode(null)}
          />
        } @else {
          <>
            <MarkButton
              active={editor.isActive("bold")}
              label="Bold"
              onClick={() => editor.chain().focus().toggleBold().run()}
              icon={<Bold size={14} strokeWidth={2} />}
            />
            <MarkButton
              active={editor.isActive("italic")}
              label="Italic"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              icon={<Italic size={14} strokeWidth={2} />}
            />
            <MarkButton
              active={editor.isActive("underline")}
              label="Underline"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              icon={<Underline size={14} strokeWidth={2} />}
            />
            <MarkButton
              active={editor.isActive("strike")}
              label="Strikethrough"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              icon={<Strikethrough size={14} strokeWidth={2} />}
            />
            <MarkButton
              active={editor.isActive("code")}
              label="Code"
              onClick={() => editor.chain().focus().toggleCode().run()}
              icon={<Code size={14} strokeWidth={2} />}
            />
            <div className="mx-0.5 h-4 w-px bg-line" />
            <MarkButton
              active={Boolean(editor.getAttributes("textStyle").color)}
              label="Text color"
              onClick={() => setColorMode("text")}
              icon={<Palette size={14} strokeWidth={2} />}
            />
            <MarkButton
              active={Boolean(editor.getAttributes("textStyle").backgroundColor)}
              label="Highlight color"
              onClick={() => setColorMode("background")}
              icon={<Highlighter size={14} strokeWidth={2} />}
            />
            <div className="mx-0.5 h-4 w-px bg-line" />
            <MarkButton
              active={editor.isActive("link")}
              label="Link"
              onClick={() => setLinkOpen(true)}
              icon={<LinkIcon size={14} strokeWidth={2} />}
            />
          </>
        }
      </div>
    </BubbleMenu>
}

type ColorPickerProps = {
  editor: Editor;
  mode: ColorMode;
  onBack: () => void;
};

function ColorPicker(props: ColorPickerProps) @{
  const { editor, mode, onBack } = props;
  const colors: ReadonlyArray<{ label: string; value: string }> =
    mode === "text" ? TEXT_COLORS : BACKGROUND_COLORS;
  const active = editor.getAttributes("textStyle")[
    mode === "text" ? "color" : "backgroundColor"
  ];

  const apply = (value?: string) => {
    const chain = editor.chain().focus();
    if (mode === "text") {
      value ? chain.setColor(value).run() : chain.unsetColor().run();
    } else {
      value
        ? chain.setBackgroundColor(value).run()
        : chain.unsetBackgroundColor().run();
    }
  };

  <div className="flex h-8 items-center gap-1 px-0.5">
      <button
        type="button"
        aria-label="Back to formatting"
        className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
        onMouseDown={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <ArrowLeft size={14} strokeWidth={2} />
      </button>
      <span className="mr-1 text-[11.5px] font-medium text-muted">
        {mode === "text" ? "Text" : "Highlight"}
      </span>
      @for (const color of colors; key color.value) {
        <button
          type="button"
          aria-label={`${color.label} ${mode === "text" ? "text" : "highlight"}`}
          aria-pressed={active === color.value}
          className={cx(
            "grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-hover",
            active === color.value && "bg-active",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            apply(color.value);
          }}
        >
          <span
            className={cx(
              "h-3.5 w-3.5 rounded-full",
              mode === "background" && "ring-1 ring-black/8",
            )}
            style={{ backgroundColor: color.value }}
          />
        </button>
      }
      <button
        type="button"
        aria-label={`Reset ${mode === "text" ? "text" : "highlight"} color`}
        className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
        onMouseDown={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <RotateCcw size={13} strokeWidth={2} />
      </button>
    </div>
}

type MarkButtonProps = {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: OctaneNode;
};

function MarkButton(props: MarkButtonProps) @{
  const { active, label, onClick, icon } = props;

  <Tooltip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        className={cx(
          "grid h-7 w-7 place-items-center rounded-md transition-colors duration-75",
          active ? "bg-invert text-invert-ink" : "text-muted hover:bg-hover hover:text-ink",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          onClick();
        }}
      >
        {icon}
      </button>
    </Tooltip>
}
