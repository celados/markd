import { toast } from "@octanejs/sonner";
import { create } from "@octanejs/zustand";
import {
  unwrapDesktopResult,
  type DesktopUpdate,
} from "@/lib/desktop";
import { shouldShowReleaseNotes } from "@/lib/updateRelease";

type Status = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

type PendingUpdate = DesktopUpdate & {
  downloadAndInstall: () => Promise<void>;
};

interface UpdaterState {
  status: Status;
  version: string | null;
  update: PendingUpdate | null;
  releaseNotesOpen: boolean;
  /** Look for an update. `silent` swallows "up to date"/failure noise. */
  check: (opts?: { silent?: boolean }) => Promise<void>;
  /** Show feature notes first, or immediately install a fix-only release. */
  requestInstall: () => Promise<void>;
  /** Download + install the pending update, then relaunch. */
  install: () => Promise<void>;
  dismissReleaseNotes: () => void;
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  update: null,
  releaseNotesOpen: false,

  check: async ({ silent = true } = {}) => {
    if (get().status === "checking" || get().status === "downloading") return;
    set({
      status: "checking",
      releaseNotesOpen: false,
    });
    try {
      const update = await checkForUpdate();
      if (update) {
        set({
          status: "available",
          version: update.version,
          update,
          releaseNotesOpen: false,
        });
      } else {
        set({
          status: "idle",
          version: null,
          update: null,
          releaseNotesOpen: false,
        });
        if (!silent) toast("You're on the latest version.");
      }
    } catch (err) {
      // Dev builds, offline checks, and missing signatures all land here.
      set({
        status: "error",
        version: null,
        update: null,
        releaseNotesOpen: false,
      });
      if (!silent) {
        toast.error(err instanceof Error ? err.message : "Update check failed.");
      }
    }
  },

  requestInstall: async () => {
    const update = get().update;
    if (!update || get().status !== "available") return;
    if (shouldShowReleaseNotes(update)) {
      set({ releaseNotesOpen: true });
      return;
    }
    await get().install();
  },

  install: async () => {
    const update = get().update;
    if (!update) return;
    set({ status: "downloading" });
    try {
      await update.downloadAndInstall();
      set({ status: "ready" });
      await relaunchApp();
    } catch (err) {
      set({ status: "available" });
      toast.error(err instanceof Error ? err.message : "Update failed to install.");
    }
  },

  dismissReleaseNotes: () => {
    if (get().status === "available") {
      set({ releaseNotesOpen: false });
    }
  },
}));

async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (window.markd) {
    const update = await unwrapDesktopResult(window.markd.updates.check());
    if (!update) return null;
    return {
      ...update,
      downloadAndInstall: async () => {
        await unwrapDesktopResult(window.markd!.updates.install(update.id));
      },
    };
  }

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    id: update.version,
    currentVersion: update.currentVersion,
    version: update.version,
    body: update.body,
    rawJson: update.rawJson,
    downloadAndInstall: () => update.downloadAndInstall(),
  };
}

async function relaunchApp(): Promise<void> {
  if (window.markd) {
    await unwrapDesktopResult(window.markd.updates.relaunch());
    return;
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
