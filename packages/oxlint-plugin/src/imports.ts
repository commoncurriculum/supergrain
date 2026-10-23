import type { ESTree, Options } from "@oxlint/plugins";

import { optionsObject, stringArray } from "./options.js";

/**
 * Every rule here has to answer the same question first: does this call site
 * actually come from supergrain? A bare `batch(...)` or `tracked(...)` proves
 * nothing on its own — plenty of codebases have their own. So each rule tracks
 * the file's import bindings and only fires on locals it can trace back to a
 * supergrain module — by default any `@supergrain/*` specifier, widened with
 * the `importSources` option for a project barrel that re-exports supergrain.
 *
 * This also keeps aliased imports working: `import { batch as b }` binds `b`,
 * and the rules look up by local name.
 */

/** Module specifiers whose exports these rules understand, unless configured. */
export const DEFAULT_IMPORT_SOURCES: ReadonlyArray<string> = ["@supergrain/"];

/** The `importSources` option of a rule, falling back to the default. */
export function readImportSources(options: Readonly<Options>): Array<string> {
  return stringArray(optionsObject(options).importSources, [...DEFAULT_IMPORT_SOURCES]);
}

/**
 * Whether `source` is one of `importSources`. An entry ending in `/` is a
 * prefix (`@supergrain/`); any other entry is a module, matched exactly or
 * through a subpath, so `@/lib/state` also covers `@/lib/state/react` but not
 * `@/lib/statement`.
 */
function matchesSource(source: string, importSources: ReadonlyArray<string>): boolean {
  return importSources.some((entry) =>
    entry.endsWith("/")
      ? source.startsWith(entry)
      : source === entry || source.startsWith(`${entry}/`),
  );
}

/**
 * Maps a local binding name to the name it was exported under.
 *
 * `import { batch as b } from "@supergrain/kernel"` produces `b -> batch`.
 */
export type ImportBindings = Map<string, string>;

/** Collects supergrain import bindings as `ImportDeclaration`s are visited. */
export function createImportTracker(
  importSources: ReadonlyArray<string> = DEFAULT_IMPORT_SOURCES,
): {
  visitImport: (node: ESTree.ImportDeclaration) => void;
  /** True if `name` is a local binding for the given supergrain export. */
  isImported: (name: string, exportedName: string) => boolean;
  /** The supergrain export `name` is bound to, if it is an imported local. */
  exportedNameOf: (name: string) => string | undefined;
} {
  const bindings: ImportBindings = new Map();

  return {
    visitImport(node) {
      /**
       * Only named imports identify an export by name. A default or namespace
       * import (`import * as sg`) would need member-expression resolution,
       * which these rules deliberately don't attempt — see README.
       */
      const named = node.specifiers.filter((specifier) => specifier.type === "ImportSpecifier"),
        source = node.source.value;
      if (typeof source !== "string" || !matchesSource(source, importSources)) return;

      for (const specifier of named) {
        const { imported } = specifier,
          exportedName = imported.type === "Identifier" ? imported.name : String(imported.value);
        bindings.set(specifier.local.name, exportedName);
      }
    },

    isImported(name, exportedName) {
      return bindings.get(name) === exportedName;
    },

    exportedNameOf(name) {
      return bindings.get(name);
    },
  };
}

/** The callee's identifier name, for plain `foo()` calls. Member calls return undefined. */
export function calleeName(node: ESTree.CallExpression): string | undefined {
  return node.callee.type === "Identifier" ? node.callee.name : undefined;
}
