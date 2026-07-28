import CodeBlock from "@tiptap/extension-code-block";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@octanejs/tiptap";
import {
  LuCheck as Check,
  LuCopy as Copy,
} from "@/icons/icons.tsrx";
import { useEffect, useRef, useState } from "octane";
import { ActionSwapIcon } from "@/components/motion/action-swap.tsrx";

function CodeBlockView({ node }: NodeViewProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    await navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <NodeViewWrapper className="code-block-wrap">
      <pre>
        <NodeViewContent as="code" />
      </pre>
      <button
        type="button"
        contentEditable={false}
        aria-label={copied ? "Copied" : "Copy code"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={copy}
        className="code-block-copy"
      >
        <ActionSwapIcon
          value={copied ? "copied" : "copy"}
          animation="roll"
          className="h-[13px] w-[13px]"
          icon={
            copied ? (
              <Check size={13} strokeWidth={2} />
            ) : (
              <Copy size={13} strokeWidth={2} />
            )
          }
        />
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </NodeViewWrapper>
  );
}

export const CodeBlockWithCopy = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
