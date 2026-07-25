// VENDORED VERBATIM FROM piranha ui/src/components/SectionHeading.tsx — do NOT diverge; at import into piranha, delete src/piranha/ and repoint to the originals.
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ink, type SemanticCategory } from './semanticColors';

/**
 * THE app's headed-section primitive — "a heading and its icon are ONE coloured unit".
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Why this file exists at all
 * The semantic-category system (ui-rules.md §2a, `theme/semanticColors.ts`) says *same concept →
 * same colour, on every screen*. Applying that to headings by hand — writing `text-work-ink` into
 * a hundred `<h3>`s — would satisfy the pixels and betray the rule: the next re-tune would have to
 * find all hundred, and the hundred-and-first heading would be written grey by someone who never
 * read this document. `components/Tabs.tsx` already established the right shape for this: a tab
 * strip does **not** colour its own icons, it declares `iconCategory` and the shared component
 * resolves it. This file is that same contract for headings.
 *
 * So: **a heading names WHAT IT IS ABOUT (`category`), never what colour it is.** One edit here,
 * or one preset re-tuning `theme.json`'s ten `-ink` roles, repaints every heading in the app.
 *
 * ## What it owns (callers must not restyle these)
 *  - The heading colour, for BOTH the icon and the text, from the single registry via `ink()`.
 *    `-ink` is the 700 step, measured AA (≥4.5:1) on white, on the `slate-100` page and on its own
 *    tint, so one token is legitimately safe as icon colour *and* label colour — there is no
 *    "is this text or an icon?" judgement at the call site.
 *  - The heading typography ramp (`size`), which is ui-rules.md §3's weight/size scale, not a
 *    free choice. `eyebrow` reproduces the `.eyebrow` micro-label pattern *minus its colour*,
 *    because `.eyebrow` hard-codes `text-slate-500` and two `text-*` utilities on one element are
 *    resolved by stylesheet order, not class order — i.e. `className="eyebrow text-work-ink"` is a
 *    coin flip. Never write that; pass `size="eyebrow"`.
 *  - The real heading TAG (`level` → `<h1>`…`<h4>`), so a coloured heading is still a heading in
 *    the accessibility tree. Colour is never the only carrier of meaning (WCAG 1.4.1): the words
 *    stay, the icon shape stays, the heading semantics stay.
 *
 * ## What it deliberately does NOT do
 *  - **It does not colour body text.** Descriptions, table cells, form labels and paragraphs stay
 *    neutral. A page where everything is coloured communicates exactly as much as a page where
 *    nothing is: this component is for the heading row only.
 *  - **It does not use `brand`.** Accent is reserved for identity, primary actions and the
 *    selected state (ui-rules.md §2); a heading tinted accent would compete with the one signal
 *    that tells the user where they are. `category` accepts it — the registry is the registry —
 *    but do not reach for it here.
 *  - **It is a LIGHT-SURFACE component.** Every `-ink` is validated against white and the page
 *    background, not against `surface-terminal`/`surface-console`. On the documented dark
 *    surfaces (log/terminal output, the console dock) a 700-step ink is unreadable, and the only
 *    honest fix would be a new on-dark step — i.e. a new token, which §2a forbids adding casually.
 *    Do not use this component inside a dark inset; leave those headings on their existing
 *    light-on-dark treatment until such a step is deliberately designed.
 */

/** Typography steps — ui-rules.md §3's ramp, not an open set. */
export type HeadingSize = 'eyebrow' | 'sm' | 'md' | 'lg' | 'xl';

/** Which real heading element to emit. Pick by document structure, never by desired size. */
export type HeadingLevel = 1 | 2 | 3 | 4;

/**
 * ⚠ Class strings are literal for the same reason `semanticColors.ts`'s are: Tailwind scans
 * source text, so a class assembled from a variable is simply never generated.
 */
export const HEADING_SIZE: Record<HeadingSize, { text: string; icon: number }> = {
  // `.eyebrow` without its colour — see the note above about two competing `text-*` utilities.
  eyebrow: { text: 'text-micro font-black uppercase tracking-widest', icon: 13 },
  sm: { text: 'text-xs font-bold', icon: 14 },
  md: { text: 'text-sm font-bold', icon: 15 },
  lg: { text: 'text-base font-bold', icon: 18 },
  xl: { text: 'text-xl font-bold', icon: 22 },
};

/**
 * The colour+typography class string for a heading, for the handful of shared components that
 * must own their own heading TAG and so cannot render `<SectionHeading>` itself (`Modal`'s
 * `<h2 id={titleId}>`, `CollapsiblePanel`'s `<span>` inside its toggle button).
 *
 * This is still the single path — it reads `ink()` from the one registry. It exists so those
 * components do not become the two places in the app that hand-write a role class.
 */
export const headingClasses = (category: SemanticCategory, size: HeadingSize = 'md'): string =>
  `${HEADING_SIZE[size].text} ${ink(category)}`;

/** Icon pixel size for a heading step, so an icon rendered next to `headingClasses` matches it. */
export const headingIconSize = (size: HeadingSize = 'md'): number => HEADING_SIZE[size].icon;

export interface SectionHeadingProps {
  /** WHAT THIS SECTION IS ABOUT. The only colour input — see `theme/semanticColors.ts`. */
  category: SemanticCategory;
  /** Lucide icon, coloured to match the text. Optional: a heading is legible without one. */
  icon?: LucideIcon;
  children: React.ReactNode;
  /** Real heading element. Defaults to `<h3>` — the common "section inside a page" depth. */
  level?: HeadingLevel;
  size?: HeadingSize;
  /** Right-aligned controls/meta on the same row (a count, a "Refresh" button). NOT coloured. */
  actions?: React.ReactNode;
  /** `id` on the heading element — for `aria-labelledby` / deep links. */
  id?: string;
  /** Layout only (margins, `mb-2`, `flex-1`). Never a colour: that is what `category` is for. */
  className?: string;
  featureId?: string;
}

export function SectionHeading({
  category, icon: Icon, children, level = 3, size = 'md', actions, id, className = '', featureId,
}: SectionHeadingProps) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
  const tone = ink(category);
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`} data-feature-id={featureId}>
      {Icon && <Icon size={HEADING_SIZE[size].icon} className={`${tone} shrink-0`} aria-hidden />}
      <Tag id={id} className={`${HEADING_SIZE[size].text} ${tone} min-w-0`}>{children}</Tag>
      {actions && <div className="ml-auto shrink-0 flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export default SectionHeading;
