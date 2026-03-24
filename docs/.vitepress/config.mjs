import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Supergrain",
  base: "/supergrain/",
  description: "A reactive store library with super fine-grained reactivity",
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "GitHub", link: "https://github.com/commoncurriculum/supergrain" },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/commoncurriculum/supergrain" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024",
    },
  },
});
