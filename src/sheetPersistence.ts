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
//
// VERSIONING. `version` is the payload's schema number, and it exists so a
// breaking change to what the bytes MEAN can be detected and repaired on load
// rather than silently mis-read. v1 -> v2 is exactly such a change: v1 formulas
// were written when A1 letters resolved against a frozen list of the demo
// schema's columns, so a `=C2` saved on a blank sheet meant `lastName` (a column
// that sheet does not have — worth 0), while today it would mean the sheet's own
// third column. `migrateLegacyA1Formulas` retranslates those references through
// the old mapping so a reloaded sheet shows the numbers it showed before.

import { migrateLegacyA1Formulas } from './formula'
import { dataColumnIdsFromDefs } from './columnOrder'

const KEY = 'tt.customSheet.v1'

// Bumped whenever the meaning of a stored payload changes. The storage KEY is
// deliberately NOT bumped with it — an old sheet has to be found before it can
// be migrated.
export const SHEET_VERSION = 2

export type PersistedSheet = {
  version: typeof SHEET_VERSION
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
    const version = parsed.version
    if (version !== 1 && version !== SHEET_VERSION) return null
    if (!Array.isArray(parsed.customColumns) || !Array.isArray(parsed.data)) {
      return null
    }
    let formulas: Record<string, string> = {}
    if (isObject(parsed.formulas)) {
      for (const [k, v] of Object.entries(parsed.formulas)) {
        if (typeof v === 'string') formulas[k] = v
      }
    }

    // A v1 sheet's A1 references were bound to the old frozen letter space, not
    // to this sheet's own columns. Retranslate them against the schema saved
    // alongside them — that list IS this sheet's letter space — so every stored
    // formula keeps the value it had before the space went live.
    if (version === 1) {
      formulas = migrateLegacyA1Formulas(
        formulas,
        dataColumnIdsFromDefs(parsed.customColumns),
      )
    }

    return {
      version: SHEET_VERSION,
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
      JSON.stringify({
        version: SHEET_VERSION,
        ...sheet,
      } satisfies PersistedSheet),
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
