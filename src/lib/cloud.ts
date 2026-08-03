import { cloudDesktop } from "@/lib/desktop-services";

export async function openTrustedCloudUrl(url: string): Promise<void> {
  await cloudDesktop.openExternal(url);
}

export async function openCloudPlans(): Promise<void> {
  await openTrustedCloudUrl(await cloudDesktop.plansUrl());
}

export async function openCloudBillingPortal(): Promise<void> {
  await openTrustedCloudUrl(await cloudDesktop.billingPortalUrl());
}
