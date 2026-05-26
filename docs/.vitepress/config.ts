import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "mad-reviewer",
  description:
    "Self-hosted GitHub App that auto-reviews PRs with a configurable AI tool and reconciles its own comments across runs.",
  base: "/mad-reviewer/",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,

  // Internal dev artifacts live under docs/superpowers and must not become pages.
  srcExclude: ["superpowers/**", "README.md"],

  themeConfig: {
    outline: "deep",
    search: { provider: "local" },

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Reference", link: "/reference/faq" },
      { text: "Contributing", link: "/contributing" },
    ],

    sidebar: [
      {
        text: "Guide",
        collapsed: false,
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "GitHub App Setup", link: "/guide/github-app-setup" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Skills", link: "/guide/skills" },
          { text: "Persona (SOUL.md)", link: "/guide/soul" },
          { text: "Deployment", link: "/guide/deployment" },
        ],
      },
      {
        text: "Architecture",
        collapsed: false,
        items: [
          { text: "Overview", link: "/architecture/overview" },
          { text: "Reconciliation", link: "/architecture/reconciliation" },
          { text: "Orchestration Queue", link: "/architecture/queue" },
          { text: "AI Adapters", link: "/architecture/adapters" },
        ],
      },
      {
        text: "Reference",
        collapsed: false,
        items: [
          { text: "Scripts", link: "/reference/scripts" },
          { text: "FAQ", link: "/reference/faq" },
        ],
      },
      { text: "Contributing", link: "/contributing" },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/deniscsz/mad-reviewer" },
    ],

    editLink: {
      pattern:
        "https://github.com/deniscsz/mad-reviewer/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Denis Spalenza",
    },
  },
});
