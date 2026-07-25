# Table

A world-class, spreadsheet-style data table for React — editable cells, formulas,
rich column types, cell/border formatting, find & replace, shareable views, and a
"build your own" blank sheet. Built on [TanStack Table v8](https://tanstack.com/table).

> **Credit & lineage.** This project began as the official TanStack Table
> **"kitchen-sink" example** and grew from there — think of it as a heavily
> extended v2 of that example. TanStack Table remains its core engine. Huge
> thanks to [Tanner Linsley](https://github.com/tannerlinsley) and the TanStack
> team. See [`LICENSE`](./LICENSE) for the (MIT) attribution.

## Features

- **Editable grid** — Excel-style cell editing, keyboard navigation, range
  selection, and a fill handle.
- **Formulas** — `=A1+B2`, column-name references (e.g. `age1`), custom
  functions, and live highlighting of the cells a formula references as you type.
- **Rich column types** — text, number, currency, date & datetime, and units
  (feet, inches, mm, degrees, …) with symbols, plus user-defined custom units and
  columns that accept mixed content (images / files / text).
- **Drag & drop** — image/file columns accept dropped files.
- **Formatting** — per-cell fill and text color, text alignment, and drawable
  borders with color, style, and width (S / M / L or a custom 1–10).
- **Column & row operations** — resize, drag-reorder, pin/freeze, group, sort,
  merge/combine columns, and per-row height; select whole rows or columns.
- **Query & search** — a token-based query builder with schema-driven
  suggestions, saved queries, and find & replace across the sheet.
- **Blank sheet mode** — "Delete all" clears to a blank, generic sheet you build
  yourself: rename headers, add rows/columns, insert/delete columns, and promote a
  row to the header. Your own sheet **persists across reloads** (localStorage);
  the demo data stays ephemeral, and **Restore** brings it back.
- **Export & share** — export the full view + data as JSON, or a shareable page
  that opens with your exact columns, data, and formatting.
- **Undo / redo**, compact pagination, light/dark theming, and reduced-motion-safe
  animation.

## Getting started

```bash
npm install
npm start          # dev server on http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build to dist/
npm run serve      # preview the production build
```

### Configuration

- `VITE_APP_URL` — the public origin that **Export & Share** links should open
  against. Defaults to the current origin (e.g. `http://localhost:5173` in dev).
  Set it to your deployed URL at build/deploy time.

## Tech stack

React 18 · TypeScript · Vite 5 · [TanStack Table v8](https://tanstack.com/table) ·
Tailwind CSS · Framer Motion · react-colorful · react-day-picker · react-dropzone ·
lz-string.

## License

[MIT](./LICENSE) © Mateen Khan. Portions © TanStack Table (Tanner Linsley).
