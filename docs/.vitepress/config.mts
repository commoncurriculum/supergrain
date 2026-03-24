import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Supergrain",
  base: "/supergrain/",
  description:
    "A reactive store library with super fine-grained reactivity powered by alien-signals",

  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/hero-grain.svg" }]],

  themeConfig: {
    logo: "/hero-grain.svg",

    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "#installation" },
      { text: "GitHub", link: "https://github.com/commoncurriculum/supergrain" },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/commoncurriculum/supergrain" }],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2024 Common Curriculum",
    },
  },
});
