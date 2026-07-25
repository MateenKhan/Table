// Persistence for a USER'S OWN sheet — the blank sheet they get after Delete-all
// and fill with their own data. Only the custom (user-authored) schema is saved;
// the built-in demo / profile data is deliberately NOT persisted, so a plain
// reload re-seeds the demo (that data is a sample, not the user's) while a sheet
// the user actually built survives reloads.
//
// Per-cell formatting and column-type overrides already persist through their own
// stores, so this module only needs the three things that live in App state:
// the rows, the custom column definitions, and the formula sources.
//
// Kept tiny and defensive: any parse / quota error degrades to "no saved sheet"
// rather than throwing into React.

const KEY = 'tt.customSheet.v1'

export type PersistedSheet = {
  version: 1
  // Column defs are plain, JSON-safe blank-sheet columns (id / accessorKey /
  // string header / meta), never render functions — safe to serialise.
  customColumns: unknown[]
  data: unknown[]
  formulas: Record<string, string>
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** The saved user sheet, or `null` when there is none / it is unreadable. */
export function loadCustomSheet(): PersistedSheet | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return null
    if (parsed.version !== 1) return null
    if (!Array.isArray(parsed.customColumns) || !Array.isArray(parsed.data)) {
      return null
    }
    const formulas: Record<string, string> = {}
    if (isObject(parsed.formulas)) {
      for (const [k, v] of Object.entries(parsed.formulas)) {
        if (typeof v === 'string') formulas[k] = v
      }
    }
    return {
      version: 1,
      customColumns: parsed.customColumns,
      data: parsed.data,
      formulas,
    }
  } catch {
    return null
  }
}

/** Write the user's sheet. Quota / serialisation failures are swallowed. */
export function saveCustomSheet(sheet: Omit<PersistedSheet, 'version'>): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, ...sheet } satisfies PersistedSheet),
    )
  } catch {
    /* out of quota or non-serialisable — drop silently */
  }
}

/** Forget any saved user sheet (used by Restore, which returns to the demo). */
export function clearCustomSheet(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
