// Loads a real TypeScript source module for a check script (no duplicate of the
// production logic). Relative imports are loaded the same way; anything that
// needs the browser or Supabase can be replaced through `stubs`.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);

export function loadTs(file, stubs = {}, cache = new Map()) {
  const full = resolve(file);
  if (cache.has(full)) return cache.get(full).exports;
  const js = ts.transpileModule(readFileSync(full, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  cache.set(full, mod);
  const requireFn = (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(full), specifier);
      const path = [`${base}.ts`, `${base}.tsx`, base].find((candidate) => existsSync(candidate));
      if (!path) throw new Error(`Cannot resolve ${specifier} from ${file}`);
      return loadTs(path, stubs, cache);
    }
    return nodeRequire(specifier);
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, requireFn);
  return mod.exports;
}
