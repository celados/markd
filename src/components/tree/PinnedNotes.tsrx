import {
  LuFileText as FileText,
  LuPin as Pin,
  LuPinOff as PinOff,
} from "@/icons/icons.tsrx";
import { motion } from "@octanejs/motion";
import { useMemo, useState } from "octane";
import {
  ContextMenu,
  type MenuPosition,
} from "@/components/ui/ContextMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { EASE_OUT } from "@/lib/ease";
import type { TreeNode } from "@/lib/types";
import { cx } from "@/lib/utils";
import { usePins } from "@/stores/pins";
import { useVault } from "@/stores/vault";
import { RenameInput } from "./RenameInput";
import { FolderMorphIcon } from "./FolderMorphIcon";
import { entryMenuItems } from "./treeMenu";

type PinnedMenu = {
  position: MenuPosition;
  node: TreeNode;
  root: boolean;
};

export function PinnedNotes() {
  const pins = usePins((state) => state.pins);
  const stale = usePins((state) => state.stale);
  const tree = useVault((state) => state.tree);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<PinnedMenu | null>(null);
  const nodes = useMemo(
    () => pins.map((rel) => findNode(tree, rel)).filter(isTreeNode),
    [pins, tree],
  );

  if (nodes.length === 0 && stale.length === 0) return null;

  return (
    <section className="px-2 pb-1">
      <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
        <Pin size={11.5} strokeWidth={2} />
        <span>Pinned</span>
      </div>

      <div
        data-pinned-tree
        role="tree"
        aria-label="Pinned notes and folders"
        className="no-scrollbar max-h-[180px] overflow-y-auto"
      >
        @for (const node of nodes; key node.rel) {
          <PinnedRow
            node={node}
            depth={0}
            root
            renaming={renaming}
            setRenaming={setRenaming}
            openMenu={(position, selected, selectedRoot) =>
              setMenu({ position, node: selected, root: selectedRoot })
            }
          />
        }
        @for (const rel of stale; key rel) {
          <StalePinnedRow rel={rel} />
        }
      </div>

      @if (menu) {
        <ContextMenu
          position={menu.position}
          items={entryMenuItems(menu.node, {
            onRename: setRenaming,
            pinMode: menu.root ? "unpin" : "none",
          })}
          onClose={() => setMenu(null)}
        />
      }

      <div className="mx-2 my-2 border-t border-line-soft" />
    </section>
  );
}

function StalePinnedRow(props: { rel: string }) @{
  const { rel } = props;
  const unpin = usePins((state) => state.unpin);
  const name = rel.split("/").at(-1) ?? rel;

  <div
    role="treeitem"
    data-status="stale"
    data-rel={rel}
    className="group flex h-[30px] items-center rounded-md px-2 text-[13px] text-faint"
  >
    <FileText size={14} strokeWidth={1.75} className="mr-2 shrink-0" />
    <span className="min-w-0 flex-1 truncate line-through" title={rel}>{name}</span>
    <span className="mr-1 text-[10px] uppercase tracking-wide">Missing</span>
    <Tooltip label={`Unpin missing ${name}`} side="right">
      <button
        type="button"
        aria-label={`Unpin missing ${name}`}
        className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 transition-opacity duration-100 hover:bg-active group-hover:opacity-60 group-focus-within:opacity-60 hover:opacity-100"
        onClick={() => void unpin(rel)}
      >
        <PinOff size={11.5} strokeWidth={2} />
      </button>
    </Tooltip>
  </div>
}

function PinnedRow(props: {
  node: TreeNode;
  depth: number;
  root: boolean;
  renaming: string | null;
  setRenaming: (rel: string | null) => void;
  openMenu: (position: MenuPosition, node: TreeNode, root: boolean) => void;
}) @{
  const { node, depth, root, renaming, setRenaming, openMenu } = props;
  const view = useVault((state) => state.view);
  const expanded = useVault((state) => state.expanded);
  const toggleExpanded = useVault((state) => state.toggleExpanded);
  const setView = useVault((state) => state.setView);
  const unpin = usePins((state) => state.unpin);
  const isFolder = node.kind === "folder";
  const isOpen = expanded.has(node.rel);
  const isActive = view?.type === "note" && view.rel === node.rel;
  const isRenaming = renaming === node.rel;

  const activate = () => {
    if (isFolder) toggleExpanded(node.rel);
    else setView({ type: "note", rel: node.rel });
  };

  <>
      <div
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={isFolder ? isOpen : undefined}
        tabIndex={0}
        data-rel={node.rel}
        className={cx(
          "group flex h-[30px] cursor-pointer items-center rounded-md pr-1.5 text-[13px] transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink",
          isActive
            ? "bg-active text-ink"
            : "text-muted hover:bg-hover hover:text-ink",
        )}
        style={{ paddingLeft: 8 + depth * 15 }}
        onClick={activate}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu({ x: event.clientX, y: event.clientY }, node, root);
        }}
        onKeyDown={(event) => {
          if (isRenaming) return;
          const treeRoot = event.currentTarget.closest('[role="tree"]');
          const items = Array.from(
            treeRoot?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
          );
          const index = items.indexOf(event.currentTarget);
          const focusAt = (next: number) => {
            const item = items[next];
            if (!item) return;
            event.preventDefault();
            item.focus();
          };

          if (event.key === "ArrowDown") {
            focusAt(Math.min(index + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            focusAt(Math.max(index - 1, 0));
          } else if (event.key === "Home") {
            focusAt(0);
          } else if (event.key === "End") {
            focusAt(items.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          } else if (event.key === "ArrowRight" && isFolder && !isOpen) {
            event.preventDefault();
            toggleExpanded(node.rel);
          } else if (event.key === "ArrowRight" && isFolder && isOpen) {
            focusAt(index + 1);
          } else if (event.key === "ArrowLeft" && isFolder && isOpen) {
            event.preventDefault();
            toggleExpanded(node.rel);
          } else if (event.key === "ArrowLeft" && depth > 0) {
            event.preventDefault();
            const parent = node.rel.split("/").slice(0, -1).join("/");
            items.find((item) => item.dataset.rel === parent)?.focus();
          } else if (event.key === "F2") {
            event.preventDefault();
            setRenaming(node.rel);
          }
        }}
      >
        @if (isFolder) {
          <FolderMorphIcon
            open={isOpen}
            className="mr-2 h-[14px] w-[14px] shrink-0 text-faint"
          />
        } @else {
          <FileText
            size={14}
            strokeWidth={1.75}
            className={cx(
              "mr-2 shrink-0",
              isActive ? "text-ink" : "text-faint",
            )}
          />
        }

        @if (isRenaming) {
          <RenameInput node={node} onDone={() => setRenaming(null)} />
        } @else {
          <span className={cx("min-w-0 flex-1 truncate", isFolder && "font-medium")}>
            {node.name}
          </span>
        }
        @if (root && !isRenaming) {
          <Tooltip label={isFolder ? "Unpin folder" : "Unpin note"} side="right">
            <button
              type="button"
              aria-label={isFolder ? `Unpin ${node.name} folder` : `Unpin ${node.name}`}
              className="grid h-5 w-5 shrink-0 place-items-center rounded opacity-0 transition-opacity duration-100 hover:bg-active group-hover:opacity-60 group-focus-within:opacity-60 hover:opacity-100"
              onClick={(event: NativeEvent<HTMLButtonElement, MouseEvent>) => {
                event.stopPropagation();
                void unpin(node.rel);
              }}
            >
              <PinOff size={11.5} strokeWidth={2} />
            </button>
          </Tooltip>
        }
      </div>

      @if (isFolder && isOpen) {
        <motion.div
          role="group"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          className="overflow-hidden"
        >
          @for (const child of node.children ?? []; key child.rel) {
            <PinnedRow
              node={child}
              depth={depth + 1}
              root={false}
              renaming={renaming}
              setRenaming={setRenaming}
              openMenu={openMenu}
            />
          }
          @if (node.children?.length === 0) {
            <p
              className="py-0.5 text-[12px] italic text-faint"
              style={{ paddingLeft: 26 + (depth + 1) * 14 }}
            >
              empty
            </p>
          }
        </motion.div>
      }
  </>
}

function findNode(nodes: TreeNode[], rel: string): TreeNode | null {
  for (const node of nodes) {
    if (node.rel === rel) return node;
    const child = node.children ? findNode(node.children, rel) : null;
    if (child) return child;
  }
  return null;
}

function isTreeNode(node: TreeNode | null): node is TreeNode {
  return node !== null;
}
