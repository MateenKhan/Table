# Integrating & extending this table

Notes for dropping this spreadsheet table into your own React app, and the
gotchas worth knowing before you build on it — especially around **images and
persistence**.

---

## What you get

The core spreadsheet: cell editing, formulas (`=A1+B2` and custom functions),
cell / range / whole-column selection, the fill handle, column merge, the query
builder, column types (number / decimal / currency / text / date / units /
file / image), thumbnails, formatting (fill / text color / alignment / borders),
export & share, and column drag/reorder.

---

## Styling & theming

The table is **Tailwind-native**. Its look is driven entirely by utility classes
and a small set of design tokens, so it inherits your app's theme when the class
names resolve against your Tailwind config. The class families it relies on:

`bg-white`, `border-slate-200` (hairline grid), `rounded-lg`, `accent-*`,
`min-h-control`, `sm:hover:*`, and the component classes `.btn-*`, `.icon-btn*`,
`.input*`, `.eyebrow`.

Conventions the UI follows:

- **Light theme is the default;** the table is also dark-theme aware.
- **`accent-*` is identity / selection only** — used for the selected cell, the
  active column, and focus, never as decoration.
- **Hover styling is `sm:hover:` gated** so touch devices don't get stuck hover
  states.
- **Radius follows a 3-tier scale**, and motion uses a standard ease curve —
  never `linear`, never a hard cut.

To restyle, remap those tokens in your Tailwind config; you shouldn't need to
touch component markup.

---

## Accessibility & motion

- Some toolbar / cell buttons use a native `title=` tooltip **with an
  `aria-label` alongside**. If you have a richer tooltip component, wrap those
  buttons in it and keep the `aria-label`.
- Animation (including column drag) honors **`prefers-reduced-motion`** via CSS
  and an explicit guard, so reduced-motion users get an instant, non-animated UI.

---

## Persistence & images — read this before you ship

The table persists to **`localStorage`**:

- **Settings / state** — column merges, custom functions, per-cell formatting,
  saved queries, and a user-built ("blank") sheet. These are small and serialize
  cleanly, so they survive reloads.
- **Images / files** are held as **blob object URLs** (`blob:…`). Two things
  anyone building on this *must* account for:

  1. **Blob URLs don't serialize.** A `blob:` URL is only valid for the current
     page session — it will **not** survive a reload, and it will **not** travel
     inside an exported / shared file. Only typed values (text / number / date /
     currency / units) and formatting are portable.
  2. **`localStorage` has a ~5 MB quota.** Row data with embedded images can blow
     past it, and the write will silently fail.

  **Decision for production:** store binary data in **IndexedDB** (large,
  structured) and keep only settings in `localStorage` — **or** accept that
  uploaded images are session-only and don't persist across reloads. Everything
  that isn't a blob persists fine either way.

> The blank-sheet mode already follows this split: a user-built sheet (rows +
> headers + formulas) is saved to `localStorage`, while the demo data is
> intentionally ephemeral. Uploaded images in a saved sheet are still subject to
> the blob-URL caveat above.

---

## Verify after changes

- `npx tsc --noEmit` — clean.
- `npm run build` (`vite build`) — clean.
- The table renders styled: accent selection, hairline grid, light theme.
