// VENDORED VERBATIM FROM the shared UI (theme/semanticColors.ts — do NOT diverge; at import into the shared UI, delete src/ui/ and repoint to the originals.
/**
 * THE SEMANTIC CATEGORY REGISTRY — "same concept → same colour, on every screen."
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS
 * ───────────────
 * The app was, in the owner's words, "only orange and white and grey". Every accent on every
 * page was the same the shared UI orange-red, so nothing was distinguishable by hue: a cost figure, an
 * error count and a task count all shouted with identical voices, and an icon added no
 * information the label next to it didn't already carry.
 *
 * The fix is NOT "make things colourful". It is that **hue must encode a CATEGORY**, and the
 * same category must resolve to the same hue everywhere it appears — the Insights KPI tile for
 * TOTAL COST, a budget chip on the board, and a spend column in a table are all `cost`, so all
 * three are teal. That promise is only keepable if there is exactly ONE table mapping category
 * → colour. This is that table. A component that picks `text-indigo-600` by hand has opted out
 * of the system and will drift the first time anyone re-tunes the palette.
 *
 * WHAT IT IS NOT
 * ──────────────
 * - It is **not** a replacement for the brand. the shared UI orange-red (`accent-*`) stays tier-1
 *   IDENTITY and primary action, exactly as ui-rules.md §2 defines it. `brand` is listed here
 *   only so the registry can name it; nothing gets recoloured away from it.
 * - It is **not** a danger signal. `danger` is one category among ten and keeps the whole
 *   3-tier danger hierarchy (§2) behind it — a rose ICON is category metadata, a `.btn-danger`
 *   is an irreversible action. Hue alone never carries either meaning (WCAG 1.4.1): every
 *   consumer here pairs the colour with a text label and a distinct icon SHAPE.
 *
 * HOW THE COLOURS RESOLVE
 * ───────────────────────
 * Every class string below points at a `theme.json` semantic role, never at a Tailwind palette
 * literal and never at a hex. `text-work-ink` → `--color-work-ink` → `sky.700`. So re-tuning a
 * category, or making a preset restyle all ten, is a JSON edit that reaches every consumer —
 * the same contract the rest of the theme layer gives (ui-rules.md §16).
 *
 * CONTRAST, MEASURED — not assumed
 * ────────────────────────────────
 * `ink` is the 700 step of its family for a reason: at that step every one of the ten clears
 * **4.5:1 on white AND on the slate-100 page background** (worst case `attention`/amber-700 at
 * 5.02:1 white / 4.58:1 page), and ≥4.84:1 on its own `subtle` tint. That is the AA *text*
 * floor, comfortably above WCAG's 3:1 non-text floor — so one token is safe as both an icon
 * colour and a label colour, and there is no "is this an icon or is it text?" judgement call at
 * the call site. `theme.json`'s `a11y.mutedFloorPairs` lists all thirty pairs and
 * `__tests__/theme.test.ts` re-measures them for the base theme *and every preset*, so a theme
 * that trades readability for a look is a red test rather than a shipped regression.
 */

/** The ten categories. Adding one is a deliberate design decision: it must be a KIND of thing
 *  that recurs across at least two screens, and it must get its own row in ui-rules.md §2. */
export type SemanticCategory =
  | 'brand'
  | 'work'
  | 'data'
  | 'design'
  | 'code'
  | 'agent'
  | 'run'
  | 'cost'
  | 'attention'
  | 'danger'
  | 'neutral';

export interface CategoryStyle {
  /** What this hue MEANS. Kept next to the colour so the next person extends rather than guesses. */
  readonly meaning: string;
  /** AA-safe ink: icons, values, labels. Clears 4.5:1 on white, on the page, and on `subtle`. */
  readonly text: string;
  /** The category's tint fill — a card/chip background. */
  readonly bg: string;
  /** The tint's matching border. Pair with `bg`; never use it alone on a white surface. */
  readonly border: string;
  /** A filled status dot / bar. Same ink value, as a background. */
  readonly dot: string;
}

/**
 * ⚠ Class strings are written out IN FULL and are never composed from a template literal —
 * Tailwind scans source text for literal class names, so a class assembled at runtime from a
 * category name is simply never generated, and the failure is an invisible icon in production
 * with a green test suite. `__tests__/semanticColors.test.ts` fails on any interpolated one.
 */
export const CATEGORY: Record<SemanticCategory, CategoryStyle> = {
  brand: {
    meaning: 'the shared UI identity and the primary action. Unchanged tier-1 brand — see ui-rules.md §2.',
    text: 'text-accent-600',
    bg: 'bg-accent-50',
    border: 'border-accent-200',
    dot: 'bg-accent-600',
  },
  work: {
    meaning: 'Work items — tasks, the board, queues, backlogs. The thing the swarm is asked to do.',
    text: 'text-work-ink',
    bg: 'bg-work-subtle',
    border: 'border-work-border',
    dot: 'bg-work-ink',
  },
  data: {
    meaning: 'Data and quantities — tables, context, token counts, anything measured rather than done.',
    text: 'text-data-ink',
    bg: 'bg-data-subtle',
    border: 'border-data-border',
    dot: 'bg-data-ink',
  },
  design: {
    meaning: 'Design surfaces — the architecture canvas and the live preview. What the product LOOKS like.',
    text: 'text-design-ink',
    bg: 'bg-design-subtle',
    border: 'border-design-border',
    dot: 'bg-design-ink',
  },
  code: {
    meaning: 'Source code — the IDE, files, diffs, repositories.',
    text: 'text-code-ink',
    bg: 'bg-code-subtle',
    border: 'border-code-border',
    dot: 'bg-code-ink',
  },
  agent: {
    meaning: 'Agents and AI. The violet ai-* hue ui-rules.md §2 already reserves for "the machine\'s doing".',
    text: 'text-agent-ink',
    bg: 'bg-agent-subtle',
    border: 'border-agent-border',
    dot: 'bg-agent-ink',
  },
  run: {
    meaning: 'Execution and health — runs, healthy services, success, "it is working right now".',
    text: 'text-success-ink',
    bg: 'bg-success-subtle',
    border: 'border-success-border',
    dot: 'bg-success-ink',
  },
  cost: {
    meaning: 'Money — spend, budget, price, token cost. Deliberately NOT emerald: green already means success.',
    text: 'text-cost-ink',
    bg: 'bg-cost-subtle',
    border: 'border-cost-border',
    dot: 'bg-cost-ink',
  },
  attention: {
    meaning: 'Needs a look, but nothing is broken — retries, pending review, warnings, degraded.',
    text: 'text-warning-ink',
    bg: 'bg-warning-subtle',
    border: 'border-warning-border',
    dot: 'bg-warning-ink',
  },
  danger: {
    meaning: 'Errors and failures. Category metadata only — a destructive ACTION is .btn-danger (§2 tier 3).',
    text: 'text-danger-ink',
    bg: 'bg-danger-subtle',
    border: 'border-danger-border',
    dot: 'bg-danger-ink',
  },
  neutral: {
    meaning: 'Metadata with no category of its own — timestamps, ids, counts that mean nothing on their own.',
    text: 'text-neutral-ink',
    bg: 'bg-neutral-subtle',
    border: 'border-neutral-border',
    dot: 'bg-neutral-ink',
  },
};

/** Ink class for a category — the one-liner most call sites want: `<Icon className={ink('cost')} />`. */
export const ink = (c: SemanticCategory): string => CATEGORY[c].text;

/** `bg + border` for a tinted card/chip. Pairs the two so no one uses a tint border on white. */
export const tint = (c: SemanticCategory): string => `${CATEGORY[c].bg} ${CATEGORY[c].border}`;

/**
 * Navigation section identity — one stable hue per studio, keyed by ROUTE so the navbar, the
 * board's merged header and any future launcher can never disagree about what colour "Canvas"
 * is. Canvas and Preview intentionally SHARE `design`: they are the same category of work, and
 * inventing a hue purely to make two tabs differ would make hue mean "position in the bar"
 * instead of "kind of thing", which is the exact failure this registry exists to prevent.
 */
export const STUDIO_CATEGORY: Record<string, SemanticCategory> = {
  '/tasks': 'work',
  '/data': 'data',
  '/canvas': 'design',
  '/preview': 'design',
  '/ide': 'code',
  '/agentic': 'agent',
  '/insights': 'run',
  // Config shares `run` with Insights DELIBERATELY, on the same grounds Canvas and Preview
  // share `design`: both are about EXECUTION AND HEALTH — Insights says whether it is working,
  // Config holds the values without which it cannot start. Inventing an eleventh hue purely to
  // make two neighbouring tabs differ would make hue mean "position in the bar".
  '/config': 'run',
};

/** Category for a studio route, falling back to `neutral` for a route with no identity yet. */
export const studioCategory = (to: string): SemanticCategory => STUDIO_CATEGORY[to] ?? 'neutral';

/**
 * Settings-section identity — the SAME table for `/settings`'s left section nav and GitPanel's
 * own horizontal tab strip, because they are literally the same eleven destinations rendered by
 * two components. Keyed by section id for the same reason `STUDIO_CATEGORY` is keyed by route:
 * two surfaces that disagree about what colour "Git" is would make hue mean "which component
 * drew me".
 *
 * The hues are not new decisions — each one reuses the category that concept already carries
 * elsewhere in the app:
 *   git           → `work`   the IDE toolbar's Source Control opener is already `work`
 *   repo          → `code`   files/diffs, the same cyan as the IDE and the file-type icons
 *   agentic       → `agent`  the Agentic studio's violet, navbar and Insights included
 *   proposal      → `agent`  it proposes the agent setup; same concept, so the same hue (§2a:
 *                            never invent a hue purely to make two neighbours differ)
 *   run           → `run`    execution and health
 *   index         → `data`   an embedding index is measured data
 *   microservices → `run`    services that are up or down
 *   architecture  → `design` the architecture surface, same fuchsia as canvas/preview
 *   project       → `work`   which project the board is working on
 *   global        → `neutral` platform chrome, not a concept of its own
 *   help          → `attention` "read this" — amber, nothing broken
 */
export const SETTINGS_CATEGORY: Record<string, SemanticCategory> = {
  project: 'work',
  git: 'work',
  agentic: 'agent',
  proposal: 'agent',
  repo: 'code',
  run: 'run',
  index: 'data',
  global: 'neutral',
  microservices: 'run',
  architecture: 'design',
  help: 'attention',
};

/** Category for a settings section id, falling back to `neutral` for an unmapped one. */
export const settingsCategory = (id: string): SemanticCategory => SETTINGS_CATEGORY[id] ?? 'neutral';
