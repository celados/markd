import {
  FileTree as TreesModel,
  preparePresortedFileTreeInput,
  type ContextMenuOpenContext,
  type FileTreeDirectoryHandle,
  type FileTreeDropContext,
} from "@pierre/trees";
import { toast } from "@octanejs/sonner";
import { useEffect, useMemo, useRef } from "octane";
import type { MenuItem } from "@/components/ui/ContextMenu";
import {
  createTreesProjection,
  diffTreesProjection,
  fromTreesPath,
  type TreesProjection,
} from "@/lib/trees-projection";
import { parentDir } from "@/lib/utils";
import { usePins } from "@/stores/pins";
import { useVault } from "@/stores/vault";
import { entryMenuItems } from "./treeMenu";

const TREE_STYLES = `
:host {
  --trees-bg-override: transparent;
  --trees-fg-override: var(--color-muted);
  --trees-fg-muted-override: var(--color-faint);
  --trees-border-color-override: var(--color-line);
  --trees-focus-ring-color-override: var(--color-ink);
  --trees-list-hover-bg-override: var(--color-hover);
  --trees-selected-bg-override: var(--color-active);
  --trees-selected-fg-override: var(--color-ink);
  --trees-padding-inline-override: 8px;
  --trees-font-family-override: var(--font-sans);
  --trees-font-size-override: 13px;
  min-height: 0;
}

[data-file-tree-virtualized-scroll="true"] {
  padding-bottom: 24px;
  padding-top: 4px;
}
`;

type Runtime = {
  model: TreesModel;
  projection: TreesProjection;
};

type InteractionSnapshot = {
  expandedPaths: readonly string[];
  focusedPath: string | null;
  selectedPaths: readonly string[];
};

export function TreesFileTree() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const tree = useVault((state) => state.tree);
  const expanded = useVault((state) => state.expanded);
  const view = useVault((state) => state.view);
  const pins = usePins((state) => state.pins);
  const projection = useMemo(
    () => createTreesProjection(tree, new Set(pins)),
    [pins, tree],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const initial = createTreesProjection(
      useVault.getState().tree,
      new Set(usePins.getState().pins),
    );
    let runtime: Runtime;
    const restoreCanonical = (interaction = captureInteraction(runtime)) => {
      // beta.6 exposes completion callbacks only after synchronously mutating
      // its model; it has no pre-mutation transaction/cancel hook. A microtask
      // is the earliest stable seam to replay disk truth without a painted
      // optimistic state or an arbitrary timing delay.
      queueMicrotask(() => {
        if (runtimeRef.current !== runtime) return;
        runtime.model.resetPaths({
          preparedInput: preparePresortedFileTreeInput(runtime.projection.paths),
          initialExpandedPaths: interaction.expandedPaths,
        });
        for (const path of interaction.expandedPaths) {
          const item = runtime.model.getItem(path);
          if (item?.isDirectory()) (item as FileTreeDirectoryHandle).expand();
        }
        for (const path of runtime.model.getSelectedPaths()) {
          runtime.model.getItem(path)?.deselect();
        }
        for (const path of interaction.selectedPaths) {
          runtime.model.getItem(path)?.select();
        }
        if (interaction.focusedPath) {
          runtime.model.focusNearestPath(interaction.focusedPath);
          focusTreeDomPath(runtime, interaction.focusedPath);
        }
      });
    };
    let dragInteraction: InteractionSnapshot | null = null;
    const persistDrop = (event: FileTreeDropContext) => {
      const source = event.draggedPaths[0];
      if (!source) return;
      const rel = fromTreesPath(source);
      const dir = event.target.directoryPath
        ? fromTreesPath(event.target.directoryPath)
        : "";
      const interaction = normalizeDragInteraction(
        dragInteraction ?? captureInteraction(runtime),
        rel,
        dir,
      );
      restoreCanonical(interaction);
      dragInteraction = null;
      void useVault
        .getState()
        .moveEntry(rel, dir)
        .then((persistedPath) => {
          if (!persistedPath) {
            restoreCanonical(interaction);
            return;
          }
          syncCanonicalProjection(runtime, persistedPath);
        });
    };

    const initialView = useVault.getState().view;
    const model = new TreesModel({
      preparedInput: preparePresortedFileTreeInput(initial.paths),
      initialExpandedPaths: [...useVault.getState().expanded],
      initialSelectedPaths:
        initialView?.type === "note" ? [initialView.rel] : [],
      dragAndDrop: {
        canDrag: (paths) => paths.length === 1,
        canDrop: (event) => {
          dragInteraction ??= captureInteraction(runtime);
          return canPersistDrop(event);
        },
        onDropComplete: persistDrop,
        onDropError: (error) => toast.error(error),
      },
      renaming: {
        onError: (error) => toast.error(error),
        onRename: (event) => {
          const interaction = captureInteraction(runtime);
          restoreCanonical(interaction);
          const destination = fromTreesPath(event.destinationPath);
          const name = destination.slice(destination.lastIndexOf("/") + 1);
          void useVault
            .getState()
            .renameEntry(fromTreesPath(event.sourcePath), name)
            .then((persistedPath) => {
              if (!persistedPath) {
                restoreCanonical(interaction);
                return;
              }
              syncCanonicalProjection(runtime, persistedPath);
            });
        },
      },
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: "both",
          buttonVisibility: "when-needed",
          render: (item, context) => {
            const rel = fromTreesPath(item.path);
            const node = runtime.projection.byRel.get(rel);
            if (!node) {
              context.close();
              return null;
            }
            return renderContextMenu(
              entryMenuItems(node, {
                onRename: (path) => runtime.model.startRenaming(path),
                pinMode: "toggle",
              }),
              context,
            );
          },
        },
      },
      onSelectionChange: (selectedPaths) => {
        const selected = selectedPaths.at(-1);
        if (!selected) return;
        const rel = fromTreesPath(selected);
        if (runtime.projection.byRel.get(rel)?.kind === "note") {
          useVault.getState().setView({ type: "note", rel });
        }
      },
      initialVisibleRowCount: 18,
      itemHeight: 30,
      overscan: 8,
      unsafeCSS: TREE_STYLES,
    });
    runtime = { model, projection: initial };
    runtimeRef.current = runtime;
    model.render({ containerWrapper: host });
    const unsubscribeExpansion = model.subscribe(() => syncExpandedState(runtime));
    const treeContainer = model.getFileTreeContainer();
    if (treeContainer) {
      treeContainer.setAttribute("data-note-tree", "");
      treeContainer.style.height = "100%";
      treeContainer.style.minHeight = "0";
      treeContainer.style.flex = "1 1 0";
      treeContainer.shadowRoot
        ?.querySelector<HTMLElement>('[role="tree"]')
        ?.setAttribute("aria-label", "Notes");
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = model.getFocusedItem();
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      if (item.isDirectory()) (item as FileTreeDirectoryHandle).toggle();
      else item.select();
    };
    const onDragStart = () => {
      dragInteraction = captureInteraction(runtime);
    };
    treeContainer?.addEventListener("keydown", onKeyDown);
    treeContainer?.addEventListener("dragstart", onDragStart);

    return () => {
      treeContainer?.removeEventListener("keydown", onKeyDown);
      treeContainer?.removeEventListener("dragstart", onDragStart);
      unsubscribeExpansion();
      runtimeRef.current = null;
      model.cleanUp();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.projection === projection) return;
    applyProjection(runtime, projection);
  }, [projection]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    for (const rel of expanded) {
      const item = runtime.model.getItem(rel);
      if (item?.isDirectory()) (item as FileTreeDirectoryHandle).expand();
    }
  }, [expanded]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || view?.type !== "note") return;
    const item = runtime.model.getItem(view.rel);
    if (item && !item.isSelected()) item.select();
  }, [view]);

  return (
    <div
      ref={hostRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      data-markd-trees-host
    >
      {tree.length === 0 ? (
        <p className="pointer-events-none absolute z-1 px-4 pt-3 text-[12.5px] leading-relaxed text-faint">
          No notes yet. Press <kbd className="rounded border border-line bg-bg px-1 font-mono text-[10.5px]">⌘N</kbd> to create one.
        </p>
      ) : null}
    </div>
  );
}

function renderContextMenu(
  items: readonly MenuItem[],
  context: ContextMenuOpenContext,
): HTMLElement {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("data-markd-no-drag", "");
  menu.setAttribute("data-file-tree-context-menu-root", "true");
  menu.className =
    "z-100 min-w-[168px] rounded-lg border border-line bg-bg p-1 shadow-lg shadow-black/8 dark:shadow-black/40";

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.className = item.danger
      ? "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-danger/8"
      : "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover";
    button.addEventListener("click", () => {
      context.close();
      item.onSelect();
    });
    menu.appendChild(button);
  }

  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  });
  return menu;
}

function canPersistDrop(event: FileTreeDropContext): boolean {
  if (event.draggedPaths.length !== 1) return false;
  const source = fromTreesPath(event.draggedPaths[0]!);
  const dir = event.target.directoryPath
    ? fromTreesPath(event.target.directoryPath)
    : "";
  return source !== dir && !dir.startsWith(`${source}/`) && parentDir(source) !== dir;
}

function getExpandedPaths(runtime: Runtime): string[] {
  const paths: string[] = [];
  for (const [rel, node] of runtime.projection.byRel) {
    if (node.kind !== "folder") continue;
    const item = runtime.model.getItem(rel);
    if (item?.isDirectory() && (item as FileTreeDirectoryHandle).isExpanded()) paths.push(rel);
  }
  return paths;
}

function captureInteraction(runtime: Runtime): InteractionSnapshot {
  return {
    expandedPaths: getExpandedPaths(runtime),
    focusedPath: runtime.model.getFocusedPath(),
    selectedPaths: runtime.model.getSelectedPaths(),
  };
}

function normalizeDragInteraction(
  interaction: InteractionSnapshot,
  source: string,
  destinationDirectory: string,
): InteractionSnapshot {
  const name = source.slice(source.lastIndexOf("/") + 1);
  const destination = destinationDirectory ? `${destinationDirectory}/${name}` : name;
  const restorePath = (path: string) =>
    path === destination || path.startsWith(`${destination}/`)
      ? source + path.slice(destination.length)
      : path;
  const expandedPaths = new Set(interaction.expandedPaths.map(restorePath));
  const parts = source.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    expandedPaths.add(parts.slice(0, index).join("/"));
  }
  const selectedPaths = interaction.selectedPaths.map(restorePath);
  if (!selectedPaths.includes(source)) selectedPaths.push(source);
  return {
    expandedPaths: [...expandedPaths],
    focusedPath: restorePath(interaction.focusedPath ?? source),
    selectedPaths,
  };
}

function syncExpandedState(runtime: Runtime): void {
  const current = useVault.getState().expanded;
  const next = new Set(current);
  for (const [rel, node] of runtime.projection.byRel) {
    if (node.kind !== "folder") continue;
    next.delete(rel);
    const item = runtime.model.getItem(rel);
    if (item?.isDirectory() && (item as FileTreeDirectoryHandle).isExpanded()) {
      next.add(rel);
    }
  }
  if (setsEqual(current, next)) return;
  useVault.setState({ expanded: next });
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function syncCanonicalProjection(runtime: Runtime, revealPath: string): void {
  const expandedPaths = new Set(useVault.getState().expanded);
  const revealParts = revealPath.split("/");
  for (let index = 1; index < revealParts.length; index += 1) {
    expandedPaths.add(revealParts.slice(0, index).join("/"));
  }
  const next = createTreesProjection(
    useVault.getState().tree,
    new Set(usePins.getState().pins),
  );
  // A local rename/drop has already mutated Trees optimistically. Persistence
  // may choose another path (for example a collision suffix), so replaying a
  // Vault diff would apply the same intent twice. Reconcile once from the
  // confirmed disk snapshot; external Vault Changes still use incremental
  // `batch` operations in the projection effect above.
  runtime.projection = next;
  runtime.model.resetPaths({
    preparedInput: preparePresortedFileTreeInput(next.paths),
    initialExpandedPaths: [...expandedPaths],
  });
  for (const rel of expandedPaths) {
    const item = runtime.model.getItem(rel);
    if (item?.isDirectory()) (item as FileTreeDirectoryHandle).expand();
  }
  const view = useVault.getState().view;
  if (view?.type === "note") {
    runtime.model.getItem(view.rel)?.select();
    runtime.model.focusNearestPath(view.rel);
    focusTreeDomPath(runtime, view.rel);
  }
}

function applyProjection(runtime: Runtime, next: TreesProjection): void {
  const operations = diffTreesProjection(runtime.projection, next);
  runtime.projection = next;
  if (operations.length > 0) runtime.model.batch(operations);
}

function focusTreeDomPath(runtime: Runtime, path: string): void {
  runtime.model.scrollToPath(path, { focus: true, offset: "nearest" });
  // Trees and the path-keyed editor both commit after a persisted rename/move.
  // The second paint boundary is the first point after the new row mounts and
  // the remounted editor has applied its autofocus, so tree intent wins without
  // an arbitrary timer.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rows = runtime.model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelectorAll<HTMLElement>("[data-item-path]");
      for (const row of rows ?? []) {
        if (
          row.dataset.itemPath === path ||
          fromTreesPath(row.dataset.itemPath ?? "") === fromTreesPath(path)
        ) {
          row.focus();
          return;
        }
      }
    });
  });
}
