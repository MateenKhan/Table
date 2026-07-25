import { RowData } from '@tanstack/react-table'
import { format as formatDate, parse as parseDate, parseISO, isValid } from 'date-fns'

// The column type system. Every column declares what kind of value it holds
// through TanStack's `meta`, and that single declaration drives formatting,
// alignment, which editor is used and what the editor will accept.
export type ColumnType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'currency'
  | 'file'
  | 'image'
  | 'date'
  | 'datetime'
  | 'mixed'

export type TypeOptions = {
  type?: ColumnType
  // `decimal` / `currency`: digits kept after the decimal point.
  decimals?: number
  // `currency`: ISO 4217 code handed to Intl.NumberFormat.
  currency?: string
  // Locale used for every Intl formatter on the column.
  locale?: string
  // Appended to the formatted value, e.g. '%'.
  suffix?: string
  // `file` / `image`: the file picker's `accept` attribute.
  accept?: string
  // `date` / `datetime`: a date-fns format string. Defaults to 'yyyy-MM-dd'
  // for `date` and 'yyyy-MM-dd HH:mm' for `datetime`.
  dateFormat?: string
  // `mixed`: which kinds of content the column will accept. The logic layer
  // only stringifies mixed values; the UI decides how to render each kind.
  acceptedTypes?: ColumnType[]
}

// The default date-fns format string for a date-ish type.
export const defaultDateFormat = (type?: ColumnType): string =>
  type === 'datetime' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'

// Module augmentation is the idiomatic extension point - it keeps `meta`
// strongly typed everywhere `columnDef.meta` is read.
declare module '@tanstack/react-table' {
  // TData / TValue are unused here but must match the original declaration.
  interface ColumnMeta<TData extends RowData, TValue> extends TypeOptions {}
}

export const isNumericType = (type?: ColumnType) =>
  type === 'number' || type === 'decimal' || type === 'currency'

export const isAttachmentType = (type?: ColumnType) =>
  type === 'file' || type === 'image'

// `date` and `datetime` share the same parse/format machinery; the only
// difference is the default format string (see `defaultDateFormat`).
export const isDateType = (type?: ColumnType) =>
  type === 'date' || type === 'datetime'

export const alignmentFor = (type?: ColumnType) =>
  isNumericType(type) ? 'right' : 'left'

// Default decimal places per type, so a column only has to spell out `decimals`
// when it wants something other than the obvious.
const defaultDecimals = (options?: TypeOptions) =>
  options?.decimals ?? (options?.type === 'currency' ? 2 : 1)

// Intl.NumberFormat construction is expensive and these cells re-render a lot.
const formatters = new Map<string, Intl.NumberFormat>()

const getFormatter = (locale: string, options: Intl.NumberFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options)
    formatters.set(key, formatter)
  }
  return formatter
}

/**
 * What the cell shows when it is not being edited. Anything that is not a
 * finite number (blank cells, `#ERROR` from the formula engine, stray text) is
 * passed through untouched rather than turning into `NaN`.
 */
// Coerce a stored date value (ISO string or millisecond timestamp) into a
// `Date`, or `null` when it is not a usable instant. Kept tolerant on purpose:
// the store may hold ISO dates, full ISO datetimes or raw numbers.
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return isValid(value) ? value : null
  if (typeof value === 'number') {
    const fromNumber = new Date(value)
    return isValid(fromNumber) ? fromNumber : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const iso = parseISO(text)
  if (isValid(iso)) return iso
  const loose = new Date(text)
  return isValid(loose) ? loose : null
}

export function formatCellValue(
  value: unknown,
  options?: TypeOptions,
): string {
  if (value === null || value === undefined || value === '') return ''

  const type = options?.type

  if (isDateType(type)) {
    const date = toDate(value)
    if (!date) return ''
    try {
      return formatDate(date, options?.dateFormat ?? defaultDateFormat(type))
    } catch {
      // A malformed custom format string must never crash a cell render.
      return ''
    }
  }

  // The logic layer just stringifies mixed content; the UI renders images /
  // files from the underlying value however it likes.
  if (type === 'mixed') return String(value ?? '')

  if (!isNumericType(type)) return String(value)

  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) return String(value)

  const locale = options?.locale ?? 'en-US'
  const suffix = options?.suffix ?? ''

  if (type === 'number') {
    return (
      getFormatter(locale, { maximumFractionDigits: 0 }).format(Math.trunc(n)) +
      suffix
    )
  }

  const decimals = defaultDecimals(options)

  if (type === 'currency') {
    return (
      getFormatter(locale, {
        style: 'currency',
        currency: options?.currency ?? 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n) + suffix
    )
  }

  return (
    getFormatter(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n) + suffix
  )
}

/**
 * Is `text` a legal intermediate state for this column's editor? Formulas are
 * always allowed - they are typed into any column and evaluate to a number.
 */
export function acceptsInput(text: string, type?: ColumnType): boolean {
  if (isDateType(type)) {
    if (text === '' || text.startsWith('=')) return true
    // Date-ish characters only: digits and the usual date / time separators.
    return /^[0-9\-/:.\sT]*$/.test(text)
  }
  // `mixed` (and every other non-numeric type) accepts anything.
  if (!isNumericType(type)) return true
  if (text.startsWith('=')) return true
  if (text === '' || text === '-' || text === '+') return true
  return type === 'number'
    ? /^[-+]?\d+$/.test(text)
    : /^[-+]?\d*\.?\d*$/.test(text)
}

/**
 * Turn what the user typed into the value stored in `data`. Numeric columns
 * keep real numbers so sorting, filtering and formulas keep working; untyped
 * columns fall back to the older "stay a number if you already were one" rule.
 */
export function parseTypedValue(
  raw: string,
  options: TypeOptions | undefined,
  previous: unknown,
): unknown {
  const type = options?.type
  const text = raw.trim()

  // `mixed` keeps whatever the user typed verbatim — the UI owns interpretation.
  if (type === 'mixed') return raw

  if (isDateType(type)) {
    if (!text) return ''
    // Try, in order: a full ISO string, the column's own display format, then
    // the permissive native parser. Whatever wins is normalised so sorting and
    // filtering compare like-for-like.
    let date = parseISO(text)
    if (!isValid(date)) {
      try {
        date = parseDate(text, options?.dateFormat ?? defaultDateFormat(type), new Date())
      } catch {
        // A bad format string just falls through to the native parser below.
      }
    }
    if (!isValid(date)) date = new Date(text)
    if (!isValid(date)) return previous ?? ''
    // `date` stores a date-only ISO ('yyyy-MM-dd'); `datetime` a full instant.
    return type === 'datetime' ? date.toISOString() : formatDate(date, 'yyyy-MM-dd')
  }

  if (!isNumericType(type)) {
    if (typeof previous !== 'number') return raw
    if (!text) return raw
    const n = Number(text)
    return Number.isNaN(n) ? raw : n
  }

  if (!text) return ''

  // Tolerate pasted currency symbols, thousands separators and spaces.
  const cleaned = text.replace(/[^0-9.eE+-]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return raw

  if (type === 'number') return Math.trunc(n)
  return Number(n.toFixed(defaultDecimals(options)))
}
