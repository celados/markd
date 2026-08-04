import { describe, expect, test, vi } from "vitest";
import {
  UpdaterService,
  UpdaterServiceError,
  type UpdaterPort,
} from "../electron/updater-service";

function fakeUpdater(): UpdaterPort {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: {
        version: "2.0.0",
        releaseNotes: "Native updater",
        release_type: "feature",
      },
    })),
    downloadUpdate: vi.fn(async () => ["/tmp/Riffle.zip"]),
    quitAndInstall: vi.fn(),
  };
}

describe("UpdaterService", () => {
  test("disables implicit updates and projects packaged metadata", async () => {
    const updater = fakeUpdater();
    const service = new UpdaterService(updater, "1.0.0", true);

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await expect(service.check()).resolves.toEqual({
      id: "2.0.0",
      currentVersion: "1.0.0",
      version: "2.0.0",
      body: "Native updater",
      rawJson: { release_type: "feature" },
    });
  });

  test("downloads only the checked version and installs on explicit relaunch", async () => {
    const updater = fakeUpdater();
    const fallback = vi.fn();
    const service = new UpdaterService(updater, "1.0.0", true);

    await service.check();
    await expect(service.download("wrong")).rejects.toMatchObject<Partial<UpdaterServiceError>>({
      kind: "NOT_AVAILABLE",
    });
    await service.download("2.0.0");
    service.installOrRelaunch(fallback);

    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(fallback).not.toHaveBeenCalled();
  });

  test("does not contact the provider from an unpackaged development app", async () => {
    const updater = fakeUpdater();
    const fallback = vi.fn();
    const service = new UpdaterService(updater, "1.0.0", false);

    await expect(service.check()).resolves.toBeNull();
    service.installOrRelaunch(fallback);

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  test("a no-update result clears a previously downloaded update", async () => {
    const updater = fakeUpdater();
    const fallback = vi.fn();
    vi.mocked(updater.checkForUpdates)
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "2.0.0" },
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: false,
        updateInfo: { version: "1.0.0" },
      });
    const service = new UpdaterService(updater, "1.0.0", true);

    await service.check();
    await service.download("2.0.0");
    await expect(service.check()).resolves.toBeNull();
    service.installOrRelaunch(fallback);

    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  test("provider and download failures release the exclusive operation for retry", async () => {
    const updater = fakeUpdater();
    vi.mocked(updater.checkForUpdates)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: "2.0.0" },
      });
    vi.mocked(updater.downloadUpdate)
      .mockRejectedValueOnce(new Error("download unavailable"))
      .mockResolvedValueOnce(["/tmp/Riffle.zip"]);
    const service = new UpdaterService(updater, "1.0.0", true);

    await expect(service.check()).rejects.toMatchObject<Partial<UpdaterServiceError>>({
      kind: "UPDATE_FAILED",
    });
    await expect(service.check()).resolves.toMatchObject({ version: "2.0.0" });
    await expect(service.download("2.0.0")).rejects.toMatchObject<Partial<UpdaterServiceError>>({
      kind: "UPDATE_FAILED",
    });
    await expect(service.download("2.0.0")).resolves.toBeUndefined();
  });
});
