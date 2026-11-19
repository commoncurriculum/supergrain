import type { Route } from "./+types/docs";

import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";

import { useMDXComponents } from "@/components/mdx";
import { withBase } from "@/lib/base";
import { baseOptions } from "@/lib/layout.shared";
import { getPageImagePath } from "@/lib/og";
import { gitConfig } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";

import readmePages from "../../readme-pages.json";

// Package pages are generated from each package's README, so link to that.
function sourcePath(path: string): string {
  const readme = readmePages.find((page) => `${page.slug}.md` === path);
  return readme ? `packages/${readme.package}/README.md` : `packages/docs/content/docs/${path}`;
}

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = params["*"].split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    // Base-prefixed so they resolve under the /supergrain/ Pages subpath.
    markdownUrl: withBase(getPageMarkdownUrl(page).url),
    pageTree: await source.serializePageTree(source.getPageTree()),
    imagePath: withBase(getPageImagePath(slugs)),
  };
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    // you can define props for the `<Content />` component
    {
      markdownUrl,
      path,
      imagePath,
    }: {
      markdownUrl: string;
      path: string;
      imagePath: string;
    },
  ) {
    return (
      <DocsPage toc={toc}>
        <title>{frontmatter.title}</title>
        <meta name="description" content={frontmatter.description} />
        <meta property="og:image" content={imagePath} />
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${sourcePath(path)}`}
          />
        </div>
        <DocsBody>
          <Mdx components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { path, pageTree, imagePath, markdownUrl } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      {clientLoader.useContent(path, { markdownUrl, path, imagePath })}
    </DocsLayout>
  );
}
