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

## Install & use

```bash
npm i @jugaaadi/table
```

```tsx
import { SpreadsheetTable } from '@jugaaadi/table'
import '@jugaaadi/table/style.css' // import the stylesheet once

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'age', header: 'Age' },
]
const data = [
  { name: 'Ada', age: 36 },
  { name: 'Alan', age: 41 },
]

export default function App() {
  return <SpreadsheetTable columns={columns} data={data} />
}
```

- `columns` are TanStack Table [`ColumnDef`](https://tanstack.com/table/latest/docs/api/core/column-def)s (re-exported as `ColumnDef`); omit `columns`/`data` for a blank sheet the user builds themselves.
- **`react` / `react-dom` 18+** are peer dependencies (bring your own).
- Import **`@jugaaadi/table/style.css` once** — the component ships its compiled styles, so you don't need Tailwind configured in your app.

### A quick blank N×M sheet

Give `rows` and `cols` instead of `columns`/`data` to drop the user into an empty sheet they fill in (columns `col1…colN`, editable, with **add row / add column** built in):

```tsx
<SpreadsheetTable rows={4} cols={4} onDataChange={(rows) => console.log(rows)} />
```

## Props & events

| Prop | Type | Description |
| --- | --- | --- |
| `columns` | `ColumnDef[]` | Column definitions. Omit for a blank sheet. |
| `data` | `Row[]` | Initial rows (`Row = Record<string, unknown>`). |
| `rows`, `cols` | `number` | Blank-sheet size when no `columns`/`data` are given. |
| `onDataChange` | `(rows) => void` | Fires after any change with **all** current rows — the way to read edits back out. Not fired on initial mount. |
| `onCellChange` | `(rowIndex, columnId, value) => void` | Fires **per cell** whose value changes (typing, fill, paste, clear, undo/redo). |
| `onColumnChange` | `(columns: ColumnInfo[]) => void` | Fires when columns change (add/remove/rename/retype/reorder/hide). |
| `onSelectionChange` | `(scope: SelectionScope) => void` | Fires when the selection changes (`kind` + row indices + column ids). |
| `onCellActivate` | `(info: CellEventInfo) => void` | Fires when a cell becomes active **by click or keyboard** — ideal for triggering an animation elsewhere in your app. |
| `onCellClick` | `(info, event) => void` | Cell click, with the native `MouseEvent`. |
| `onCellKeyDown` | `(info, event) => void` | Key pressed while a cell is active, with the native `KeyboardEvent`. |
| `onColumnHeaderClick` | `(columnId, event) => void` | A column header / letter (A, B, C…) was clicked. |
| `onRowHeaderClick` | `(rowIndex, event) => void` | A row-number gutter (1, 2, 3…) was clicked. |
| `maxFileSize` | `number` | Grid-wide max **upload** size in **bytes**. A per-column `meta.maxFileSize` wins over it. **Undefined = no limit** — there is no built-in default. |
| `onFileSizeLimitExceeded` | `(info: FileSizeLimitInfo) => boolean \| Promise<boolean>` | Called when an upload is over the limit. Return/resolve `true` to **keep**, `false` to **reject**. Omit to get the built-in agree/reject popup. |
| `onUploadToServer` | `(info: UploadToServerInfo) => void` | When set, an **upload-to-server button** appears on filled attachment cells; clicking it calls this with the attachment + original `File`. **No networking is shipped — you own the upload.** |
| `onUploadClick` / `onUploadKeyDown` / `onUploadMouseDown` / `onUploadMouseUp` / `onUploadDrop` | `(event, info: UploadCellInfo) => void` | Low-level upload interaction events, each with the native DOM event + the cell. |
| `exportEmbedLimit` | `number` | Max **bytes per attachment inline-embedded** into an exported `.json`/`.html`. Larger ones export as references. **Undefined = embed everything.** |
| `classNames` | `TableClassNames` | Per-part extra classes: `root`, `toolbar`, `tooltip`, `popup`, `toast`, `lightbox`. See [Theming](#theming--css-override). |

`CellEventInfo` is `{ rowIndex, columnId, value }`; `ColumnInfo` is `{ id, header, type? }`;
`FileSizeLimitInfo` is `{ file, limit, rowIndex, columnId }`; `UploadToServerInfo` is
`{ attachment, file, rowIndex, columnId }`; `UploadCellInfo` is `{ rowIndex, columnId }`.
All types are exported alongside the component.

```tsx
// e.g. run an animation in your own component when a cell is clicked / focused
<SpreadsheetTable
  columns={columns}
  data={data}
  onCellActivate={({ rowIndex, columnId }) => myAnimation.trigger(rowIndex, columnId)}
  onDataChange={(rows) => save(rows)}
/>
```

---

## Media, uploads & attachments

Any column can hold **images, videos, audio, documents — any file at all**. Declare
it with a column `meta.type`:

```tsx
const columns = [
  { accessorKey: 'name',   header: 'Name' },
  { accessorKey: 'avatar', header: 'Avatar', meta: { type: 'image' } },     // images only
  { accessorKey: 'clip',   header: 'Clip',   meta: { type: 'file' } },      // ANY file (video, pdf, zip…)
]
```

- **`type: 'image'`** — accepts images; renders a thumbnail + click-to-zoom lightbox.
- **`type: 'file'`** — accepts **any** file. Images/videos/audio get an inline
  player in the lightbox; everything else is a download chip with an icon + size.
- Upload three ways: **click** (file picker), **drag-and-drop**, or **paste** into
  the active cell. Restrict the picker with `meta.accept` (e.g. `'video/*'`, `'.pdf,.zip'`).

### File-size limits — no hard-coded caps

There is **no built-in size limit**. You set one, per column or grid-wide, and you
decide what happens when a file is over it.

```tsx
const columns = [
  // per-column cap (bytes) — wins over the grid-wide prop
  { accessorKey: 'avatar', header: 'Avatar', meta: { type: 'image', maxFileSize: 5 * 1024 * 1024 } },
]

<SpreadsheetTable
  columns={columns}
  // grid-wide fallback cap (bytes); omit for unlimited
  maxFileSize={20 * 1024 * 1024}

  // OPTION A — omit onFileSizeLimitExceeded: a built-in, fully themeable
  // agree/reject popup asks "File is larger than allowed — add anyway?"

  // OPTION B — own the decision (sync or async). true = keep, false = reject.
  onFileSizeLimitExceeded={({ file, limit, rowIndex, columnId }) => {
    return myDialog.confirm(`${file.name} is ${file.size}B (max ${limit}B). Keep it?`)
    // ...or `return false` to always reject, or return a Promise<boolean>.
  }}
/>
```

### Upload-to-server button (bring your own backend)

The grid ships **zero networking**. Provide `onUploadToServer` and an upload button
appears on every filled attachment cell; clicking it hands you the attachment and
the original `File` so you can do the upload however you like:

```tsx
<SpreadsheetTable
  columns={columns}
  onUploadToServer={async ({ attachment, file, rowIndex, columnId }) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    await fetch('/api/upload', { method: 'POST', body })
  }}
/>
```

### Low-level upload events

Observe the raw interaction on any attachment cell — each fires with the native
event and `{ rowIndex, columnId }`:

```tsx
<SpreadsheetTable
  columns={columns}
  onUploadClick={(e, cell) => …}
  onUploadKeyDown={(e, cell) => …}
  onUploadMouseDown={(e, cell) => …}
  onUploadMouseUp={(e, cell) => …}
  onUploadDrop={(e, cell) => …}
/>
```

---

## Import / export (with media)

**Export** the full view from the ⚙️ Settings → *Export & share* tab. Every path
captures the **complete view** — rows, formulas, **formatting (fill + text colors,
fonts, borders, alignment)**, column types, layout and merges — they differ only in
how the **media** travels:

- **`.zip`** *(best for media)* — a `view.json` **plus a `files/` folder of the real
  media files**, each linked from the JSON by name (`archivePath`). Re-import the
  whole `.zip` and every image/video/file is restored. This is the "real files,
  referenced by name" format.
- **`.json`** — one self-contained file; media is inlined as base64 `data:` URLs, so
  it opens anywhere but the file can get large.
- **`.html`** — a self-opening share page that reopens the app with this exact view.
- **Import** a previously exported `.zip`, `.json` or `.html` back in — media and all.

**Import is a true clone — identical down to the view state.** The export captures
the *entire* table, and import rebuilds all of it, so a view imported from a
completely different table (different columns, groups and types) turns the target
into an exact copy. What round-trips:

- **Column structure** — grouped headers, column order, per-column types, sizes,
  the row-select column, and computed (`accessorFn`) columns (their values are
  resolved into the data on export).
- **Data & media** — every cell, plus images / video / files (`.zip` keeps them
  as real files; `.json`/`.html` inline them).
- **Formatting** — fill + text colors, fonts, borders, alignment (per cell / row /
  column).
- **View state** — sorting, grouping, column filters, the search query, column
  visibility, pinning, column sizing, row pinning, per-row heights, row selection,
  and the page size.
- **Formulas** — including any **custom functions** the formulas call, and any
  **custom column-type presets** (units) a column uses, so both still work on
  another machine.

What a `.zip` contains:

```
table-view.zip
├── view.json                     # full snapshot; attachments link to files/ by name
├── files/
│   └── avatar/0-logo.png         # the real media, one file per attachment
└── README.txt
```

For the `.json`/`.html` paths, control how much media is inlined with
**`exportEmbedLimit`** (bytes): attachments larger than the cap export as references
instead of ballooning the file. Omit it to embed everything regardless of size. (The
`.zip` path always keeps media as real files, so this doesn't apply there.)

```tsx
<SpreadsheetTable columns={columns} exportEmbedLimit={50 * 1024 * 1024} />
```

> While editing, media lives in fast session-scoped `blob:` URLs; export reads the
> real bytes only at save time (into `files/` for `.zip`, or `data:` URLs for
> `.json`), so runtime stays snappy.

---

## Theming & CSS override

Every surface — **the whole app, and the portalled popups, tooltips and toasts** —
is restyleable, three ways you can mix freely.

### 1. Recolor with CSS variables

Set any `--jt-*` variable. On `:root` it reaches the portalled surfaces too (they
mount on `<body>`); on `.jt-root` it scopes to the grid.

```css
:root {
  --jt-accent: #7c3aed;        /* brand / focus */
  --jt-tooltip-bg: #111827;
  --jt-popup-bg: #ffffff;
  --jt-popup-radius: 0.75rem;
}
```

| Variable | Styles |
| --- | --- |
| `--jt-accent`, `--jt-accent-contrast` | Brand / keyboard-focus ring |
| `--jt-surface`, `--jt-text` | App root surface + text |
| `--jt-tooltip-bg`, `--jt-tooltip-fg`, `--jt-tooltip-radius` | Tooltips |
| `--jt-popup-bg`, `--jt-popup-fg`, `--jt-popup-border`, `--jt-popup-radius`, `--jt-overlay` | Popups / dialogs (incl. the size-limit popup) |
| `--jt-toast-bg`, `--jt-toast-fg`, `--jt-toast-radius` | Toasts |
| `--jt-lightbox-overlay` | Media lightbox backdrop |

### 2. Restyle anything via `data-jt` attributes

Every surface carries a stable `data-jt="<part>"` you can target with **any** CSS —
these rules win over the library's own styles, even on the portalled surfaces:

```css
.jt-root [data-jt="toolbar"] { border-bottom: 1px solid #eee; }
[data-jt="tooltip"] { box-shadow: 0 4px 20px rgba(0,0,0,.25); }
[data-jt="popup"]   { border: 2px solid #7c3aed; }
[data-jt="toast"]   { font-family: ui-monospace, monospace; }
```

Parts: `root`, `toolbar`, `tooltip`, `popup` (+ `popup-overlay`), `toast`, `lightbox`.

### 3. Inject classes with `classNames`

Merge your own classes (Tailwind or otherwise) onto each part:

```tsx
<SpreadsheetTable
  columns={columns}
  classNames={{
    root: 'rounded-xl shadow',
    tooltip: 'font-mono',
    popup: 'border-2 border-violet-500',
  }}
/>
```

You must import the stylesheet once for any of this to apply:

```tsx
import '@jugaaadi/table/style.css'
```

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
- **Media columns** (`image` / `file`) for **any file — images, video, audio,
  docs** — with click / drag-drop / paste upload, inline players, a lightbox,
  per-file **size limits**, an **upload-to-server** hook, and media-embedding
  **export**. See [Media, uploads & attachments](#media-uploads--attachments).
- **Mixed-content columns** that accept **images / files / text** in one column.

### Formatting
- Per-cell **fill color** and **text color** (palette + custom hex).
- **Text alignment** (left / center / right).
- **Drawable borders** — per-side, with color, style, and width (S / M / L or a
  custom 1–10).
- **Font size** and **font family**.

### Columns & rows
- **Resize**, **drag-reorder**, **pin / freeze**, **group**, **sort**,
  **hide / show**, and **merge / combine** columns.
- **Insert columns** left / right of any selected column, and **insert rows**
  above / below any selected row (from the contextual strip) — works on any
  table, grouped or flat, built-in or your own.
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
- **Export & share** — export the full view + data (**including embedded media**)
  as **JSON**, or a **shareable page** that opens with your exact columns, data,
  and formatting. See [Import / export](#import--export-with-media).

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

> **Note on images:** while editing, uploaded media lives in session-scoped
> `blob:` URLs (fast, but gone on reload). **Exporting embeds it as `data:` URLs**
> so it travels inside the file (see [Import / export](#import--export-with-media)
> and `exportEmbedLimit`). For live persistence across reloads, wire
> `onUploadToServer` to your backend, or the attachment store to IndexedDB (see
> [`INTEGRATING.md`](./INTEGRATING.md)).

---

## Tech stack

React 18 · TypeScript · Vite 5 · **[TanStack Table v8](https://tanstack.com/table)** ·
Tailwind CSS · Framer Motion · react-colorful · react-day-picker · react-dropzone ·
lz-string.

## License

[MIT](./LICENSE) © 2026 Mateen Khan. Portions © TanStack Table
([Tanner Linsley](https://github.com/tannerlinsley)) — see [`LICENSE`](./LICENSE).
