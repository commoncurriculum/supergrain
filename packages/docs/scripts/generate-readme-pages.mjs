// Generates the package reference pages in content/docs/ from each package's
// README.md, so the READMEs stay the single source of truth (the VitePress
// site did the same with `<!--@include: ../packages/X/README.md-->`).
//
// The generated pages are gitignored; `readme-pages.json` lists them, and
// @supergrain/doc-tests reads the same manifest to skip them (their examples
// are validated at the source README instead).
//
// Transformations:
// - the leading `# @supergrain/<pkg>` heading becomes frontmatter (title/description)
// - links to another generated package's README become site links (/docs/<slug>)
// - links to this site (https://commoncurriculum.github.io/supergrain/...) become site links
// - any other relative link becomes a GitHub link, since it points into the repo
// Code blocks are copied verbatim.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const docsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(docsDir, "..");
const outDir = join(docsDir, "content/docs");
const siteUrl = "https://commoncurriculum.github.io/supergrain";
const repoUrl = "https://github.com/commoncurriculum/supergrain/blob/main";

const pages = JSON.parse(readFileSync(join(docsDir, "readme-pages.json"), "utf-8"));
const slugByPackage = new Map(pages.map((page) => [page.package, page.slug]));

function rewriteLink(target, pkg) {
  if (target.startsWith(`${siteUrl}/`)) return target.slice(siteUrl.length);
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;

  const [path, hash] = target.split("#");
  const repoPath = posix.normalize(posix.join("packages", pkg, path));
  const readme = /^packages\/([^/]+)\/README\.md$/.exec(repoPath);
  const slug = readme && slugByPackage.get(readme[1]);
  if (slug) return `/docs/${slug}${hash ? `#${hash}` : ""}`;
  return `${repoUrl}/${repoPath}${hash ? `#${hash}` : ""}`;
}

for (const { slug, package: pkg, title, description } of pages) {
  const readme = readFileSync(join(packagesDir, pkg, "README.md"), "utf-8");
  const heading = `# @supergrain/${pkg}\n`;
  if (!readme.startsWith(heading)) {
    throw new Error(`packages/${pkg}/README.md should start with "${heading.trim()}"`);
  }

  // Rewrite markdown links outside fenced code blocks only, so code like
  // `handlers[type](payload)` is left alone.
  let inFence = false;
  const body = readme
    .slice(heading.length)
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${rewriteLink(target, pkg)})`);
    })
    .join("\n");
  const frontmatter = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\n---\n`;

  writeFileSync(
    join(outDir, `${slug}.md`),
    `${frontmatter}\n<!-- Generated from packages/${pkg}/README.md by scripts/generate-readme-pages.mjs. Edit the README, not this file. -->\n${body}`,
  );
}

console.log(`Generated ${pages.length} pages from package READMEs into content/docs/.`);
