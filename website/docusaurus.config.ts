import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const GITHUB = 'https://github.com/MateenKhan/table';
const NPM = 'https://www.npmjs.com/package/@jugaaadi/table';

/**
 * The demo is the application itself — Vite builds it and CI drops it in at
 * /demo, so it is not a Docusaurus route and `onBrokenLinks: 'throw'` cannot
 * see it. Linking absolutely keeps the strict check on for every real doc link
 * instead of downgrading the whole site to warnings for this one path.
 */
const DEMO = 'https://table.jugaaadi.com/demo/';

const config: Config = {
  title: '@jugaaadi/table',
  tagline:
    'A spreadsheet-style data table for React — editable cells, formulas, rich column types and a query builder',
  favicon: 'img/favicon.ico',

  future: { v4: true },

  url: 'https://table.jugaaadi.com',
  baseUrl: '/',

  organizationName: 'MateenKhan',
  projectName: 'table',

  onBrokenLinks: 'throw',

  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl: `${GITHUB}/tree/main/website/`,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: '@jugaaadi/table',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        { to: '/docs/query', label: 'Query', position: 'left' },
        { to: '/docs/theming', label: 'Theming', position: 'left' },
        // The demo is the real application, built by Vite and dropped into
        // /demo by CI — not a Docusaurus route, hence href rather than to.
        { href: DEMO, label: 'Live demo', position: 'left' },
        { href: NPM, label: 'npm', position: 'right' },
        { href: GITHUB, label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting started', to: '/docs/intro' },
            { label: 'Integrating', to: '/docs/integrating' },
            { label: 'Query builder', to: '/docs/query' },
            { label: 'Theming', to: '/docs/theming' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'Live demo', href: DEMO },
            { label: 'npm', href: NPM },
            { label: 'GitHub', href: GITHUB },
            { label: 'Issues', href: `${GITHUB}/issues` },
          ],
        },
        {
          title: 'Built on',
          items: [
            { label: 'TanStack Table', href: 'https://tanstack.com/table' },
          ],
        },
      ],
      copyright: `MIT © ${new Date().getFullYear()} jugaaadi. Provided as is, without warranty — verify your own numbers.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
