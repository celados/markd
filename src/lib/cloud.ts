import { ipc } from "@/lib/ipc";
import { unwrapDesktopResult } from "@/lib/desktop";

export async function openTrustedCloudUrl(url: string): Promise<void> {
  if (window.markd) {
    await unwrapDesktopResult(window.markd.cloud.openExternal(url));
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function openCloudPlans(): Promise<void> {
  await openTrustedCloudUrl(await ipc.cloudPlansUrl());
}

export async function openCloudBillingPortal(): Promise<void> {
  await openTrustedCloudUrl(await ipc.cloudBillingPortalUrl());
}
