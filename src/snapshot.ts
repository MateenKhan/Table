// ─────────────────────────────────────────────────────────────────────────────
// snapshot.ts — the shareable VIEW.
//
// An `AppSnapshot` is a plain, JSON-serialisable capture of the whole grid: the
// rows (including computed values), the formula sources, every formatting /
// column-type override, the active query, the TanStack table layout state and
// the column merges. App.tsx gathers the live state and hands a finished object
// to these helpers — this module never reaches into app state itself; it only
// serialises, downloads, shares and re-reads snapshots.
//
// Three ways a snapshot moves between machines:
//   • .json download  — the lossless, always-works path (downloadSnapshotJson).
//   • .html share page — a tiny standalone doc that, when opened, redirects to
//     the app with the snapshot packed into the URL hash (downloadShareHtml).
//   • URL hash on load — readSharedSnapshotFromUrl() decodes that hash so the
//     app can import the view the moment the shared page hands it over.
//
// SERIALISATION CAVEATS (by design, documented for callers):
//   • Uploaded images kept as `blob:` object URLs are session-scoped — those
//     URLs do NOT survive serialisation and will be dead on another machine.
//     Values stored as data: URLs or plain text round-trip fine.
//   • The share-HTML path packs the snapshot into a URL hash, which browsers
//     cap (roughly a couple of MB, less in practice). Large tables can exceed
//     that: the .json download always works; the .html link is best-effort for
//     reasonably sized views.
// ─────────────────────────────────────────────────────────────────────────────

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

export type AppSnapshot = {
  version: 1
  data: Record<string, unknown>[] // the rows (incl. computed values)
  formulas: Record<string, string> // formula sources by "row:col"
  formatting: Record<string, unknown> // tableFormatting.snapshot()
  columnTypes: Record<string, unknown> // columnTypeOverrides.snapshot()
  query: unknown // GlobalSearchValue
  tableState: unknown // { columnOrder, columnSizing, columnPinning, columnVisibility, rowPinning }
  merges: unknown[] // ColumnMerge[]
  // A user's blank-sheet schema (generic `col1..colN` defs), if they wiped the
  // built-in columns with Delete-all. Absent → the built-in / profile schema.
  customColumns?: unknown[] // ColumnDef[]
}

/* ------------------------------------------------------------------ app url */

/**
 * The public origin a shared view should open against. `VITE_APP_URL` when set
 * (a real deployed URL), otherwise the current origin — so a share made on
 * `localhost:PORT` today opens locally, and the very same code opens the live
 * site once `VITE_APP_URL` is configured for the deploy.
 */
export function getAppUrl(): string {
  const fromEnv = import.meta.env.VITE_APP_URL
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return typeof window !== 'undefined' ? window.location.origin : ''
}

/* --------------------------------------------------------------- validation */

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Structurally validate an arbitrary parsed value into an `AppSnapshot`, or
 * `null` when it is not one. Never throws — every entry point that reads foreign
 * bytes (a pasted URL, a picked file) funnels through here so malformed input
 * degrades to "nothing imported" rather than a crash. Missing-but-optional maps
 * are defaulted so a hand-trimmed snapshot still loads.
 */
function validateSnapshot(input: unknown): AppSnapshot | null {
  if (!isObject(input)) return null
  if (input.version !== 1) return null
  if (!Array.isArray(input.data)) return null

  const data = input.data.filter(isObject) as Record<string, unknown>[]

  const formulas: Record<string, string> = {}
  if (isObject(input.formulas)) {
    for (const [k, v] of Object.entries(input.formulas)) {
      if (typeof v === 'string') formulas[k] = v
    }
  }

  const formatting = isObject(input.formatting) ? input.formatting : {}
  const columnTypes = isObject(input.columnTypes) ? input.columnTypes : {}
  const merges = Array.isArray(input.merges) ? input.merges : []
  const customColumns = Array.isArray(input.customColumns)
    ? input.customColumns
    : undefined

  return {
    version: 1,
    data,
    formulas,
    formatting,
    columnTypes,
    query: input.query ?? null,
    tableState: input.tableState ?? null,
    merges,
    ...(customColumns ? { customColumns } : {}),
  }
}

/**
 * Parse + validate the text of a picked `.json` file into a snapshot, or `null`.
 * Never throws — the file picker path relies on that.
 */
export function parseSnapshotFile(text: string): AppSnapshot | null {
  try {
    return validateSnapshot(JSON.parse(text))
  } catch {
    return null
  }
}

/* ----------------------------------------------------------------- download */

// Trigger a browser download of `blob` under `filename` via a transient anchor.
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has certainly been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// A filesystem-safe base name (no extension) — collapses anything awkward to '-'.
function safeBaseName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
  return cleaned || fallback
}

/** Download the snapshot as a pretty-printed `.json` file. The lossless path. */
export function downloadSnapshotJson(snapshot: AppSnapshot, filename?: string): void {
  const name = safeBaseName(filename ?? '', 'table-view') + '.json'
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: 'application/json',
  })
  triggerDownload(blob, name)
}

/* --------------------------------------------------------------- share page */

/**
 * Build a standalone HTML document that, when opened, immediately redirects to
 * `${appUrl}#view=<compressed-snapshot>` — so double-clicking the saved file
 * opens the app and loads this exact view. The snapshot is JSON-stringified then
 * `lz-string`-compressed into a URL-safe token, keeping the hash as small as the
 * data allows. A visible "Opening shared view…" body plus a manual link cover
 * the case where the auto-redirect is blocked.
 */
export function buildShareHtml(snapshot: AppSnapshot, appUrl: string): string {
  const payload = compressToEncodedURIComponent(JSON.stringify(snapshot))
  const target = `${appUrl}#view=${payload}`
  // Escape for safe embedding in an HTML attribute / text node.
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const href = escapeHtml(target)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Opening shared view…</title>
<meta http-equiv="refresh" content="0; url=${href}" />
<style>
  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background:#f8fafc; color:#0f172a; display:flex; min-height:100vh;
    align-items:center; justify-content:center; }
  .card { text-align:center; padding:2rem; }
  a { color:#2563eb; font-weight:600; word-break:break-all; }
  .muted { color:#64748b; font-size:14px; margin-top:.5rem; }
</style>
<script>
  // Best-effort auto-redirect; the <meta refresh> above is the no-JS fallback.
  window.location.replace(${JSON.stringify(target)});
</script>
</head>
<body>
  <div class="card">
    <p>Opening shared view…</p>
    <p class="muted">If nothing happens, <a href="${href}">open it here</a>.</p>
  </div>
</body>
</html>`
}

/**
 * Download the share page as `<name>.html`. Double-clicking the saved file opens
 * `appUrl` and loads the packed view. Best-effort for reasonably sized views —
 * see the URL-hash caveat at the top of this file.
 */
export function downloadShareHtml(
  snapshot: AppSnapshot,
  appUrl: string,
  filename?: string,
): void {
  const name = safeBaseName(filename ?? '', 'table-view') + '.html'
  const blob = new Blob([buildShareHtml(snapshot, appUrl)], {
    type: 'text/html',
  })
  triggerDownload(blob, name)
}

/* -------------------------------------------------------- read from the URL */

/**
 * Read a shared snapshot out of `location.hash`. If the hash begins `#view=`,
 * decompress + JSON.parse + validate the remainder, then CLEAR the hash (via
 * `history.replaceState`) so a refresh doesn't re-import the same view. Returns
 * the snapshot on success, or `null` for a missing/malformed/foreign hash.
 * Never throws — App calls this once on load.
 */
export function readSharedSnapshotFromUrl(): AppSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const hash = window.location.hash || ''
    const prefix = '#view='
    if (!hash.startsWith(prefix)) return null

    const token = hash.slice(prefix.length)
    // Clear the hash regardless of outcome: a bad token shouldn't stick around
    // and re-fail on every refresh.
    clearViewHash()
    if (!token) return null

    const json = decompressFromEncodedURIComponent(token)
    if (!json) return null
    return validateSnapshot(JSON.parse(json))
  } catch {
    return null
  }
}

// Strip the #view= fragment without adding a history entry or reloading.
function clearViewHash(): void {
  try {
    const { pathname, search } = window.location
    window.history.replaceState(null, '', pathname + search)
  } catch {
    /* replaceState unavailable (very old / sandboxed) — leave the hash be. */
  }
}

/**
 * Extract a snapshot from the text of a picked `.html` share page (best-effort):
 * find the `#view=` token embedded in it, decompress + validate. Returns `null`
 * when the file carries no recognisable payload. `.json` remains the primary
 * import path; this exists so a saved share page can also be re-imported.
 */
export function parseShareHtml(text: string): AppSnapshot | null {
  try {
    const match = text.match(/#view=([A-Za-z0-9+\-_/=$.!~*'()%]+)/)
    if (!match) return null
    const json = decompressFromEncodedURIComponent(match[1])
    if (!json) return null
    return validateSnapshot(JSON.parse(json))
  } catch {
    return null
  }
}
