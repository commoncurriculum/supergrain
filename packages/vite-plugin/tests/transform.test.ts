import { describe, it, expect, afterAll } from "vitest";
import ts from "typescript";
import path from "path";
import fs from "fs";
import os from "os";
import { transformCode } from "../src/plugin";

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTestProgram(
  code: string,
  options?: { jsx?: boolean },
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  // Write temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "supergrain-test-"));
  tmpDirs.push(tmpDir);
  const ext = options?.jsx ? "test.tsx" : "test.ts";
  const filePath = path.join(tmpDir, ext);
  fs.writeFileSync(filePath, code);

  // Find @supergrain/core and @supergrain/react types
  const coreTypesDir = path.resolve(__dirname, "../../core");
  const reactTypesDir = path.resolve(__dirname, "../../react");

  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    paths: {
      "@supergrain/core": [path.join(coreTypesDir, "src/index.ts")],
      "@supergrain/react": [path.join(reactTypesDir, "src/index.ts")],
    },
    baseUrl: tmpDir,
  };

  if (options?.jsx) {
    compilerOptions.jsx = ts.JsxEmit.ReactJSX;
  }

  const program = ts.createProgram([filePath], compilerOptions);

  const sourceFile = program.getSourceFile(filePath)!;
  const checker = program.getTypeChecker();

  return { sourceFile, checker };
}

describe("supergrain vite plugin: transform", () => {
  it("transforms $$() in text position to ref + useDirectBindings", () => {
    const code = `
import { $$ } from '@supergrain/react'
function Row({ item }) {
  return <td><a>{$$(item.label)}</a></td>
}
`;
    const { sourceFile, checker } = createTestProgram(code, { jsx: true });
    const result = transformCode(code, sourceFile, checker);
    expect(result).not.toBeNull();
    expect(result!.code).toContain("useRef");
    expect(result!.code).toContain("useDirectBindings");
    expect(result!.code).toContain("ref={__$$0}");
    expect(result!.code).not.toContain("$$(");
  });

  it("transforms $$() in attribute position", () => {
    const code = `
import { $$ } from '@supergrain/react'
function Row({ item, selected }) {
  return <tr className={$$(() => selected === item.id ? 'danger' : '')}></tr>
}
`;
    const { sourceFile, checker } = createTestProgram(code, { jsx: true });
    const result = transformCode(code, sourceFile, checker);
    expect(result).not.toBeNull();
    expect(result!.code).toContain("attr: 'className'");
    expect(result!.code).toContain("ref={__$$0}");
  });

  it("handles multiple $$() in one component", () => {
    const code = `
import { $$ } from '@supergrain/react'
function Row({ item, selected }) {
  return (
    <tr className={$$(() => selected === item.id ? 'danger' : '')}>
      <td><a>{$$(item.label)}</a></td>
    </tr>
  )
}
`;
    const { sourceFile, checker } = createTestProgram(code, { jsx: true });
    const result = transformCode(code, sourceFile, checker);
    expect(result).not.toBeNull();
    expect(result!.code).toContain("__$$0");
    expect(result!.code).toContain("__$$1");
    expect(result!.code).toContain("useDirectBindings");
  });

  it("does not transform when no $$() calls", () => {
    const code = `
function Row({ item }) {
  return <td>{item.label}</td>
}
`;
    const { sourceFile, checker } = createTestProgram(code, { jsx: true });
    const result = transformCode(code, sourceFile, checker);
    expect(result).toBeNull();
  });
});
