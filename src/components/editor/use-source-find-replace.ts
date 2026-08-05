import { toast } from "@octanejs/sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "octane";
import { matchesShortcut } from "@/lib/shortcuts";
import { useShortcuts } from "@/stores/shortcuts";
import { useUi } from "@/stores/ui";
import {
  findPlainTextMatches,
  type FindMatch,
  replaceMatches,
  replaceTextRange,
  wrapIndex,
} from "./source-find";

type SourceFindReplaceOptions = {
  active: boolean;
  rawText: string;
  rel: string;
  applyRawTextChange: (text: string) => void;
};

export function useSourceFindReplace(options: SourceFindReplaceOptions) {
  const { active, rawText, rel, applyRawTextChange } = options;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const replaceOpenRef = useRef(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<{
    from: number;
    to: number;
    nonce: number;
  } | null>(null);
  const sourceSelectionNonce = useRef(0);
  replaceOpenRef.current = replaceOpen;

  const changeReplaceOpen = useCallback((nextOpen: boolean) => {
    replaceOpenRef.current = nextOpen;
    setReplaceOpen(nextOpen);
  }, []);

  const matches = useMemo(
    () => (query ? findPlainTextMatches(rawText, query) : []),
    [query, rawText, rel],
  );
  const selectedIndex =
    matches.length === 0 ? 0 : Math.min(activeMatch, matches.length - 1);

  const selectSourceMatch = useCallback((match: FindMatch) => {
    sourceSelectionNonce.current += 1;
    setSourceSelection({ ...match, nonce: sourceSelectionNonce.current });
  }, []);

  const selectMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const nextIndex = wrapIndex(index, matches.length);
      setActiveMatch(nextIndex);
      selectSourceMatch(matches[nextIndex]);
    },
    [matches, selectSourceMatch],
  );

  const replaceCurrent = useCallback(() => {
    if (!query || matches.length === 0) return;
    const match = matches[selectedIndex];
    applyRawTextChange(replaceTextRange(rawText, match, replaceText));
    selectSourceMatch({ from: match.from, to: match.from + replaceText.length });
  }, [
    applyRawTextChange,
    matches,
    query,
    rawText,
    replaceText,
    selectSourceMatch,
    selectedIndex,
  ]);

  const replaceAll = useCallback(() => {
    if (!query || matches.length === 0) return;
    const total = matches.length;
    applyRawTextChange(replaceMatches(rawText, matches, replaceText));
    setActiveMatch(0);
    toast(`Replaced ${total} ${total === 1 ? "match" : "matches"}`);
  }, [applyRawTextChange, matches, query, rawText, replaceText]);

  useEffect(() => {
    setActiveMatch(0);
  }, [query, rel]);

  useEffect(() => {
    if (activeMatch < matches.length) return;
    setActiveMatch(Math.max(0, matches.length - 1));
  }, [activeMatch, matches.length]);

  useEffect(() => {
    if (!open || !query || matches.length === 0) return;
    selectSourceMatch(matches[selectedIndex]);
  }, [matches, open, query, selectSourceMatch, selectedIndex]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const shortcuts = useShortcuts.getState().bindings;
      const replaceShortcut = matchesShortcut(event, shortcuts.replaceInNote);
      const findShortcut = matchesShortcut(event, shortcuts.findInNote);
      if (!replaceShortcut && !findShortcut) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.settingsOpen) return;
      event.preventDefault();
      setOpen(true);
      if (replaceShortcut) changeReplaceOpen(!replaceOpenRef.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, changeReplaceOpen]);

  const openFind = useCallback(() => setOpen(true), []);
  const closeFind = useCallback(() => {
    setOpen(false);
    changeReplaceOpen(false);
  }, [changeReplaceOpen]);
  const previous = useCallback(
    () => selectMatch(selectedIndex - 1),
    [selectMatch, selectedIndex],
  );
  const next = useCallback(
    () => selectMatch(selectedIndex + 1),
    [selectMatch, selectedIndex],
  );

  return {
    open,
    openFind,
    closeFind,
    query,
    setQuery,
    replaceText,
    setReplaceText,
    replaceOpen,
    setReplaceOpen: changeReplaceOpen,
    current: query && matches.length > 0 ? selectedIndex + 1 : 0,
    total: query ? matches.length : 0,
    previous,
    next,
    replaceCurrent,
    replaceAll,
    sourceSelection,
  };
}
