import type { DesktopUpdate } from "../src/lib/desktop";

type UpdateInfo = {
  version: string;
  releaseName?: string | null;
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null;
  release_type?: unknown;
};

export type UpdaterPort = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<{
    isUpdateAvailable: boolean;
    updateInfo: UpdateInfo;
  } | null>;
  downloadUpdate: () => Promise<string[]>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export class UpdaterServiceError extends Error {
  readonly kind: "NOT_AVAILABLE" | "UPDATE_FAILED";

  constructor(kind: "NOT_AVAILABLE" | "UPDATE_FAILED", message: string) {
    super(message);
    this.name = "UpdaterServiceError";
    this.kind = kind;
  }
}

export class UpdaterService {
  readonly #updater: UpdaterPort;
  readonly #currentVersion: string;
  readonly #packaged: boolean;
  #available: DesktopUpdate | null = null;
  #downloadedId: string | null = null;
  #operation: Promise<unknown> | null = null;

  constructor(updater: UpdaterPort, currentVersion: string, packaged: boolean) {
    this.#updater = updater;
    this.#currentVersion = currentVersion;
    this.#packaged = packaged;
    // A user action owns download and restart. Installing implicitly on an
    // unrelated quit would violate the renderer's explicit update lifecycle.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
  }

  async check(): Promise<DesktopUpdate | null> {
    if (!this.#packaged) return null;
    return this.#exclusive(async () => {
      const result = await this.#updater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        this.#available = null;
        this.#downloadedId = null;
        return null;
      }
      const update = projectUpdate(result.updateInfo, this.#currentVersion);
      this.#available = update;
      this.#downloadedId = null;
      return update;
    });
  }

  async download(id: string): Promise<void> {
    const available = this.#available;
    if (!available || available.id !== id) {
      throw new UpdaterServiceError("NOT_AVAILABLE", "No update is ready to install.");
    }
    await this.#exclusive(async () => {
      await this.#updater.downloadUpdate();
      this.#downloadedId = id;
    });
  }

  installOrRelaunch(fallback: () => void): void {
    if (this.#downloadedId && this.#downloadedId === this.#available?.id) {
      this.#updater.quitAndInstall(false, true);
      return;
    }
    fallback();
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#operation) {
      throw new UpdaterServiceError("UPDATE_FAILED", "Another update operation is already running.");
    }
    const running = operation();
    this.#operation = running;
    try {
      return await running;
    } catch (error) {
      if (error instanceof UpdaterServiceError) throw error;
      throw new UpdaterServiceError(
        "UPDATE_FAILED",
        error instanceof Error ? error.message : "The update operation failed.",
      );
    } finally {
      this.#operation = null;
    }
  }
}

function projectUpdate(info: UpdateInfo, currentVersion: string): DesktopUpdate {
  const notes =
    typeof info.releaseNotes === "string"
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes
            .map((entry) => [entry.version, entry.note].filter(Boolean).join("\n"))
            .join("\n\n")
        : undefined;
  return {
    id: info.version,
    currentVersion,
    version: info.version,
    ...(notes ? { body: notes } : {}),
    ...(typeof info.release_type === "string"
      ? { rawJson: { release_type: info.release_type } }
      : {}),
  };
}
