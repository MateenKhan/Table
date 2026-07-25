import { Column, RowData, SortingState, Table } from '@tanstack/react-table'
import React from 'react'
import { Check, X, Server } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import {
  buildCommonSuggestions,
  canRuleOnType,
  Combinator,
  CommonSuggestion,
  emptyGlobalSearch,
  GlobalSearchValue,
  invalidRuleReason,
  isGlobalSearchEmpty,
  matchScore,
  newRule,
  operandCount,
  operatorLabel,
  operatorsForType,
  QueryRule,
  RuleOperator,
  selectTopN,
} from '../globalSearch'
import { ColumnType, formatCellValue, isNumericType } from '../columnTypes'

// Faceted value lists can be huge (1000 distinct full names), so never scan or
// offer more than this many at once.
const FACET_SCAN_CAP = 400
const MAX_SUGGESTIONS = 50

type Props<T extends RowData> = {
  table: Table<T>
  value: GlobalSearchValue
  onChange: (value: GlobalSearchValue) => void
  // Called after a successful Apply / Enter-to-run on a valid query. The parent
  // uses it to, e.g., collapse the query accordion. Optional and defaulted off.
  onApply?: () => void
}

// The builder is a small three-stage machine. `stage` is derived from how much
// of the in-progress draft is filled in, so there is a single source of truth.
type Stage = 'column' | 'operator' | 'value'

type Draft = {
  columnId?: string
  operator?: RuleOperator
  // First operand, kept while the second is collected for a `between` rule.
  value?: string
}

type OptKind = 'common' | 'column' | 'operator' | 'value' | 'typed'

// One row of the dropdown listbox, whatever stage produced it. `id` is the raw
// thing committed (a column id, operator id, value string, or shortcut id);
// `label` is what the user reads; `meta` is the muted right-hand hint/count.
type Option = { kind: OptKind; id: string; label: string; meta?: string }

type Message = { tone: 'error' | 'ok' | 'info'; text: string }

// A column's header can be a string or a render function; only the string kind
// is safe to read without a header context, so anything else is humanised from
// the column id (`firstName` -> `First Name`).
function columnLabel(column: Column<any, unknown>): string {
  const header = column.columnDef.header
  if (typeof header === 'string' && header.trim()) return header
  const spaced = column.id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : column.id
}

// Filter to matches and order by match quality, so the *best* match sits at the
// top and becomes the highlighted, commit-on-Tab option.
function filterRank(options: Option[], needle: string): Option[] {
  if (!needle) return options
  const scored: { option: Option; score: number }[] = []
  for (const option of options) {
    const score = Math.max(
      matchScore(option.label, needle),
      matchScore(option.id, needle),
    )
    if (score >= 0) scored.push({ option, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.map((entry) => entry.option)
}

const LISTBOX_ID = 'global-search-listbox'

const sectionLabel = (kind: OptKind): string =>
  kind === 'common'
    ? 'Suggestions'
    : kind === 'column'
      ? 'Columns'
      : kind === 'operator'
        ? 'Conditions'
        : 'Values'

export function GlobalSearch<T extends RowData>({
  table,
  value,
  onChange,
  onApply,
}: Props<T>) {
  const [draft, setDraft] = React.useState<Draft>({})
  const [query, setQuery] = React.useState('')
  // The Apply / Clear / Server actions only make sense when the field is focused
  // and there is something to act on — otherwise they're hidden.
  const [focused, setFocused] = React.useState(false)
  const [highlight, setHighlight] = React.useState(0)
  const [arrowed, setArrowed] = React.useState(false)
  const [isOpen, setIsOpen] = React.useState(false)
  const [message, setMessage] = React.useState<Message | null>(null)

  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // The floating suggestions popover and the off-screen span used to measure
  // where the text caret sits inside the live input.
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const mirrorRef = React.useRef<HTMLSpanElement | null>(null)
  const [popoverPos, setPopoverPos] = React.useState<{
    left: number
    top: number
  } | null>(null)

  const rules = value.rules ?? []
  const combinator: Combinator = value.combinator === 'or' ? 'or' : 'and'

  // Only columns that can actually be queried: attachment/opaque columns and the
  // selection column are dropped, exactly as the rule engine ignores them.
  const ruleColumns = table
    .getAllLeafColumns()
    .filter(
      (column) =>
        column.id !== 'select' &&
        column.getCanGlobalFilter() &&
        canRuleOnType(column.columnDef.meta?.type),
    )
  const ruleColumnsKey = ruleColumns.map((column) => column.id).join('|')

  const typeOf = (columnId?: string): ColumnType | undefined =>
    columnId ? table.getColumn(columnId)?.columnDef.meta?.type : undefined

  const draftType = typeOf(draft.columnId)
  const draftColumn = draft.columnId ? table.getColumn(draft.columnId) : undefined

  const stage: Stage = !draft.columnId
    ? 'column'
    : !draft.operator
      ? 'operator'
      : 'value'

  // In a `between` rule the value stage runs twice; the second pass is in play
  // once the first bound is committed.
  const collectingSecond =
    stage === 'value' &&
    draft.operator === 'between' &&
    draft.value !== undefined

  const needleRaw = query.trim()
  const clearMessage = () => setMessage(null)

  // Kept fresh so the merged-away cleanup effect never closes over a stale value.
  const latest = React.useRef({ value, onChange })
  latest.current = { value, onChange }

  /* ---------------------------------------------------- schema-driven data */

  // Common "Top N" shortcuts are built from the column *schema* (headers + types)
  // and never from a single data value, so they stay correct as the data shifts.
  const schemaKey = ruleColumns
    .map(
      (column) =>
        `${column.id}:${columnLabel(column)}:${column.columnDef.meta?.type ?? ''}`,
    )
    .join('|')
  const commonSuggestions = React.useMemo<CommonSuggestion[]>(
    () =>
      buildCommonSuggestions(
        ruleColumns.map((column) => ({
          columnId: column.id,
          header: columnLabel(column),
          type: column.columnDef.meta?.type,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaKey],
  )

  // Facets shift as upstream filters change; row count is a cheap proxy.
  const rowCount = table.getPreFilteredRowModel().rows.length
  const filteredCount = table.getFilteredRowModel().rows.length

  const facetRaw = React.useMemo<{ value: string; count: number }[]>(() => {
    if (!draftColumn) return []
    const out: { value: string; count: number }[] = []
    for (const [raw, count] of draftColumn.getFacetedUniqueValues()) {
      if (raw === null || raw === undefined) continue
      const candidate = String(raw)
      if (!candidate.trim()) continue
      out.push({ value: candidate, count })
      if (out.length >= FACET_SCAN_CAP) break
    }
    out.sort((a, b) => b.count - a.count)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.columnId, rowCount])

  /* ------------------------------------------- assemble the visible options */

  const commonOptions: Option[] = commonSuggestions.map((suggestion) => ({
    kind: 'common',
    id: suggestion.id,
    label: suggestion.label,
    meta: suggestion.kind === 'top' ? 'highest' : 'lowest',
  }))

  const columnOptionsAll: Option[] = ruleColumns.map((column) => ({
    kind: 'column',
    id: column.id,
    label: columnLabel(column),
    meta: column.columnDef.meta?.type,
  }))

  const operatorOptionsAll: Option[] = operatorsForType(draftType).map((def) => ({
    kind: 'operator',
    id: def.id,
    label: def.label,
    meta:
      def.operands === 0
        ? 'no value'
        : def.operands === 2
          ? 'two values'
          : undefined,
  }))

  const facetOptions: Option[] = facetRaw.map((entry) => ({
    kind: 'value',
    id: entry.value,
    label: entry.value,
    meta: String(entry.count),
  }))

  // Common shortcuts show only when focused and idle (empty input) *and* the
  // current query is either empty or actually returning rows — never mid-typing
  // a token, and never on a dead (zero-result) query.
  const showCommon =
    isOpen &&
    stage === 'column' &&
    needleRaw === '' &&
    commonOptions.length > 0 &&
    (isGlobalSearchEmpty(value) || filteredCount > 0)

  let visibleOptions: Option[] = []
  if (stage === 'column') {
    visibleOptions = needleRaw
      ? filterRank(columnOptionsAll, needleRaw)
      : showCommon
        ? [...commonOptions, ...columnOptionsAll]
        : columnOptionsAll
  } else if (stage === 'operator') {
    visibleOptions = needleRaw
      ? filterRank(operatorOptionsAll, needleRaw)
      : operatorOptionsAll
  } else {
    const facets = (needleRaw ? filterRank(facetOptions, needleRaw) : facetOptions)
      .filter((option) => option.label.toLowerCase() !== needleRaw.toLowerCase())
      .slice(0, MAX_SUGGESTIONS)
    const typed: Option[] = needleRaw
      ? [{ kind: 'typed', id: '__typed__', label: needleRaw, meta: 'use this value' }]
      : []
    visibleOptions = [...typed, ...facets]
  }

  // Best-match highlight: on while the user is typing or has arrowed into the
  // list, off while idle (so Enter on an empty input runs the query instead).
  const showHighlight = arrowed || needleRaw !== ''
  const clampedHighlight = visibleOptions.length
    ? Math.min(highlight, visibleOptions.length - 1)
    : -1
  const effectiveHighlight = showHighlight ? clampedHighlight : -1
  const activeOption =
    effectiveHighlight >= 0 ? visibleOptions[effectiveHighlight] : undefined
  const activeId = activeOption
    ? `${LISTBOX_ID}-opt-${effectiveHighlight}`
    : undefined

  // Reset the highlight whenever the stage/token changes so it lands on the new
  // best match rather than a stale index.
  React.useEffect(() => {
    setHighlight(0)
    setArrowed(false)
  }, [stage, needleRaw, draft.columnId, draft.operator, showCommon])

  /* ------------------------------------------------------ merged-away cleanup */

  // A merged-away column keeps its id in a rule (or the limit) but no longer
  // exists on the table; drop those so nothing filters against a ghost column.
  React.useEffect(() => {
    const live = new Set(ruleColumnsKey ? ruleColumnsKey.split('|') : [])
    const { value: current, onChange: commit } = latest.current
    const keptRules = (current.rules ?? []).filter(
      (rule) => !rule.columnId || live.has(rule.columnId),
    )
    const limitGone = !!current.limit && !live.has(current.limit.columnId)
    if (keptRules.length !== (current.rules ?? []).length || limitGone) {
      commit({
        ...current,
        rules: keptRules,
        limit: limitGone ? null : current.limit,
      })
    }
  }, [ruleColumnsKey])

  /* -------------------------------------- apply the Top N limit to the table */

  // The limit is a *view*: sort the table by the column and page it to N. This
  // is native TanStack, tie-safe, and stays live as the data changes (unlike a
  // baked threshold). The previous sort/page-size is captured so removing the
  // limit restores it.
  const limitKey = value.limit
    ? `${value.limit.dir}:${value.limit.columnId}:${value.limit.n}`
    : ''
  const appliedLimitRef = React.useRef('')
  const prevViewRef = React.useRef<{
    sorting: SortingState
    pageSize: number
  } | null>(null)

  React.useEffect(() => {
    if (appliedLimitRef.current === limitKey) return
    const hadLimit = appliedLimitRef.current !== ''
    if (value.limit) {
      if (!hadLimit) {
        const state = table.getState()
        prevViewRef.current = {
          sorting: state.sorting,
          pageSize: state.pagination.pageSize,
        }
      }
      table.setSorting([
        { id: value.limit.columnId, desc: value.limit.dir === 'top' },
      ])
      table.setPageSize(value.limit.n)
      table.setPageIndex(0)
    } else {
      const prev = prevViewRef.current
      table.setSorting(prev?.sorting ?? [])
      table.setPageSize(prev?.pageSize ?? 10)
      table.setPageIndex(0)
      prevViewRef.current = null
    }
    appliedLimitRef.current = limitKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitKey])

  // Display-only ranking of the currently visible rows, so the limit chip can
  // show how many rows survive and the boundary value (e.g. `≥ $85,000`).
  let limitInfo: { count: number; threshold: string | null } | null = null
  if (value.limit) {
    const column = table.getColumn(value.limit.columnId)
    if (column) {
      const values = table.getFilteredRowModel().rows.map((row) => {
        const raw = row.getValue(value.limit!.columnId)
        return typeof raw === 'number' ? raw : Number(raw)
      })
      const { indices, threshold } = selectTopN(
        values,
        value.limit.n,
        value.limit.dir,
      )
      limitInfo = {
        count: indices.length,
        threshold:
          threshold === null
            ? null
            : formatCellValue(threshold, column.columnDef.meta),
      }
    }
  }

  /* -------------------------------------------------------- outside dismiss */

  React.useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [isOpen])

  /* ------------------------------------------ caret-anchored popover geometry */

  // Measure how far the text caret sits from the input's left content edge by
  // mirroring the input's font into an off-screen span and setting its text to
  // everything up to `selectionStart`; the span's width is the caret offset.
  const measureCaretOffset = (input: HTMLInputElement): number => {
    let mirror = mirrorRef.current
    if (!mirror) {
      mirror = document.createElement('span')
      mirror.setAttribute('aria-hidden', 'true')
      document.body.appendChild(mirror)
      mirrorRef.current = mirror
    }
    const style = getComputedStyle(input)
    const s = mirror.style
    s.position = 'fixed'
    s.top = '0'
    s.left = '0'
    s.visibility = 'hidden'
    s.whiteSpace = 'pre'
    s.pointerEvents = 'none'
    s.font = style.font
    s.letterSpacing = style.letterSpacing
    s.textTransform = style.textTransform
    const caret = input.selectionStart ?? input.value.length
    mirror.textContent = input.value.slice(0, caret)
    return mirror.offsetWidth
  }

  // Anchor the popover's left edge at the caret and its top just below the
  // input, then clamp to the viewport so it never overflows right/bottom.
  const recomputePosition = React.useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const caretOffset = measureCaretOffset(input)
    const pop = popoverRef.current
    const popW = pop?.offsetWidth ?? 0
    const popH = pop?.offsetHeight ?? 0
    const margin = 8
    let left = rect.left + Math.min(caretOffset, rect.width)
    let top = rect.bottom + 4
    // Flip/clamp horizontally so the content-sized box stays on screen.
    if (left + popW > window.innerWidth - margin) {
      left = window.innerWidth - popW - margin
    }
    if (left < margin) left = margin
    // If it would spill past the bottom, flip above the input when there's room.
    if (top + popH > window.innerHeight - margin) {
      const above = rect.top - popH - 4
      top = above >= margin ? above : Math.max(margin, window.innerHeight - popH - margin)
    }
    setPopoverPos({ left, top })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute before paint whenever the popover opens or its anchor/content
  // could have shifted (typing, stage change, option count change).
  React.useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverPos(null)
      return
    }
    recomputePosition()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, query, stage, draft.columnId, draft.operator, visibleOptions.length])

  // Keep it pinned to the caret as the page/window moves while open.
  React.useEffect(() => {
    if (!isOpen) return
    const handler = () => recomputePosition()
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [isOpen, recomputePosition])

  // Tidy the measurement span when the component goes away.
  React.useEffect(
    () => () => {
      mirrorRef.current?.remove()
      mirrorRef.current = null
    },
    [],
  )

  /* --------------------------------------------------------- connectors */

  // The per-gap connectors normalised to exactly `rules.length - 1` entries,
  // filling any hole with the legacy shared combinator. This is the array the
  // inline toggles read and write.
  const gapConnectors = (): Combinator[] => {
    const base = value.connectors ?? []
    const out: Combinator[] = []
    for (let i = 0; i < Math.max(0, rules.length - 1); i++) {
      const c = base[i]
      out.push(c === 'or' || c === 'and' ? c : combinator)
    }
    return out
  }

  const setConnector = (gapIndex: number, next: Combinator) => {
    const connectors = gapConnectors()
    if (connectors[gapIndex] === next) return
    connectors[gapIndex] = next
    onChange({ ...value, connectors })
  }

  // Remove the rule at `index` and the connector that went with it, keeping the
  // array `newRuleCount - 1` long so gaps and connectors never desync.
  const rulesConnectorsAfterRemoval = (index: number) => {
    const nextRules = rules.filter((_, i) => i !== index)
    const connectors = gapConnectors()
    const dropAt = index === 0 ? 0 : index - 1
    const nextConnectors = connectors
      .filter((_, i) => i !== dropAt)
      .slice(0, Math.max(0, nextRules.length - 1))
    return { nextRules, nextConnectors }
  }

  /* ----------------------------------------------------------- committing */

  const pushRule = (
    columnId: string,
    operator: RuleOperator,
    val = '',
    val2 = '',
  ) => {
    const rule: QueryRule = {
      ...newRule(),
      columnId,
      operator,
      value: val,
      value2: val2,
    }
    const nextRules = [...(value.rules ?? []), rule]
    // A brand-new gap defaults to the shared combinator.
    const nextConnectors =
      nextRules.length >= 2
        ? [...gapConnectors(), combinator]
        : value.connectors ?? []
    onChange({ ...value, rules: nextRules, connectors: nextConnectors })
  }

  const resetToColumn = () => {
    setDraft({})
    setQuery('')
  }

  const commitColumn = (columnId: string) => {
    clearMessage()
    setDraft({ columnId })
    setQuery('')
  }

  const commitOperator = (operator: RuleOperator) => {
    clearMessage()
    if (operandCount(operator) === 0) {
      if (draft.columnId) pushRule(draft.columnId, operator)
      resetToColumn()
    } else {
      setDraft((d) => ({ ...d, operator }))
      setQuery('')
    }
  }

  const commitValue = (raw: string) => {
    const v = raw.trim()
    if (!v || !draft.columnId || !draft.operator) return
    clearMessage()
    if (draft.operator === 'between') {
      if (draft.value === undefined) {
        setDraft((d) => ({ ...d, value: v }))
        setQuery('')
      } else {
        pushRule(draft.columnId, 'between', draft.value, v)
        resetToColumn()
      }
    } else {
      pushRule(draft.columnId, draft.operator, v)
      resetToColumn()
    }
  }

  const applyLimit = (suggestion: CommonSuggestion) => {
    onChange({
      ...value,
      limit: {
        columnId: suggestion.columnId,
        dir: suggestion.kind,
        n: suggestion.n,
      },
    })
    setDraft({})
    setQuery('')
    setMessage({
      tone: 'info',
      text: `${suggestion.label} — sorted and limited to ${suggestion.n} rows.`,
    })
  }

  const commitOption = (option: Option) => {
    if (option.kind === 'common') {
      const suggestion = commonSuggestions.find((s) => s.id === option.id)
      if (suggestion) applyLimit(suggestion)
    } else if (option.kind === 'column') {
      commitColumn(option.id)
    } else if (option.kind === 'operator') {
      commitOperator(option.id as RuleOperator)
    } else {
      commitValue(option.label)
    }
    inputRef.current?.focus()
  }

  /* --------------------------------------------------------- run + validate */

  // Build the rule-append and its trailing connector without committing yet, so
  // Apply/Enter can decide synchronously.
  const appendRule = (rule: QueryRule) => {
    const nextRules = [...rules, rule]
    const nextConnectors =
      nextRules.length >= 2
        ? [...gapConnectors(), combinator]
        : value.connectors ?? []
    return { rules: nextRules, connectors: nextConnectors }
  }

  type CommitOutcome =
    | { kind: 'commit'; rules: QueryRule[]; connectors: Combinator[] }
    | { kind: 'advance'; value: string }
    | { kind: 'error'; text: string }
    | { kind: 'none' }

  // What Apply/Enter should do with the in-progress draft: complete it into a
  // rule, advance a half-typed `between`, report why it can't run, or nothing.
  const draftCommit = (): CommitOutcome => {
    if (stage === 'column') {
      if (needleRaw)
        return {
          kind: 'error',
          text: `Invalid query — no column matches "${needleRaw}".`,
        }
      return { kind: 'none' }
    }
    const label = draftColumn ? columnLabel(draftColumn) : draft.columnId ?? ''
    if (stage === 'operator') {
      return {
        kind: 'error',
        text: `Invalid query — choose a condition for "${label}".`,
      }
    }
    // Value stage: prefer a highlighted facet, otherwise the typed text.
    const opLabel = operatorLabel(draft.operator as RuleOperator)
    const val = (
      activeOption?.kind === 'value' ? activeOption.label : needleRaw
    ).trim()
    if (draft.operator === 'between') {
      if (draft.value === undefined) {
        if (val) return { kind: 'advance', value: val }
        return {
          kind: 'error',
          text: `Invalid query — "${label} ${opLabel}" needs a low value.`,
        }
      }
      if (!val)
        return {
          kind: 'error',
          text: `Invalid query — "${label} ${opLabel}" needs a high value.`,
        }
      return {
        kind: 'commit',
        ...appendRule({
          ...newRule(),
          columnId: draft.columnId!,
          operator: 'between',
          value: draft.value,
          value2: val,
        }),
      }
    }
    if (!val)
      return {
        kind: 'error',
        text: `Invalid query — enter a value for "${label} ${opLabel}".`,
      }
    return {
      kind: 'commit',
      ...appendRule({
        ...newRule(),
        columnId: draft.columnId!,
        operator: draft.operator!,
        value: val,
      }),
    }
  }

  // Commit any complete draft into `value.rules`, validate, and signal the
  // parent when the query is valid. This is what fixes a finished condition
  // sitting stuck in the draft: Apply/Enter always flush it into the rules.
  const applyQuery = () => {
    const outcome = draftCommit()

    if (outcome.kind === 'error') {
      setIsOpen(true)
      setMessage({ tone: 'error', text: outcome.text })
      return
    }
    if (outcome.kind === 'advance') {
      // `between`: the first bound is now committed; keep collecting the second.
      setDraft((d) => ({ ...d, value: outcome.value }))
      setQuery('')
      clearMessage()
      return
    }

    const effectiveRules = outcome.kind === 'commit' ? outcome.rules : rules
    if (outcome.kind === 'commit') {
      onChange({ ...value, rules: outcome.rules, connectors: outcome.connectors })
      resetToColumn()
    }

    // Guard: every effective rule should be complete (they are, by construction).
    for (const rule of effectiveRules) {
      const reason = invalidRuleReason(rule)
      if (reason) {
        const column = table.getColumn(rule.columnId)
        setMessage({
          tone: 'error',
          text: `Invalid query — ${
            column ? columnLabel(column) : rule.columnId
          }: ${reason}.`,
        })
        return
      }
    }

    const hasText = !!(value.text ?? '').trim()
    if (!effectiveRules.length && !value.limit && !hasText) {
      setMessage({
        tone: 'info',
        text: 'Type a column to add a condition, or pick a Top 10 shortcut.',
      })
      return
    }

    const limitNote = value.limit
      ? ` (showing ${value.limit.dir === 'top' ? 'top' : 'bottom'} ${value.limit.n})`
      : ''
    setMessage({ tone: 'ok', text: `Query applied${limitNote}.` })
    onApply?.()
  }

  /* ------------------------------------------------------------- removals */

  const removeRuleById = (id: string) => {
    clearMessage()
    const index = rules.findIndex((rule) => rule.id === id)
    if (index < 0) return
    const { nextRules, nextConnectors } = rulesConnectorsAfterRemoval(index)
    onChange({ ...value, rules: nextRules, connectors: nextConnectors })
  }

  // Pull a committed condition back into the draft so it can be corrected in
  // place rather than only deleted.
  const startEdit = (rule: QueryRule, next: Draft, prefill: string) => {
    const index = rules.findIndex((r) => r.id === rule.id)
    const { nextRules, nextConnectors } =
      index < 0
        ? { nextRules: rules, nextConnectors: value.connectors ?? [] }
        : rulesConnectorsAfterRemoval(index)
    onChange({ ...value, rules: nextRules, connectors: nextConnectors })
    setDraft(next)
    setQuery(prefill)
    setArrowed(false)
    setIsOpen(true)
    clearMessage()
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const editColumn = (rule: QueryRule) => {
    const column = table.getColumn(rule.columnId)
    startEdit(rule, {}, column ? columnLabel(column) : rule.columnId)
  }
  const editOperator = (rule: QueryRule) =>
    startEdit(rule, { columnId: rule.columnId }, '')
  const editValue = (rule: QueryRule) =>
    startEdit(rule, { columnId: rule.columnId, operator: rule.operator }, rule.value)

  const clearDraftColumn = () => setDraft({})
  const clearDraftOperator = () => setDraft({ columnId: draft.columnId })
  const clearDraftFirstValue = () => setDraft((d) => ({ ...d, value: undefined }))

  const clearLimit = () => {
    clearMessage()
    onChange({ ...value, limit: null })
  }

  // Reset everything - rules, connectors, limit, free text - back to empty, and
  // clear the in-progress draft with it.
  const clearAll = () => {
    onChange({ ...emptyGlobalSearch })
    setDraft({})
    setQuery('')
    setArrowed(false)
    setHighlight(0)
    clearMessage()
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Backspace on an empty input peels off the last chip, stepping back through
  // the draft, then the most recent committed condition, then the limit.
  const handleBackspace = () => {
    clearMessage()
    if (collectingSecond) {
      clearDraftFirstValue()
      return
    }
    if (draft.operator) {
      setDraft({ columnId: draft.columnId })
      return
    }
    if (draft.columnId) {
      setDraft({})
      return
    }
    const last = rules[rules.length - 1]
    if (last) {
      // Popping the last rule also drops its trailing connector.
      onChange({
        ...value,
        rules: rules.slice(0, -1),
        connectors: gapConnectors().slice(0, Math.max(0, rules.length - 2)),
      })
      const operands = operandCount(last.operator)
      if (operands === 0) {
        setDraft({ columnId: last.columnId })
      } else if (last.operator === 'between') {
        setDraft({
          columnId: last.columnId,
          operator: last.operator,
          value: last.value,
        })
      } else {
        setDraft({ columnId: last.columnId, operator: last.operator })
      }
      return
    }
    if (value.limit) onChange({ ...value, limit: null })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setArrowed(true)
      const base = showHighlight ? clampedHighlight : -1
      setHighlight(Math.min(visibleOptions.length - 1, base + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setArrowed(true)
      const base = showHighlight ? clampedHighlight : 0
      setHighlight(Math.max(0, base - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // Stage-advancing suggestions (column / operator / Top-N) commit and keep
      // building the condition. Anything else — a finished value, or nothing
      // highlighted — is treated as "apply": flush the draft into the rules,
      // validate, and signal the parent.
      if (
        activeOption &&
        (activeOption.kind === 'column' ||
          activeOption.kind === 'operator' ||
          activeOption.kind === 'common')
      ) {
        commitOption(activeOption)
      } else {
        applyQuery()
      }
      return
    }
    if (e.key === 'Tab') {
      // Tab commits the highlighted suggestion and keeps focus (preventDefault),
      // but only when there is something to commit — otherwise it tabs away.
      if (activeOption) {
        e.preventDefault()
        commitOption(activeOption)
      }
      return
    }
    if (e.key === 'Backspace' && query === '') {
      e.preventDefault()
      handleBackspace()
      return
    }
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const queryOnServer = () =>
    window.alert('Server-side query is not implemented yet.')

  const placeholder =
    stage === 'column'
      ? rules.length || value.limit
        ? 'Add a condition…'
        : 'Search — type a column or pick a shortcut…'
      : stage === 'operator'
        ? 'Pick a condition…'
        : collectingSecond
          ? 'and…'
          : isNumericType(draftType)
            ? 'Enter a value…'
            : 'Type or pick a value…'

  /* --------------------------------------------------------------- render */

  const messageClasses =
    message?.tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : 'border-slate-200 bg-slate-50 text-slate-600'

  let lastSection: string | null = null

  // The per-gap connectors, one shorter than `rules`, read by the inline
  // toggles that sit between adjacent conditions.
  const connectors = gapConnectors()

  return (
    <div className="w-full text-slate-900" ref={containerRef}>
      <div className="relative">
        {/* The token field: chips + the live input share one bordered box. */}
        <div
          className="flex flex-wrap items-center gap-1.5 min-h-control-lg w-full cursor-text rounded-xl border border-slate-200 bg-white px-2 py-1.5 transition-colors focus-within:border-accent-400 focus-within:ring-2 focus-within:ring-accent-200"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault()
              inputRef.current?.focus()
              setIsOpen(true)
            }
          }}
        >
          {/* Active Top N / Bottom N limit. */}
          {value.limit ? (
            <Chip
              text={`${value.limit.dir === 'top' ? 'Top' : 'Bottom'} ${
                value.limit.n
              } ${
                table.getColumn(value.limit.columnId)
                  ? columnLabel(table.getColumn(value.limit.columnId)!)
                  : value.limit.columnId
              }`}
              meta={
                limitInfo?.threshold
                  ? `${value.limit.dir === 'top' ? '≥' : '≤'} ${limitInfo.threshold}`
                  : undefined
              }
              tone="accent"
              onRemove={clearLimit}
              removeLabel="Remove limit"
            />
          ) : null}

          {/* Committed conditions, each a grouped, accent-tinted unit. */}
          {rules.map((rule, index) => {
            const column = table.getColumn(rule.columnId)
            const label = column ? columnLabel(column) : rule.columnId
            const operands = operandCount(rule.operator)
            return (
              <React.Fragment key={rule.id}>
                {index > 0 ? (
                  // The dynamic per-gap AND/OR connector: only ever between two
                  // committed conditions, so it never shows with 0 or 1 rule.
                  <ConnectorToggle
                    value={connectors[index - 1]}
                    onSet={(next) => setConnector(index - 1, next)}
                  />
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-lg border border-accent-200 bg-accent-50 p-1">
                  <Chip
                    text={label}
                    tone="accent"
                    onEdit={() => editColumn(rule)}
                    onRemove={() => removeRuleById(rule.id)}
                    removeLabel={`Remove condition ${label}`}
                    editLabel={`Edit column ${label}`}
                  />
                  <Chip
                    text={operatorLabel(rule.operator)}
                    tone="accent"
                    muted
                    onEdit={() => editOperator(rule)}
                    onRemove={() => editOperator(rule)}
                    removeLabel="Change operator"
                    editLabel="Change operator"
                  />
                  {operands > 0 ? (
                    <Chip
                      text={rule.value}
                      tone="accent"
                      onEdit={() => editValue(rule)}
                      onRemove={() => editValue(rule)}
                      removeLabel="Edit value"
                      editLabel="Edit value"
                    />
                  ) : null}
                  {rule.operator === 'between' ? (
                    <>
                      <span className="px-0.5 text-xs text-slate-400">and</span>
                      <Chip
                        text={rule.value2 ?? ''}
                        tone="accent"
                        onEdit={() => editValue(rule)}
                        onRemove={() => editValue(rule)}
                        removeLabel="Edit second value"
                        editLabel="Edit second value"
                      />
                    </>
                  ) : null}
                </span>
              </React.Fragment>
            )
          })}

          {/* The condition being built, as loose slate chips. */}
          {draft.columnId ? (
            <>
              {rules.length ? (
                // A static hint of how the new condition will join; it becomes
                // an interactive connector once the condition is committed.
                <span className="select-none px-0.5 text-2xs font-black uppercase tracking-widest text-slate-400">
                  {combinator}
                </span>
              ) : null}
              <Chip
                text={draftColumn ? columnLabel(draftColumn) : draft.columnId}
                onRemove={clearDraftColumn}
                removeLabel="Remove column"
              />
            </>
          ) : null}
          {draft.operator ? (
            <Chip
              text={operatorLabel(draft.operator)}
              muted
              onRemove={clearDraftOperator}
              removeLabel="Remove operator"
            />
          ) : null}
          {collectingSecond ? (
            <>
              <Chip
                text={draft.value ?? ''}
                onRemove={clearDraftFirstValue}
                removeLabel="Remove first value"
              />
              <span className="px-0.5 text-xs text-slate-400">and</span>
            </>
          ) : null}

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIsOpen(true)
              if (message) setMessage(null)
            }}
            onFocus={() => {
              setIsOpen(true)
              setFocused(true)
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            inputMode={
              stage === 'value' && isNumericType(draftType) ? 'decimal' : undefined
            }
            className="min-w-[9rem] flex-1 bg-transparent py-0.5 text-slate-900 outline-none placeholder:text-slate-400"
          />

          {/* Right-aligned actions — shown only when the field is focused AND
              there is something to act on (typed text or an existing query). */}
          {focused && (!isGlobalSearchEmpty(value) || query.trim() !== '') ? (
            <div className="ml-auto flex shrink-0 items-center gap-1.5 self-center">
            <Tooltip label="Apply query">
              <button
                type="button"
                aria-label="Apply query"
                className="icon-btn-sm text-accent-600"
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyQuery}
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Clear query">
              <button
                type="button"
                aria-label="Clear query"
                className="icon-btn-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={clearAll}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip label="Query on server (not implemented)">
              <button
                type="button"
                aria-label="Query on server (not implemented)"
                className="icon-btn-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={queryOnServer}
              >
                <Server size={16} aria-hidden="true" />
              </button>
            </Tooltip>
            </div>
          ) : null}
        </div>

        {/* The stage-driven dropdown. */}
        {isOpen ? (
          <div
            ref={popoverRef}
            id={LISTBOX_ID}
            role="listbox"
            style={{
              left: popoverPos?.left ?? 0,
              top: popoverPos?.top ?? 0,
              width: 'max-content',
              minWidth: '8rem',
              maxWidth: 'min(360px, 90vw)',
              visibility: popoverPos ? undefined : 'hidden',
            }}
            className="fixed z-[100] max-h-[16rem] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-slate-500">
                {stage === 'value'
                  ? 'No matching values — type one and press Enter'
                  : stage === 'operator'
                    ? 'No matching conditions'
                    : ruleColumns.length === 0
                      ? 'No queryable columns'
                      : 'No matching columns'}
              </div>
            ) : (
              (() => {
                lastSection = null
                return visibleOptions.map((option, index) => {
                  const section =
                    option.kind === 'typed'
                      ? 'Values'
                      : sectionLabel(option.kind)
                  const header = section !== lastSection ? section : null
                  lastSection = section
                  const active = index === effectiveHighlight
                  return (
                    <React.Fragment key={`${option.kind}-${option.id}`}>
                      {header ? (
                        <div className="eyebrow px-3 pt-2.5 pb-1">{header}</div>
                      ) : null}
                      <div
                        id={`${LISTBOX_ID}-opt-${index}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => {
                          setArrowed(true)
                          setHighlight(index)
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          commitOption(option)
                        }}
                        className={
                          'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors ' +
                          (active
                            ? 'bg-accent-50 text-accent-700'
                            : 'text-slate-700 sm:hover:bg-slate-50')
                        }
                      >
                        <span className="flex-1 truncate">{option.label}</span>
                        {option.meta ? (
                          <span className="shrink-0 tabular-nums text-slate-500">
                            {option.meta}
                          </span>
                        ) : null}
                      </div>
                    </React.Fragment>
                  )
                })
              })()
            )}
          </div>
        ) : null}
      </div>

      {/* Validation / run feedback. */}
      {message ? (
        <div
          aria-live="polite"
          className={
            'mt-2 rounded-lg border px-3 py-1.5 text-sm ' + messageClasses
          }
        >
          {message.text}
        </div>
      ) : null}

      {/* Actions. Apply / Clear / Query-on-server all live inside the field
          above as icon buttons; the AND/OR combinator lives inline between
          conditions (see ConnectorToggle). Only the combine hint remains here. */}
      {rules.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">
            Tap the AND / OR between conditions to change how they combine.
          </span>
        </div>
      ) : null}
    </div>
  )
}

// The inline AND/OR connector between two committed conditions: a small
// segmented pill, accent on the active side, that flips the gap's combinator.
function ConnectorToggle({
  value,
  onSet,
}: {
  value: Combinator
  onSet: (next: Combinator) => void
}) {
  return (
    <span
      role="group"
      aria-label="Combine with"
      className="inline-flex select-none overflow-hidden rounded-lg border border-slate-200 text-2xs font-black uppercase tracking-wider"
    >
      {(['and', 'or'] as Combinator[]).map((option) => {
        const active = value === option
        return (
          <button
            key={option}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSet(option)}
            aria-pressed={active}
            className={
              'px-1.5 py-0.5 transition-colors ' +
              (active
                ? 'bg-accent-500 text-white'
                : 'bg-white text-slate-500 sm:hover:bg-slate-50')
            }
          >
            {option}
          </button>
        )
      })}
    </span>
  )
}

// A committed part of a condition: a small pill. Its body edits the part in
// place (when `onEdit` is given); its × removes/reopens it.
function Chip({
  text,
  meta,
  muted,
  tone = 'slate',
  onEdit,
  onRemove,
  removeLabel,
  editLabel,
}: {
  text: string
  meta?: string
  muted?: boolean
  tone?: 'slate' | 'accent'
  onEdit?: () => void
  onRemove: () => void
  removeLabel: string
  editLabel?: string
}) {
  const toneCls =
    tone === 'accent'
      ? 'bg-white border-accent-200'
      : 'bg-slate-100 border-slate-200'
  const labelCls = muted ? 'text-slate-500' : 'text-slate-800'
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-sm ' +
        toneCls
      }
    >
      {onEdit ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onEdit}
          aria-label={editLabel ?? removeLabel}
          className={
            'rounded-md transition-colors sm:hover:text-accent-700 ' + labelCls
          }
        >
          {text || '…'}
        </button>
      ) : (
        <span className={labelCls}>{text || '…'}</span>
      )}
      {meta ? <span className="text-slate-400 tabular-nums">{meta}</span> : null}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        aria-label={removeLabel}
        className="icon-btn-plain grid h-4 w-4 place-items-center rounded-md text-base leading-none text-slate-400 sm:hover:text-rose-600"
      >
        ×
      </button>
    </span>
  )
}

export default GlobalSearch
