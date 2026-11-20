import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { isValidElement, type ReactNode } from "react";

import { docsContentRoute, docsRoute } from "./shared";

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute,
});

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "content.md"];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed");

  return `# ${page.data.title} (${page.url})

${processed}`;
}

type Tree = ReturnType<(typeof source)["getPageTree"]>;
type TreeNode = Tree["children"][number];

/** A heading's title can hold elements such as inline code. The sidebar shows its text. */
function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return "";
}

/**
 * The page tree with each page's headings nested under it, so the left sidebar
 * is also the table of contents. Second-level headings sit under the page and
 * third-level headings sit under their second-level heading.
 */
export function getSidebarTree(): Tree {
  const tree = source.getPageTree();

  const withHeadings = (node: TreeNode): TreeNode => {
    if (node.type === "folder") return { ...node, children: node.children.map(withHeadings) };
    if (node.type !== "page" || node.external) return node;

    const toc = source.getNodePage(node)?.data.toc ?? [];
    const sections: TreeNode[] = [];
    for (const heading of toc) {
      const link: TreeNode = {
        type: "page",
        name: plainText(heading.title),
        url: `${node.url}${heading.url}`,
      };
      const parent = sections.at(-1);
      if (heading.depth <= 2 || !parent) {
        sections.push(link);
      } else if (heading.depth === 3) {
        if (parent.type === "page") {
          sections[sections.length - 1] = {
            type: "folder",
            name: parent.name,
            index: parent,
            defaultOpen: true,
            children: [link],
          };
        } else if (parent.type === "folder") {
          parent.children.push(link);
        }
      }
    }
    if (sections.length === 0) return node;
    return { type: "folder", name: node.name, index: node, children: sections };
  };

  return { ...tree, children: tree.children.map(withHeadings) };
}
