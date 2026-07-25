/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PIRANHA EXPORT-EXCLUSION REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This table is being built to be imported into the piranha app as a reusable
 * template component. MOST of it goes across — but some features are deliberately
 * temp_table-only and MUST NOT be exported/imported into piranha.
 *
 * This file is the single source of truth for "what stays behind". When the table
 * is copied into piranha, everything listed under EXCLUDED_FROM_EXPORT is left
 * out (and its wiring in App.tsx is behind the `import(...)` lazy boundary + the
 * template gate, so a build that drops these files still compiles).
 *
 * Rule of thumb: a feature belongs here if it is a *domain-specific vertical*
 * (interiors, cupboards, estimates) rather than core spreadsheet behaviour. The
 * core table (cells, formulas, selection, merge, query, export, formatting) is
 * NOT excluded — it is the thing piranha wants.
 *
 * Keep this list in sync whenever a new excluded feature is added. It is imported
 * by nothing at runtime on purpose — it is documentation with teeth: the import
 * tooling (and any human doing the port) reads it to know what to skip.
 */

export type ExcludedEntry = {
  /** Stable id for the excluded feature. */
  id: string
  /** Human summary of what it is and why it stays behind. */
  reason: string
  /** Files/directories (repo-relative) that must not be exported. */
  paths: string[]
}

export const EXCLUDED_FROM_EXPORT: ExcludedEntry[] = [
  {
    id: 'table-templates',
    reason:
      'Domain-specific table templates (row/column presets + default values + ' +
      'images) loaded via a selector or the URL subdomain. Verticals like ' +
      'Interior are prototyped here but not part of the generic piranha table.',
    paths: [
      'src/templates/', // types, registry, per-vertical template definitions
      'src/components/TemplateSelector.tsx', // the dropdown UI (lazy-loaded)
    ],
  },
  {
    id: 'interior-generator',
    reason:
      'Interior images generator — an interior enters sizes (length/width/height, ' +
      'images later) and the table generates its rows. A jugaaadi vertical, not a ' +
      'piranha feature.',
    paths: [
      'src/templates/interior.ts',
      // (future) src/templates/interior/* — image generation lives here
    ],
  },
  {
    id: 'url-subdomain-template-routing',
    reason:
      'Loading a template from the hostname subdomain (interior.jugaaadi.com) is a ' +
      'jugaaadi deployment concern. piranha mounts the table itself and picks the ' +
      'template through its own props/routing, not window.location.',
    paths: [
      'src/templates/resolveTemplate.ts', // reads location -> template id
    ],
  },
]

/** Flat list of every excluded path, for tooling that just wants the glob set. */
export const EXCLUDED_PATHS: string[] = EXCLUDED_FROM_EXPORT.flatMap(
  (entry) => entry.paths,
)
