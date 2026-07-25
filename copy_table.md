# Copying this table into piranha

This document is the runbook for importing the spreadsheet table (`F:\code\test\temp_table`)
into the **piranha** app (`F:\code\ai\piranha`), where it will be used as a template component.
It records the general steps AND — importantly — the parts that are **deliberately left behind**
because they are jugaaadi-specific verticals, not generic piranha table features.

> Single source of truth for what stays behind: **`src/piranhaExcluded.ts`**. If you add a new
> jugaaadi-only feature, add it there and it is automatically covered by "Do not copy" below.

---

## 0. What is being copied

The **core spreadsheet**: cells + editing, formulas (incl. `=A1+B2` and custom functions),
cell/range/whole-column selection, fill handle, column merge, the query builder, column types
(number/decimal/currency/text/file/image), thumbnails, CSV/Excel/PDF export, formatting, and the
column drag/reorder. This is the thing piranha wants.

The table's styling has already been built against a **mirror of piranha's design tokens** (see
§3), so the visual language matches on arrival rather than needing a restyle.

---

## 1. Do NOT copy — jugaaadi-only, stays behind

These are excluded from the import. They are gated in the app behind the lazy `import(...)` +
template boundary, so a build that omits them still compiles.

Sourced from `src/piranhaExcluded.ts`:

- **`table-templates`** — `src/templates/`, `src/components/TemplateSelector.tsx`. The
  profile/template selector and its presets.
- **`interior-generator`** — `src/templates/interior.ts` (and future `src/templates/interior/*`).
  The interior sizes/images vertical.
- **`url-subdomain-template-routing`** — `src/templates/resolveTemplate.ts`. Loading a
  template/profile from the hostname subdomain (`interior.jugaaadi.com`) is a jugaaadi deployment
  concern; piranha mounts the table and chooses the template through its own props/routing.

Also do not copy: `src/piranhaExcluded.ts` itself, and this `copy_table.md`.

**Why they stay behind:** piranha wants a generic, reusable table. Profiles (cupboard, table, bed,
…), the interior generator, and subdomain routing are domain verticals layered *on top* of the
table for jugaaadi. Keeping them out of the import keeps piranha's copy clean and lets the vertical
evolve here without churning piranha.

---

## 2. Copy steps

1. Copy `src/` **except** the paths in §1 into piranha's table module directory.
2. Drop the local `tailwind.config.js` / `postcss.config.js` / `src/index.css` foundation — piranha
   already owns the real theme layer (`ui/src/theme/theme.json` + generated Tailwind config). The
   table's classes (`bg-white`, `border-slate-200`, `rounded-lg`, `accent-*`, `min-h-control`,
   `sm:hover:*`, `.btn-*`, `.icon-btn*`, `.input*`, `.eyebrow`) resolve against piranha's config
   identically — that is the whole point of §3.
3. Remove the lazy template selector wiring from `App.tsx` (the `import('./components/TemplateSelector')`
   boundary and the `resolveTemplate()` call). What remains is the plain table on the default schema.
4. Replace the `@emotion/*` and `twind` dev deps — already removed here; the table is Tailwind-native.

---

## 3. Why the styling "just works" on arrival

The table was restyled to piranha's rules (`F:\code\ai\piranha\ui\ui-rules.md`) using tokens that
mirror `theme.json`: the accent ramp (`#ff3b1d`), neutral scale, the hairline border remap
(`border-slate-200` → `#a9b8cb`), 36/44px control sizes, `text-micro`/`text-2xs`, font stacks, and
the standard motion curve/durations. Light theme is the default (§1); `accent-*` is identity/selection
only (§2); radius follows the 3-tier scale (§5); hover is `sm:hover:` gated (§6); the column drag
honors `prefers-reduced-motion` (§9).

---

## 3a. Vendored from piranha (do not duplicate)

To kill divergent copies of the popup/tooltip/alert primitives before the import, piranha's ACTUAL
component source is vendored into **`src/piranha/`** and used directly by the table. Each file
carries a header comment `// VENDORED VERBATIM FROM piranha ui/src/<path> …` and the imports were
flattened to resolve locally (`../theme/semanticColors` → `./semanticColors`, etc.). The originals:

| `src/piranha/*`        | piranha origin                                          |
| ---------------------- | ------------------------------------------------------- |
| `Tooltip.tsx`          | `ui/src/pages/tasks/components/Tooltip.tsx`             |
| `semanticColors.ts`    | `ui/src/theme/semanticColors.ts`                        |
| `SectionHeading.tsx`   | `ui/src/components/SectionHeading.tsx`                  |
| `Modal.tsx`            | `ui/src/components/Modal.tsx`                           |
| `ConfirmDialog.tsx`    | `ui/src/pages/tasks/components/ConfirmDialog.tsx`       |
| `ConfirmProvider.tsx`  | `ui/src/pages/tasks/components/ConfirmProvider.tsx` (`useConfirm`) |
| `Toast.tsx`            | `ui/src/pages/tasks/components/Toast.tsx` (`useToast`)  |
| `index.ts`             | barrel re-export (Tooltip, Modal, ConfirmProvider, useConfirm, ToastProvider, useToast) |

Wiring that now leans on the vendored set:

- **`src/main.tsx`** mounts `<MotionConfig reducedMotion="user"><ToastProvider><ConfirmProvider>`
  around `<App/>` — piranha's own provider contract (§9).
- **`src/components/Tooltip.tsx`** is now a thin re-export of `../piranha/Tooltip`; every importer
  (only `ActionsBar`) uses piranha's Tooltip unchanged.
- **`src/components/ActionsBar.tsx`** data-loss confirms go through `useConfirm()` (was a hand-rolled
  anchored popover).
- **`src/components/ShortcutsHelp.tsx`** renders inside piranha `Modal` (was a hand-rolled overlay).

**At import into piranha, do exactly this:**

1. **DELETE `src/piranha/`** entirely.
2. **Remove the semantic-token block** (`work`/`data`/…/`neutral` with `ink`/`subtle`/`border`) that
   was appended to `theme.extend.colors` in the local `tailwind.config.js` — piranha's real
   `theme.json` already defines those roles (and with the correct hues; the local block used
   standard-palette placeholders only so the class NAMES resolve here).
3. **Repoint imports** `../piranha/...` → piranha's real modules (Tooltip → `pages/tasks/components/Tooltip`,
   Modal → `components/Modal`, useConfirm → `pages/tasks/components/ConfirmProvider`, useToast →
   `pages/tasks/components/Toast`). The `src/components/Tooltip.tsx` re-export shim can be dropped and
   its importers pointed straight at piranha's Tooltip.
4. `framer-motion` + `lucide-react` (added to power the vendored components) become piranha's already-
   present dependencies — nothing to install.

> Note: piranha's `<Tooltip>` takes a single `label` string (no `explanation`/`shortcut`/`delay`), so
> the table's tooltips fold any key-cap hint into the label as `Label (Ctrl+X)`, matching piranha's
> own convention.

---

## 4. Import-time adaptations (do these in piranha, not here)

These are places where the standalone table approximates something piranha does better with its own
shared infrastructure. Swap them during/after the copy:

- **Native `title=` tooltips → piranha's `<Tooltip>`.** §11 bans native `title=` as a hover hint.
  The toolbar/cell delete buttons here carry `title=` (with `aria-label` alongside); in piranha wrap
  them in `Tooltip` and keep the `aria-label`.
- **Hand-rolled dropdowns/popovers → piranha shared components (§11).** The Columns/Merge/Functions
  dropdowns and the query-builder popover are self-contained here (no `Modal`/`SearchableAddMenu`
  existed to lean on). In piranha, migrate the searchable multi-selects onto `SearchableAddMenu`,
  any modal onto `Modal`, confirms onto `useConfirm()`, toasts onto `useToast()`, and async actions
  onto `AsyncButton` — inheriting Esc/backdrop/focus/z-index for free.
- **Motion → `<MotionConfig reducedMotion="user">` + `MotionTierProvider` (§9/§9a).** The table's
  motion already respects reduced-motion via CSS + the drag's own guard; once inside piranha it
  additionally inherits the app-wide motion tiers automatically.
- **Persistence.** The table uses `localStorage` for merges/functions/formatting/accordion state.
  Row data with uploaded images can exceed the ~5MB quota and blob URLs don't serialize — decide
  IndexedDB (data) + localStorage (settings) vs. accepting that uploaded images don't survive a
  reload. Open decision.

---

## 5. Verify after copy

- `npx tsc --noEmit` clean.
- `vite build` (or piranha's build) clean.
- Table renders styled with piranha's real theme; accent selection, hairline grid, light theme.
- None of the §1 excluded modules are referenced by the copied code (grep the copied tree for
  `templates/`, `TemplateSelector`, `resolveTemplate`).
