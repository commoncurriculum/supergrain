import type { ESTree } from "@oxlint/plugins";

/**
 * Every rule here has to answer the same question first: does this call site
 * actually come from supergrain? A bare `batch(...)` or `tracked(...)` proves
 * nothing on its own — plenty of codebases have their own. So each rule tracks
 * the file's import bindings and only fires on locals it can trace back to a
 * `@supergrain/*` specifier.
 *
 * This also keeps aliased imports working: `import { batch as b }` binds `b`,
 * and the rules look up by local name.
 */

/** Package specifiers whose exports these rules understand. */
const SUPERGRAIN_PREFIX = "@supergrain/";

/**
 * Maps a local binding name to the name it was exported under.
 *
 * `import { batch as b } from "@supergrain/kernel"` produces `b -> batch`.
 */
export type ImportBindings = Map<string, string>;

/** Collects supergrain import bindings as `ImportDeclaration`s are visited. */
export function createImportTracker(): {
  visitImport: (node: ESTree.ImportDeclaration) => void;
  /** True if `name` is a local binding for the given supergrain export. */
  isImported: (name: string, exportedName: string) => boolean;
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
      if (typeof source !== "string" || !source.startsWith(SUPERGRAIN_PREFIX)) return;

      for (const specifier of named) {
        const { imported } = specifier,
          exportedName = imported.type === "Identifier" ? imported.name : String(imported.value);
        bindings.set(specifier.local.name, exportedName);
      }
    },

    isImported(name, exportedName) {
      return bindings.get(name) === exportedName;
    },
  };
}

/** The callee's identifier name, for plain `foo()` calls. Member calls return undefined. */
export function calleeName(node: ESTree.CallExpression): string | undefined {
  return node.callee.type === "Identifier" ? node.callee.name : undefined;
}
