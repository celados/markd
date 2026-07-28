import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  command,
  ["exec", "tsrx-tsc", "--noEmit", "--pretty", "false"],
  { encoding: "utf8" },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.error) {
  throw result.error;
}

if (result.status === 0) {
  process.stdout.write(output);
  process.exit(0);
}

const knownPackages = [
  "@octanejs/cmdk",
  "@octanejs/sonner",
  "@octanejs/tiptap",
];
const diagnostics = output
  .split("\n")
  .filter((line) => line.includes("error TS") || line.startsWith("[tsrx-tsc]"));
const unexpected = diagnostics.filter(
  (line) =>
    !knownPackages.some((packageName) =>
      line.includes(`/node_modules/${packageName}/`),
    ),
);

if (diagnostics.length === 0 || unexpected.length > 0) {
  process.stderr.write(output);
  process.exit(result.status ?? 1);
}

// These source-package diagnostics are tracked upstream. Keeping the allowlist
// path-scoped makes any local regression or new dependency failure fatal.
process.stderr.write(
  `Typecheck passed with ${diagnostics.length} known upstream source-package diagnostics; see https://github.com/octanejs/octane/issues/332\n`,
);
