import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: <span className="sg-wordmark">SUPERGRAIN</span>,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
