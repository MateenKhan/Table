import React from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * Landing page: pitch, then the real thing.
 *
 * The demo is the application itself — Vite builds it to /demo and CI copies it
 * in beside this site. It is framed rather than imported so the app keeps its
 * own compiled stylesheet: Docusaurus's Infima and the table's Tailwind build
 * would otherwise fight over the same element selectors and the demo would
 * misrepresent what a consumer actually gets.
 */

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Excel-style editing',
    body: 'Click to select, type to edit, Enter and Tab to move, drag-fill from the handle, copy and paste, and undo/redo across it all.',
  },
  {
    title: 'Formulas',
    body: 'A1-style references and column-name references, custom functions you define yourself, and live highlighting of the cells a formula touches as you type.',
  },
  {
    title: 'Rich column types',
    body: 'Text, number, decimal, currency, date and date-time, plus units (feet, inches, mm, degrees) and your own custom units via a type registry.',
  },
  {
    title: 'Media in cells',
    body: 'Images, video, audio and documents with click, drag-drop or paste upload, inline players, a lightbox, per-file size limits and an upload-to-server hook.',
  },
  {
    title: 'Query builder',
    body: 'A token-based query bar with schema-driven suggestions, and/or combinators and saved queries, plus find & replace across the whole sheet.',
  },
  {
    title: 'Build your own sheet',
    body: 'Start from a blank grid: name the headers, insert rows and columns anywhere, promote a row to the header. What you build survives a reload.',
  },
];

export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title="Spreadsheet-style data table for React"
      description={siteConfig.tagline}
    >
      <header className="heroBanner">
        <div className="container">
          <h1 className="heroTitle">{siteConfig.title}</h1>
          <p className="heroSubtitle">{siteConfig.tagline}</p>
          <div className="heroButtons">
            <Link className="button button--secondary button--lg" to="/docs/intro">
              Get started
            </Link>
            <Link
              className="button button--outline button--secondary button--lg"
              href="https://table.jugaaadi.com/demo/"
            >
              Open the demo full screen
            </Link>
          </div>
        </div>
      </header>

      <main>
        <p className="demoNote">
          Live below — it is the real application, not a recording. Edit a cell,
          rename a header, sort a column, or press <code>?</code> for the
          shortcuts.
        </p>
        <div className="demoFrameWrap">
          <iframe
            className="demoFrame"
            src="/demo/"
            title="Live spreadsheet demo"
            loading="lazy"
          />
        </div>

        <section className="featureGrid">
          {FEATURES.map((feature) => (
            <div className="featureCard" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          ))}
        </section>
      </main>
    </Layout>
  );
}
