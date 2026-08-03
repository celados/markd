import type { Page } from "@playwright/test";

export async function installMarkdFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const success = <T>(value: T) => ({ ok: true as const, value });
    window.markd = {
      app: {
        windowKind: "main",
        onNotesChanged: () => () => {},
        onEngineLifecycle: () => () => {},
      },
      vault: {
        startup: async () => success(null),
      },
      cloud: {
        accountStatus: async () => success({ account: null }),
        plansUrl: async () => success("https://example.test/plans"),
        billingPortalUrl: async () => success("https://example.test/billing"),
      },
      updates: {
        check: async () => success(null),
        install: async () => success(null),
        relaunch: async () => success(null),
      },
    };
  });
}
