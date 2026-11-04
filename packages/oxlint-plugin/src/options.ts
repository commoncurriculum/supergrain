import type { Options } from "@oxlint/plugins";

/**
 * Oxlint types every rule's options as `JsonValue[]`, with no way to tie them
 * to the rule's schema. The schema has already validated the shape by the time
 * `create()` runs, so these helpers only narrow — they never need to reject —
 * and they let the rules read options without an unchecked cast.
 */

type JsonValue = Options[number];
type JsonObject = Record<string, JsonValue>;

/** The rule's options object, or an empty one when none was configured. */
export function optionsObject(options: Readonly<Options>): JsonObject {
  const [first] = options;
  return typeof first === "object" && first !== null && !Array.isArray(first) ? first : {};
}

/** The string entries of an array option, or `fallback` when it is absent. */
export function stringArray(value: JsonValue | undefined, fallback: Array<string>): Array<string> {
  if (!Array.isArray(value)) return fallback;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The JSON schema for `importSources`, shared by every rule that takes it. */
export const IMPORT_SOURCES_SCHEMA = {
  type: "array" as const,
  items: { type: "string" as const },
  description:
    'Module specifiers whose exports count as supergrain\'s. An entry ending in "/" is a prefix; any other entry matches that module and its subpaths. Add your own barrel module if it re-exports supergrain.',
};
