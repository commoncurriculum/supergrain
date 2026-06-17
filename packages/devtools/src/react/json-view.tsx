// A small collapsible explorer for a serialized {@link JsonNode}. Pure: it
// renders an already-plain tree (no proxies, no cycles — see ../serialize), so
// it can't loop and never touches the live store. Each composite node keeps its
// own open/closed state, like the TanStack devtools data explorer. The
// expand/collapse control is a react-aria `Button` (focusable, Enter/Space,
// exposes `aria-expanded`).

import type { JsonNode } from "../serialize";

import { useState } from "react";
import { Button } from "react-aria-components";

export function JsonView({ node, label }: { node: JsonNode; label?: string }) {
  return (
    <div className="sgdt-json">
      <JsonNodeView node={node} label={label} depth={0} />
    </div>
  );
}

const AUTO_OPEN_DEPTH = 1;

function JsonNodeView({ node, label, depth }: { node: JsonNode; label?: string; depth: number }) {
  const composite = describeComposite(node);
  const [open, setOpen] = useState(depth < AUTO_OPEN_DEPTH);

  const keyLabel = label === undefined ? null : <span className="sgdt-json-key">{label}: </span>;

  if (composite === null) {
    return (
      <span className="sgdt-json-row">
        {keyLabel}
        <Leaf node={node} />
      </span>
    );
  }

  return (
    <div className="sgdt-json-row">
      <Button className="sgdt-json-toggle" aria-expanded={open} onPress={() => setOpen((v) => !v)}>
        <span className="sgdt-json-meta">{open ? "▾ " : "▸ "}</span>
        {keyLabel}
        <span className="sgdt-json-meta">{composite.summary}</span>
      </Button>
      {open && composite.children.length > 0 && (
        <div className="sgdt-indent">
          {composite.children.map((child) => (
            <JsonNodeView key={child.key} node={child.node} label={child.label} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function Leaf({ node }: { node: JsonNode }) {
  switch (node.t) {
    case "null": {
      return <span className="sgdt-json-null">null</span>;
    }
    case "undefined": {
      return <span className="sgdt-json-null">undefined</span>;
    }
    case "boolean": {
      return <span className="sgdt-json-boolean">{String(node.value)}</span>;
    }
    case "number": {
      return <span className="sgdt-json-number">{node.text}</span>;
    }
    case "string": {
      return <span className="sgdt-json-string">{JSON.stringify(node.value)}</span>;
    }
    case "bigint": {
      return <span className="sgdt-json-number">{node.text}</span>;
    }
    case "date": {
      return <span className="sgdt-json-string">{node.text}</span>;
    }
    case "symbol": {
      return <span className="sgdt-json-meta">{node.text}</span>;
    }
    case "function": {
      return <span className="sgdt-json-meta">ƒ {node.name}()</span>;
    }
    case "circular": {
      return <span className="sgdt-json-meta">[Circular]</span>;
    }
    case "max-depth": {
      return <span className="sgdt-json-meta">…</span>;
    }
    /* c8 ignore next 3 -- exhaustive over leaf kinds; composite kinds never reach Leaf */
    default: {
      return null;
    }
  }
}

interface Child {
  /** React key — stable across reorders for keyed collections (object/map/error). */
  key: string;
  label: string;
  node: JsonNode;
}

/** A node's expandable rendering, or `null` for a leaf. */
interface Composite {
  summary: string;
  children: Array<Child>;
}

const plus = (truncated: number): string => (truncated ? ` +${truncated}` : "");

// Single dispatch over composite node kinds: returns the summary line plus the
// children, or `null` for a leaf. One switch to keep in sync (vs. three parallel
// ones), and the leaf path falls through to `null` rather than an unreachable
// default. Child keys use the field/index name so collapse state anchors to
// content (stable across reorders for object/error; map adds the index to break
// label ties; arrays/sets have no item identity, so index is the key).
function describeComposite(node: JsonNode): Composite | null {
  switch (node.t) {
    case "array": {
      return {
        summary: `Array(${node.items.length})${plus(node.truncated)}`,
        children: node.items.map((n, i) => ({ key: String(i), label: String(i), node: n })),
      };
    }
    case "object": {
      const n = node.entries.length;
      return {
        summary: `{${n} ${n === 1 ? "key" : "keys"}}${plus(node.truncated)}`,
        children: node.entries.map(([k, child]) => ({ key: k, label: k, node: child })),
      };
    }
    case "map": {
      return {
        summary: `Map(${node.size})${plus(node.truncated)}`,
        children: node.entries.map(([k, child], i) => ({
          key: `${k} ${i}`,
          label: k,
          node: child,
        })),
      };
    }
    case "set": {
      return {
        summary: `Set(${node.size})${plus(node.truncated)}`,
        children: node.items.map((n, i) => ({ key: String(i), label: String(i), node: n })),
      };
    }
    case "error": {
      return {
        summary: `${node.name}: ${node.message}`,
        children: node.entries.map(([k, child]) => ({ key: k, label: k, node: child })),
      };
    }
    default: {
      return null;
    }
  }
}
