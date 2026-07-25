# Table

A world-class, **spreadsheet-style data table for React** — editable cells,
formulas, rich column types, cell & border formatting, a query builder, find &
replace, shareable views, and a "build your own" blank sheet. It's a full
spreadsheet UI, not just a grid.

## Built on — and crediting — TanStack Table

This project is an **extension of [TanStack Table v8](https://tanstack.com/table)**.
It began life as the official TanStack Table **"kitchen-sink" example** and grew
into a complete spreadsheet on top of it — TanStack Table remains the core engine
(columns, sorting, filtering, grouping, pinning, pagination, the row model).

Enormous thanks to **[Tanner Linsley](https://github.com/tannerlinsley)** and the
**TanStack** team. If you use this project, please also star and support
[TanStack Table](https://github.com/TanStack/table) — none of this exists without
it. Attribution is preserved in [`LICENSE`](./LICENSE).

---

## Features

### Cells & editing
- **Excel-style editing** — click to select, type to edit, `Enter`/`Tab` to move,
  keyboard navigation, and a **fill handle** for drag-fill.
- **Selection** — single cell, range, whole row, whole column, or the entire grid
  (Excel-style header/gutter clicks); the selection overlay never bleeds over the
  sticky header on scroll.
- **Copy / paste**, and **Clear** (empties the selection, with a confirm).
- **Undo / redo** history for edits and formulas.

### Formulas
- `=A1+B2` A1-style references, plus **column-name references** (e.g. `age1`).
- **Custom functions** you define and reuse.
- **Live highlighting** of the cells a formula references while you type it.

### Column types
- **Text, number, decimal, currency, date, date-time**, and **units**
  (feet, inches, mm, degrees, …) rendered with their symbols.
- **User-defined custom units** via a type registry.
- **Mixed-content columns** that accept **images / files / text**, with
  **drag-and-drop** upload into image/file cells and a lightbox preview.

### Formatting
- Per-cell **fill color** and **text color** (palette + custom hex).
- **Text alignment** (left / center / right).
- **Drawable borders** — per-side, with color, style, and width (S / M / L or a
  custom 1–10).
- **Font size** and **font family**.

### Columns & rows
- **Resize**, **drag-reorder**, **pin / freeze**, **group**, **sort**,
  **hide / show**, **insert / delete**, and **merge / combine** columns.
- Per-column **type** picker and an **Arrange** menu (pin / sort / group).
- **Freeze / lock rows** (with a lock indicator), per-**row height** (S / M / L),
  **delete row**, and **promote a row to the header**.

### Search, query & data ops
- A **token-based query builder** with schema-driven suggestions and common
  shortcuts, plus **saved queries**.
- **Find & replace** across the sheet.
- **Compact pagination**.
- **Format profiles** — save and reapply a view's formatting.

### Build-your-own sheet & persistence
- **Blank-sheet mode** — "Delete all" clears to a generic editable sheet: rename
  headers, add / insert / delete rows and columns, use-row-as-header.
- **Persistence** — a sheet you build **survives reloads** (localStorage); the
  demo data stays ephemeral, and **Restore** brings it back.
- **Export & share** — export the full view + data as **JSON**, or a **shareable
  page** that opens with your exact columns, data, and formatting.

### UI / UX
- A single, **consolidated toolbar**: one contextual **Format** group whose icons
  appear/disappear with the selection, plus colour-coded **Pagination / Tools /
  Danger** groups; every control is icon-only with tooltips.
- **Responsive** — search / actions split on wide screens, wrap on narrow ones,
  and a **"⋯" overflow menu** collapses groups that don't fit.
- **Light / dark theme aware**, reduced-motion-safe animation, and accessible
  labels throughout.

---

## Run it locally

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

- **`VITE_APP_URL`** — the public origin that **Export & Share** links open
  against. Defaults to the current origin (`http://localhost:5173` in dev); set it
  to your deployed URL at build/deploy time.

> **Note on images:** uploaded images/files are held as in-session `blob:` URLs —
> they don't survive a reload or travel inside an exported file. Typed values and
> formatting persist fine. For production image persistence, wire the attachment
> store to IndexedDB / a backend (see [`INTEGRATING.md`](./INTEGRATING.md)).

---

## Tech stack

React 18 · TypeScript · Vite 5 · **[TanStack Table v8](https://tanstack.com/table)** ·
Tailwind CSS · Framer Motion · react-colorful · react-day-picker · react-dropzone ·
lz-string.

## License

[MIT](./LICENSE) © 2026 Mateen Khan. Portions © TanStack Table
([Tanner Linsley](https://github.com/tannerlinsley)) — see [`LICENSE`](./LICENSE).
