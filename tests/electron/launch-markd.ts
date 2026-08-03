import { _electron as electron } from "@playwright/test";

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
