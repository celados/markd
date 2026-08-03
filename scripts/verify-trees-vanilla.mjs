import { readFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const loaded = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    loaded.add(specifier);
    return nextResolve(specifier, context);
  },
});

const entryUrl = import.meta.resolve("@pierre/trees");
const packagePath = join(dirname(fileURLToPath(entryUrl)), "..", "package.json");
const manifest = JSON.parse(await readFile(packagePath, "utf8"));
await import("@pierre/trees");

const requireFromApp = createRequire(join(process.cwd(), "package.json"));
const loadedByVanillaImport = new Set(loaded);
const isInstalled = (name) => {
  try {
    requireFromApp.resolve(name);
    return true;
  } catch {
    return false;
  }
};
const isLoaded = (name) =>
  [...loadedByVanillaImport].some(
    (specifier) => specifier === name || specifier.startsWith(`${name}/`),
  );

process.stdout.write(`${JSON.stringify({
  package: manifest.name,
  version: manifest.version,
  reactInstalled: isInstalled("react"),
  reactDomInstalled: isInstalled("react-dom"),
  reactLoaded: isLoaded("react"),
  reactDomLoaded: isLoaded("react-dom"),
})}\n`);
