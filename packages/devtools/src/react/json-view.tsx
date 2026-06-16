// A small collapsible explorer for a serialized {@link JsonNode}. Pure: it
// renders an already-plain tree (no proxies, no cycles — see ../serialize), so
// it can't loop and never touches the live store. Each composite node keeps its
// own open/closed state, like the TanStack devtools data explorer.

import type { JsonNode } from "../serialize";

import { useState } from "react";

export function JsonView({ node, label }: { node: JsonNode; label?: string }) {
  return (
    <div className="sgdt-json">
      <JsonNodeView node={node} label={label} depth={0} />
    </div>
  );
}

const AUTO_OPEN_DEPTH = 1;

function JsonNodeView({ node, label, depth }: { node: JsonNode; label?: string; depth: number }) {
  const composite = isComposite(node);
  const [open, setOpen] = useState(depth < AUTO_OPEN_DEPTH);

  const keyLabel = label === undefined ? null : <span className="sgdt-json-key">{label}: </span>;

  if (!composite) {
    return (
      <span className="sgdt-json-row">
        {keyLabel}
        <Leaf node={node} />
      </span>
    );
  }

  const summary = compositeSummary(node);
  const children = compositeChildren(node);

  return (
    <div className="sgdt-json-row">
      <span className="sgdt-json-toggle" onClick={() => setOpen((v) => !v)}>
        <span className="sgdt-json-meta">{open ? "▾ " : "▸ "}</span>
        {keyLabel}
        <span className="sgdt-json-meta">{summary}</span>
      </span>
      {open && children.length > 0 && (
        <div className="sgdt-indent">
          {children.map((child, i) => (
            <JsonNodeView
              key={`${child.label}-${i}`}
              node={child.node}
              label={child.label}
              depth={depth + 1}
            />
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
    default: {
      return null;
    }
  }
}

interface Child {
  label: string;
  node: JsonNode;
}

function isComposite(node: JsonNode): boolean {
  return (
    node.t === "object" ||
    node.t === "array" ||
    node.t === "map" ||
    node.t === "set" ||
    node.t === "error"
  );
}

function compositeSummary(node: JsonNode): string {
  switch (node.t) {
    case "array": {
      return `Array(${node.items.length})${node.truncated ? ` +${node.truncated}` : ""}`;
    }
    case "object": {
      const n = node.entries.length;
      return `{${n} ${n === 1 ? "key" : "keys"}}${node.truncated ? ` +${node.truncated}` : ""}`;
    }
    case "map": {
      return `Map(${node.size})`;
    }
    case "set": {
      return `Set(${node.size})`;
    }
    case "error": {
      return `${node.name}: ${node.message}`;
    }
    default: {
      return "";
    }
  }
}

function compositeChildren(node: JsonNode): Array<Child> {
  switch (node.t) {
    case "array": {
      return node.items.map((n, i) => ({ label: String(i), node: n }));
    }
    case "object": {
      return node.entries.map(([k, n]) => ({ label: k, node: n }));
    }
    case "map": {
      return node.entries.map(([k, n]) => ({ label: k, node: n }));
    }
    case "set": {
      return node.items.map((n, i) => ({ label: String(i), node: n }));
    }
    case "error": {
      return node.entries.map(([k, n]) => ({ label: k, node: n }));
    }
    default: {
      return [];
    }
  }
}
