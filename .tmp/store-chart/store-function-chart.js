"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const typescript_1 = __importDefault(require("typescript"));
const targetPath = process.argv[2] ?? 'packages/core/src/store.ts';
const program = typescript_1.default.createProgram([targetPath], {
    target: typescript_1.default.ScriptTarget.ES2022,
    module: typescript_1.default.ModuleKind.ESNext,
    skipLibCheck: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(targetPath);
if (!source) {
    console.error(`Could not load ${targetPath}`);
    process.exit(1);
}
const functions = new Map();
const symbolToFunction = new Map();
const edges = new Set();
function toId(label) {
    return label.replace(/[^A-Za-z0-9_]/g, '_');
}
function getPropertyName(name) {
    if (!name)
        return null;
    if (typescript_1.default.isIdentifier(name) ||
        typescript_1.default.isStringLiteral(name) ||
        typescript_1.default.isNumericLiteral(name)) {
        return name.text;
    }
    return null;
}
function registerFunction(keyNode, symbolNode, label, kind, body) {
    const info = {
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
function collectFunctions(node, scope = []) {
    if (typescript_1.default.isFunctionDeclaration(node) && node.name && node.body) {
        const label = [...scope, node.name.text].join('.');
        registerFunction(node, node.name, label, 'function', node.body);
        typescript_1.default.forEachChild(node, child => collectFunctions(child, [...scope, node.name.text]));
        return;
    }
    if (typescript_1.default.isVariableDeclaration(node) &&
        typescript_1.default.isIdentifier(node.name) &&
        node.initializer &&
        (typescript_1.default.isArrowFunction(node.initializer) ||
            typescript_1.default.isFunctionExpression(node.initializer))) {
        const name = node.name.text;
        const label = [...scope, name].join('.');
        registerFunction(node, node.name, label, 'const', node.initializer.body);
        typescript_1.default.forEachChild(node.initializer.body, child => collectFunctions(child, [...scope, name]));
        return;
    }
    if (typescript_1.default.isVariableDeclaration(node) &&
        typescript_1.default.isIdentifier(node.name) &&
        node.initializer) {
        if (typescript_1.default.isObjectLiteralExpression(node.initializer)) {
            const objectName = [...scope, node.name.text];
            for (const property of node.initializer.properties) {
                if (!('name' in property) || !property.name)
                    continue;
                const propName = getPropertyName(property.name);
                if (!propName)
                    continue;
                if (typescript_1.default.isMethodDeclaration(property)) {
                    const label = [...objectName, propName].join('.');
                    registerFunction(property, property.name, label, 'method', property.body);
                    if (property.body) {
                        typescript_1.default.forEachChild(property.body, child => collectFunctions(child, [...objectName, propName]));
                    }
                    continue;
                }
                if (typescript_1.default.isPropertyAssignment(property) &&
                    (typescript_1.default.isArrowFunction(property.initializer) ||
                        typescript_1.default.isFunctionExpression(property.initializer))) {
                    const label = [...objectName, propName].join('.');
                    registerFunction(property, property.name, label, 'method', property.initializer.body);
                    typescript_1.default.forEachChild(property.initializer.body, child => collectFunctions(child, [...objectName, propName]));
                }
            }
        }
    }
    typescript_1.default.forEachChild(node, child => collectFunctions(child, scope));
}
function isNestedFunctionNode(node) {
    return (typescript_1.default.isFunctionDeclaration(node) ||
        typescript_1.default.isFunctionExpression(node) ||
        typescript_1.default.isArrowFunction(node) ||
        typescript_1.default.isMethodDeclaration(node));
}
function collectEdges(from, body) {
    if (!body)
        return;
    function visit(node) {
        if (node !== body && isNestedFunctionNode(node)) {
            return;
        }
        if (typescript_1.default.isCallExpression(node)) {
            const symbol = checker.getSymbolAtLocation(node.expression);
            const target = symbol ? symbolToFunction.get(symbol) : undefined;
            if (target) {
                edges.add(`${from.id}-->${target.id}`);
            }
        }
        typescript_1.default.forEachChild(node, visit);
    }
    visit(body);
}
collectFunctions(source);
for (const info of functions.values()) {
    collectEdges(info, info.body);
}
const orderedFunctions = [...functions.values()].sort((a, b) => a.label.localeCompare(b.label));
const orderedEdges = [...edges].sort();
console.log('flowchart TD');
for (const info of orderedFunctions) {
    const shape = info.kind === 'method' ? `(${info.label})` : `[${info.label}]`;
    console.log(`  ${info.id}${shape}`);
}
for (const edge of orderedEdges) {
    console.log(`  ${edge}`);
}
