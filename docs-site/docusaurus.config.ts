import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'prlt',
  tagline: 'Agent orchestration platform for AI labor',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  // Production URL - will be GitHub Pages initially
  url: 'https://chrismcdermut.github.io',
  baseUrl: '/proletariat/',

  // GitHub pages deployment config
  organizationName: 'chrismcdermut',
  projectName: 'proletariat',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/chrismcdermut/proletariat/tree/main/docs-site/',
          routeBasePath: '/', // Serve docs at root instead of /docs
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/prlt-social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'prlt',
      logo: {
        alt: 'prlt Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'commandsSidebar',
          position: 'left',
          label: 'Commands',
        },
        {
          href: 'https://github.com/chrismcdermut/proletariat',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://discord.gg/tmZyjNNSvw',
          label: 'Discord',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started/installation',
            },
            {
              label: 'Command Reference',
              to: '/commands',
            },
            {
              label: 'Guides',
              to: '/guides/spawning-agents',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.gg/tmZyjNNSvw',
            },
            {
              label: 'GitHub Issues',
              href: 'https://github.com/chrismcdermut/proletariat/issues',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/chrismcdermut/proletariat',
            },
            {
              label: 'NPM',
              href: 'https://www.npmjs.com/package/@proletariat/cli',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} prlt. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,

  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        indexPages: true,
        docsRouteBasePath: "/",
      },
    ],
  ],
};

export default config;
