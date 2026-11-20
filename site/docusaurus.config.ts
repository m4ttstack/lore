import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes } from "prism-react-renderer";

const config: Config = {
  title: "Lore",
  tagline: "Portable domain rules for code review.",
  url: "https://m4ttstack.github.io",
  baseUrl: "/lore/",
  organizationName: "m4ttstack",
  projectName: "lore",
  trailingSlash: false,
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: {
    format: "detect",
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/m4ttstack/lore/edit/main/site/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        docsRouteBasePath: "/",
        hashed: true,
        indexBlog: false,
      },
    ],
  ],
  plugins: [["docusaurus-plugin-llms", { generateMarkdownFiles: true }]],
  themeConfig: {
    navbar: {
      title: "Lore",
      items: [
        { type: "docSidebar", sidebarId: "guide", label: "Guide", position: "left" },
        { type: "docSidebar", sidebarId: "reference", label: "Reference", position: "left" },
        { type: "docSidebar", sidebarId: "spec", label: "Specification", position: "left" },
        { href: "https://github.com/m4ttstack/lore", label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "light",
      links: [
        { label: "GitHub", href: "https://github.com/m4ttstack/lore" },
        { label: "npm", href: "https://www.npmjs.com/package/@mattstack/lore" },
        { label: "Releases", href: "https://github.com/m4ttstack/lore/releases" },
      ],
      copyright: "Lore. Spec text CC BY 4.0, code MIT.",
    },
    prism: {
      theme: themes.github,
      darkTheme: themes.oneDark,
      additionalLanguages: ["bash", "json", "diff", "yaml"],
    },
    colorMode: { respectPrefersColorScheme: true },
  } satisfies Preset.ThemeConfig,
};

export default config;
