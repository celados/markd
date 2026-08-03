import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

type ElectronLaunchOptions = Parameters<typeof electron.launch>[0];

type MarkdLaunchOptions = Omit<ElectronLaunchOptions, "args" | "env"> & {
  env?: NodeJS.ProcessEnv;
  foreground?: boolean;
};

export function launchMarkd(options: MarkdLaunchOptions = {}) {
  const { env = {}, foreground = false, ...launchOptions } = options;
  return electron.launch({
    ...launchOptions,
    args: ["."],
    env: {
      ...process.env,
      ...env,
      MARKD_E2E_BACKGROUND: foreground ? "0" : "1",
    },
  });
}

export async function markdWindow(
  application: ElectronApplication,
  kind: "main" | "quick-capture",
): Promise<Page> {
  await application.firstWindow();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    for (const page of application.windows()) {
      const candidate = await page
        .evaluate(() => window.markd?.app.windowKind ?? null)
        .catch(() => null);
      if (candidate === kind) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Markd ${kind} window did not load`);
}
