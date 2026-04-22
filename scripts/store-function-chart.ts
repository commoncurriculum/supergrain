import ts from "typescript";

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

type FunctionKind = "function" | "const" | "method";

type FunctionInfo = {
  id: string;
  label: string;
  kind: FunctionKind;
  body?: ts.Node;
};

const targetPath = process.argv[2] ?? "packages/kernel/src/store.ts";

const program = ts.createProgram([targetPath], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,
});

const checker = program.getTypeChecker();
const source = program.getSourceFile(targetPath);

if (!source) {
  console.error(`Could not load ${targetPath}`);
  process.exit(1);
}

const functions = new Map<ts.Node, FunctionInfo>();
const symbolToFunction = new Map<ts.Symbol, FunctionInfo>();
const edges = new Set<string>();

function toId(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/g, "_");
}

function getPropertyName(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function registerFunction(
  keyNode: ts.Node,
  symbolNode: ts.Node,
  label: string,
  kind: FunctionKind,
  body?: ts.Node,
): void {
  const info: FunctionInfo = {
    id: toId(label),
    label,
    kind,
    body,
  };

  functions.set(keyNode, info);

  const symbol = checker.getSymbolAtLocation(symbolNode);
  if (symbol) {
    symbolToFunction.set(symbol, info);
  }
}

function collectFunctions(node: ts.Node, scope: string[] = []): void {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    const label = [...scope, node.name.text].join(".");
    registerFunction(node, node.name, label, "function", node.body);
    ts.forEachChild(node, (child) => collectFunctions(child, [...scope, node.name!.text]));
    return;
  }

  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    const name = node.name.text;
    const label = [...scope, name].join(".");
    registerFunction(node, node.name, label, "const", node.initializer.body);
    ts.forEachChild(node.initializer.body, (child) => collectFunctions(child, [...scope, name]));
    return;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (ts.isObjectLiteralExpression(node.initializer)) {
      const objectName = [...scope, node.name.text];
      for (const property of node.initializer.properties) {
        if (!("name" in property) || !property.name) continue;
        const propName = getPropertyName(property.name);
        if (!propName) continue;

        if (ts.isMethodDeclaration(property)) {
          const label = [...objectName, propName].join(".");
          registerFunction(property, property.name, label, "method", property.body);
          if (property.body) {
            ts.forEachChild(property.body, (child) =>
              collectFunctions(child, [...objectName, propName]),
            );
          }
          continue;
        }

        if (
          ts.isPropertyAssignment(property) &&
          (ts.isArrowFunction(property.initializer) ||
            ts.isFunctionExpression(property.initializer))
        ) {
          const label = [...objectName, propName].join(".");
          registerFunction(property, property.name, label, "method", property.initializer.body);
          ts.forEachChild(property.initializer.body, (child) =>
            collectFunctions(child, [...objectName, propName]),
          );
        }
      }
    }
  }

  ts.forEachChild(node, (child) => collectFunctions(child, scope));
}

function isNestedFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function collectEdges(from: FunctionInfo, body: ts.Node | undefined): void {
  if (!body) return;

  function visit(node: ts.Node): void {
    if (node !== body && isNestedFunctionNode(node)) {
      return;
    }

    if (ts.isCallExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.expression);
      const target = symbol ? symbolToFunction.get(symbol) : undefined;
      if (target) {
        edges.add(`${from.id}-->${target.id}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(body);
}

collectFunctions(source);

for (const info of functions.values()) {
  collectEdges(info, info.body);
}

const orderedFunctions = [...functions.values()].sort((a, b) => a.label.localeCompare(b.label));

const orderedEdges = [...edges].sort();

console.log("flowchart TD");

for (const info of orderedFunctions) {
  const shape = info.kind === "method" ? `(${info.label})` : `[${info.label}]`;
  console.log(`  ${info.id}${shape}`);
}

for (const edge of orderedEdges) {
  console.log(`  ${edge}`);
}
