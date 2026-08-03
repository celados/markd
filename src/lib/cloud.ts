import { ipc } from "@/lib/ipc";
import { unwrapDesktopResult } from "@/lib/desktop";

export async function openTrustedCloudUrl(url: string): Promise<void> {
  const cloud = window.markd?.cloud;
  if (cloud) {
    await unwrapDesktopResult(cloud.openExternal(url));
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
