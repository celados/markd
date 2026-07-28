import {
  LuFolderOpen as FolderOpen,
  LuGlobe2 as Globe2,
  LuMonitor as Monitor,
  LuMoon as Moon,
  LuRefreshCw as RefreshCw,
  LuRotateCcw as RotateCcw,
  LuSun as Sun,
} from "@/icons/icons.tsrx";
import { type OctaneNode, useEffect, useState } from "octane";
import { toast } from "@octanejs/sonner";
import type { CloudAccount, Theme } from "@/lib/types";
import {
  findShortcutConflict,
  formatShortcutParts,
  sameShortcut,
  shortcutFromEvent,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
  type ShortcutBinding,
} from "@/lib/shortcuts";
import { cx, isMac } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { CloudAccountCard } from "@/components/settings/CloudAccountCard.tsrx";
import { openCloudBillingPortal, openCloudPlans } from "@/lib/cloud";
import { useShortcuts } from "@/stores/shortcuts";
import { useUi } from "@/stores/ui";
import { useUpdater } from "@/stores/updater";
import { useVault } from "@/stores/vault";

const THEMES: Array<{
  value: Theme;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "system",
    label: "System",
    description: "Match your system",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "Bright canvas",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Low light",
    icon: Moon,
  },
];

export function GeneralSettings() @{
  const root = useVault((state) => state.root);
  const chooseVault = useVault((state) => state.chooseVault);
  const updateStatus = useUpdater((state) => state.status);
  const updateVersion = useUpdater((state) => state.version);
  const checkUpdate = useUpdater((state) => state.check);
  const requestInstall = useUpdater((state) => state.requestInstall);
  const setSettingsOpen = useUi((state) => state.setSettingsOpen);

  const updateCopy =
    updateStatus === "available"
      ? `Version ${updateVersion} is available`
      : updateStatus === "downloading" || updateStatus === "ready"
        ? "Installing…"
        : updateStatus === "checking"
          ? "Checking for updates…"
          : "You're on the latest version";

  <div className="space-y-6">
      <SettingsGroup
        title="Vault"
        description="The folder Markd uses for notes and local app data."
      >
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <p
            title={root}
            className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted"
          >
            {root}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={chooseVault}
            className="shrink-0 bg-bg"
          >
            <FolderOpen size={13.5} strokeWidth={1.75} />
            Change
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Software updates"
        description="Keep Markd current with the latest fixes and improvements."
      >
        <div className="flex items-center justify-between gap-4 rounded-xl bg-panel p-3">
            <p aria-live="polite" className="min-w-0 text-[12.5px] text-muted">
              {updateCopy}
            </p>
            @if (updateStatus === "available") {
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSettingsOpen(false);
                  void requestInstall();
                }}
                className="shrink-0 bg-bg"
              >
                Install & restart
              </Button>
            } @else {
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkUpdate({ silent: false })}
                disabled={
                  updateStatus === "checking" || updateStatus === "downloading"
                }
                className="shrink-0 bg-bg"
              >
                @if (updateStatus === "checking") {
                  <Spinner size={14} />
                } @else {
                  <RefreshCw size={13} strokeWidth={1.75} />
                }
                Check
              </Button>
            }
        </div>
      </SettingsGroup>
  </div>
}

export function CloudSettings() @{
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [billingBusy, setBillingBusy] = useState<"plans" | "portal" | null>(null);

  const openBilling = (kind: "plans" | "portal", action: () => Promise<void>) => {
    setBillingBusy(kind);
    void action()
      .catch((cause) => {
        toast.error(cause instanceof Error ? cause.message : "Billing could not be opened.");
      })
      .finally(() => setBillingBusy(null));
  };

  <div className="space-y-6">
      <SettingsGroup
        title="Account"
        description="Sign in once to manage public pages and future synced devices."
      >
        <CloudAccountCard onAccountChange={setAccount} />
      </SettingsGroup>

      <SettingsGroup
        title="Subscription"
        description="Your Markd Cloud access for publishing and future sync."
      >
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg text-muted">
            <Globe2 size={15.5} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[12.5px] font-semibold text-ink">Markd Cloud</p>
              @if (account?.plan === "cloud") {
                <StatusBadge tone="success">Active</StatusBadge>
              }
            </div>
            <p className="mt-0.5 text-[10.5px] text-faint">
              {account?.plan === "cloud"
                ? "Publishing is active for this account."
                : "Publish connected notes and hosted images on the web."}
            </p>
          </div>
          @if (account?.plan === "cloud") {
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 bg-bg"
              loading={billingBusy === "portal"}
              disabled={Boolean(billingBusy)}
              onClick={() => openBilling("portal", openCloudBillingPortal)}
            >
              {billingBusy === "portal" ? "Opening…" : "Manage billing"}
            </Button>
          } @else if (account) {
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 bg-bg"
              loading={billingBusy === "plans"}
              disabled={Boolean(billingBusy)}
              onClick={() => openBilling("plans", openCloudPlans)}
            >
              {billingBusy === "plans" ? "Opening…" : "View plans"}
            </Button>
          }
        </div>
        <p className="mt-2.5 text-[10.5px] text-faint">
          Billing and subscription changes are managed on the web.
        </p>
      </SettingsGroup>
  </div>
}

type ThemeOptionProps = {
  option: (typeof THEMES)[number];
  active: boolean;
  onSelect: () => void;
};

function ThemeOption(props: ThemeOptionProps) @{
  const { option, active, onSelect } = props;
  const Icon = option.icon;

  <button
    type="button"
    aria-pressed={active}
    onClick={onSelect}
    className={cx(
      "flex min-h-24 flex-col items-start rounded-xl p-3 text-left transition-colors duration-100",
      active
        ? "bg-invert text-invert-ink"
        : "bg-panel text-muted hover:bg-hover hover:text-ink",
    )}
  >
    <Icon size={17} strokeWidth={1.7} />
    <span className="mt-auto text-[12.5px] font-semibold">{option.label}</span>
    <span
      className={cx(
        "mt-0.5 text-[10.5px]",
        active ? "text-invert-ink/65" : "text-faint",
      )}
    >
      {option.description}
    </span>
  </button>
}

export function AppearanceSettings() @{
  const theme = useVault((state) => state.theme);
  const setTheme = useVault((state) => state.setTheme);
  const mac = isMac();
  const cycleTheme = useShortcuts((state) => state.bindings.cycleTheme);

  <SettingsGroup
      title="Theme"
      description="Choose how Markd looks across the editor and navigation."
      aside={
        <span className="flex items-center text-[10.5px] text-faint">
          <ShortcutKeys shortcut={cycleTheme} mac={mac} />
          <span className="ml-1.5">to cycle</span>
        </span>
      }
    >
      <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-2">
        @for (const option of THEMES; key option.value) {
          <ThemeOption
            option={option}
            active={theme === option.value}
            onSelect={() => setTheme(option.value)}
          />
        }
      </div>
  </SettingsGroup>
}

export function ShortcutSettings() @{
  const mac = isMac();
  const bindings = useShortcuts((state) => state.bindings);
  const setBinding = useShortcuts((state) => state.setBinding);
  const resetBinding = useShortcuts((state) => state.resetBinding);
  const resetAll = useShortcuts((state) => state.resetAll);
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The compiler's positional @for lowering is tracked in octane#333, so the
  // stable shortcut id remains the key while position is ordinary data.
  const shortcutEntries = SHORTCUT_DEFINITIONS.map((shortcut, index) => ({
    shortcut,
    index,
  }));

  const onCapture = (action: ShortcutAction, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      setEditing(null);
      setError(null);
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) {
      setError("Use Command, Control, or Option with a key.");
      return;
    }
    const fixedConflict = fixedShortcutConflict(shortcut, mac);
    if (fixedConflict) {
      setError(`Already used by ${fixedConflict}.`);
      return;
    }
    const conflict = findShortcutConflict(bindings, shortcut, action);
    if (conflict) {
      setError(`Already used by ${conflict.label}.`);
      return;
    }
    setBinding(action, shortcut);
    setEditing(null);
    setError(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => onCapture(editing, event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, editing, mac]);

  <SettingsGroup
      title="Keyboard shortcuts"
      description="Click a shortcut, then press the new key combination."
      aside={
        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw size={13} strokeWidth={1.8} />
          Reset all
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl bg-panel">
        @for (const entry of shortcutEntries; key entry.shortcut.id) {
          <div
            className={cx(
              "flex min-h-10 items-center justify-between gap-4 px-3.5 py-2 text-[12.5px] text-muted",
              entry.index > 0 && "border-t border-line-soft",
            )}
          >
            <span>{entry.shortcut.label}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <ShortcutCapture
                label={entry.shortcut.label}
                shortcut={bindings[entry.shortcut.id]}
                mac={mac}
                editing={editing === entry.shortcut.id}
                onStart={() => {
                  setEditing(entry.shortcut.id);
                  setError(null);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Reset ${entry.shortcut.label}`}
                onClick={() => resetBinding(entry.shortcut.id)}
              >
                <RotateCcw size={12.5} strokeWidth={1.8} />
              </Button>
            </div>
          </div>
        }
        <ReadonlyShortcutRow
          label="Quick capture"
          keys={mac ? ["⌃", "⇧", "Space"] : ["Ctrl", "Shift", "Space"]}
        />
        <ReadonlyShortcutRow
          label="Open note tab"
          keys={mac ? ["⌘", "1-9"] : ["Ctrl", "1-9"]}
        />
      </div>
      @if (error) {
        <p aria-live="polite" className="mt-2 text-[11.5px] text-danger">
          {error}
        </p>
      }
  </SettingsGroup>
}

function fixedShortcutConflict(shortcut: ShortcutBinding, mac: boolean) {
  const mod = mac ? { meta: true } : { ctrl: true };
  if (
    !shortcut.alt &&
    !shortcut.shift &&
    sameShortcut(shortcut, { ...mod, key: shortcut.key }) &&
    /^[1-9]$/.test(shortcut.key)
  ) {
    return "Open note tab";
  }
  if (
    sameShortcut(shortcut, {
      ctrl: true,
      shift: true,
      key: "Space",
    })
  ) {
    return "Quick capture";
  }
  return null;
}

type SettingsGroupProps = {
  title: string;
  description: string;
  aside?: OctaneNode;
  children: OctaneNode;
};

function SettingsGroup(props: SettingsGroupProps) @{
  const { title, description, aside, children } = props;

  <section>
      <div className="flex min-h-10 items-start justify-between gap-4">
        <div>
          <h4 className="text-[12.5px] font-semibold text-ink">{title}</h4>
          <p className="mt-1 text-[11.5px] leading-4 text-faint">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
  </section>
}

type KbdProps = {
  children: OctaneNode;
};

function Kbd(props: KbdProps) @{
  const { children } = props;

  <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-line bg-bg px-1 font-mono text-[10.5px] text-muted">
      {children}
  </kbd>
}

type ShortcutKeysProps = {
  shortcut: ShortcutBinding;
  mac: boolean;
};

function ShortcutKeys(props: ShortcutKeysProps) @{
  const { shortcut, mac } = props;
  const parts = formatShortcutParts(shortcut, mac).map((key, index) => ({
    key,
    index,
  }));

  <>
    @for (const part of parts; key `${part.key}-${part.index}`) {
      <Kbd>{part.key}</Kbd>
    }
  </>
}

type ShortcutCaptureProps = {
  label: string;
  shortcut: ShortcutBinding;
  mac: boolean;
  editing: boolean;
  onStart: () => void;
};

function ShortcutCapture(props: ShortcutCaptureProps) @{
  const { label, shortcut, mac, editing, onStart } = props;

  <button
      type="button"
      aria-label={`Change ${label} shortcut`}
      onClick={onStart}
      className={cx(
        "inline-flex h-7 min-w-[104px] items-center justify-center gap-1 rounded-md border px-2 font-mono text-[10.5px] transition-colors duration-100",
        editing
          ? "border-ink bg-bg text-ink"
          : "border-line bg-bg text-muted hover:border-line hover:bg-hover hover:text-ink",
      )}
    >
    @if (editing) {
      <>Press keys</>
    } @else {
      <ShortcutKeys shortcut={shortcut} mac={mac} />
    }
  </button>
}

type ReadonlyShortcutRowProps = {
  label: string;
  keys: string[];
};

function ReadonlyShortcutRow(props: ReadonlyShortcutRowProps) @{
  const { label, keys } = props;
  const keyEntries = keys.map((key, index) => ({ key, index }));

  <div className="flex min-h-10 items-center justify-between gap-4 border-t border-line-soft px-3.5 py-2 text-[12.5px] text-muted">
      <span>{label}</span>
      <span className="flex shrink-0 items-center gap-1 opacity-70">
      @for (const entry of keyEntries; key `${label}-${entry.key}-${entry.index}`) {
        <Kbd>{entry.key}</Kbd>
      }
      </span>
  </div>
}
