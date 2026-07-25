// VENDORED VERBATIM FROM piranha ui/src/pages/tasks/components/Tooltip.tsx — do NOT diverge; at import into piranha, delete src/piranha/ and repoint to the originals.
import { useState, useRef, useCallback, useLayoutEffect, isValidElement, cloneElement, type ReactNode, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

/**
 * Project-wide custom tooltip. Portal-rendered to <body> so it never clips inside
 * overflow-hidden/scroll containers. Shows on hover + keyboard focus.
 *
 * ACCESSIBILITY: this replaces the native `title` attribute, which for an ICON-ONLY button is
 * also its accessible name. So when the wrapped element has no name at all — no
 * aria-label/aria-labelledby AND no visible text — we inject the tooltip label as its
 * aria-label, otherwise migrating `title=` -> <Tooltip> would silently strip the name screen
 * readers announce. It is deliberately never injected over a control that already has a name:
 * a tooltip is a HINT, not a name, and overwriting "qa ↗" with a validator sentence renames the
 * control rather than describing it.
 *
 * PLACEMENT: `side` is a preference, not an instruction. A tooltip that renders above a
 * trigger sitting 34px from the top of the viewport lands off-screen, and portalling to
 * <body> does not save it — nothing clipped it, there was simply nowhere to be. So the side
 * flips when the preferred one does not fit, and the bubble is nudged horizontally after
 * measurement so a tooltip on the leftmost control cannot run off the edge either.
 *
 * Usage: <Tooltip label="Refresh"><button …/></Tooltip>
 */

/** Enough for one line of `text-2xs` plus padding, plus the 8px gap. Measuring the tooltip
 *  would need it mounted first, which means a frame of it drawn in the wrong place. */
const NEEDED = 34;
/** A `wide` bubble wraps to several lines, so the one-line budget above would happily place it
 *  where its top half is off-screen (found exactly that on the DB grid's `+ Row` warning). */
const NEEDED_WIDE = 130;
const EDGE = 8;

/**
 * Does this subtree render text a screen reader would already read as the element's name?
 *
 * Walks children rather than inspecting the DOM, because the decision has to be made during
 * render. Elements marked `aria-hidden` don't count (a decorative glyph next to an icon is not a
 * name), and neither does whitespace.
 */
function hasRenderedText(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return false;
  if (typeof node === 'string') return node.trim().length > 0;
  if (typeof node === 'number') return true;
  if (Array.isArray(node)) return node.some(hasRenderedText);
  if (isValidElement(node)) {
    const p = (node as ReactElement).props as Record<string, unknown>;
    if (p['aria-hidden']) return false;
    if (typeof p['aria-label'] === 'string' && p['aria-label'].trim()) return true;
    return hasRenderedText(p.children as ReactNode);
  }
  return false;
}

export function Tooltip({
  label,
  children,
  side = 'top',
  wide = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  /**
   * Extra classes for the WRAPPER span. The wrapper is `inline-flex`, which is inert in a normal
   * row but breaks a child that was itself a flex item (`flex-1 min-w-0 truncate` — the truncate
   * pattern this component replaces `title=` for). Pass `flex-1 min-w-0` there so the wrapper
   * takes the child's place in the parent's flex layout instead of collapsing it to its content.
   */
  className?: string;
  /**
   * Opt in to a WRAPPING bubble (max ~18rem) instead of the default single nowrap line. For the
   * occasional tooltip carrying a real sentence — e.g. the DB grid's "direct edits bypass the
   * board's rules" warning, which used to be a permanent banner under the table. A 150-character
   * label on the default nowrap bubble renders as one ~700px strip that runs off both edges,
   * because the bubble is centre-anchored; this is the release valve for that, added as an
   * opt-in prop so every existing one-word tooltip is byte-identical.
   */
  wide?: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** Horizontal nudge applied AFTER measuring, see the layout effect below. */
  const [dx, setDx] = useState(0);

  // Clamping the ANCHOR is not enough, and this was a real bug: the bubble is centre-anchored
  // (`translate(-50%)`), so a 131px-wide "Toggle Console (Ctrl+J)" on the IDE's 12px-wide left
  // rail (centre x≈30) rendered at x = -37 — the first third of the label off-screen, on the exact
  // control this component was introduced to fix. The bubble's own width is only knowable once it
  // is mounted, so measure it and nudge it back inside the viewport before the browser paints.
  //
  // Derive the nudge from the bubble's WIDTH, never from its measured `left`. Measured left
  // already includes the nudge, so correcting from it feeds back into itself: under jsdom every
  // rect is 0 regardless of what we set, so each pass computed a base of `-dx` and grew the
  // offset forever — an infinite render loop that took out three unrelated suites. Width does not
  // depend on the nudge, so this converges in a single pass and is inert when rects are 0.
  useLayoutEffect(() => {
    if (!pos) { setDx(0); return; }
    const el = tipRef.current;
    if (!el) return;
    const half = el.getBoundingClientRect().width / 2;
    const overflowLeft = EDGE - (pos.x - half);
    const overflowRight = (pos.x + half) - (window.innerWidth - EDGE);
    const next = overflowLeft > 0 ? overflowLeft : overflowRight > 0 ? -overflowRight : 0;
    if (Math.abs(next - dx) > 0.5) setDx(next);
  }, [pos, dx, label]);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const needed = wide ? NEEDED_WIDE : NEEDED;
    const fitsAbove = r.top >= needed;
    const fitsBelow = window.innerHeight - r.bottom >= needed;
    // Prefer `side`; fall back to the other only when it actually has room. When neither
    // fits (a control in a viewport shorter than ~70px) keep the preference — clipped is
    // still better than flipping to a side that is equally clipped.
    const place: 'top' | 'bottom' =
      side === 'top' ? (fitsAbove || !fitsBelow ? 'top' : 'bottom')
        : (fitsBelow || !fitsAbove ? 'bottom' : 'top');
    const cx = Math.min(Math.max(r.left + r.width / 2, EDGE), window.innerWidth - EDGE);
    setPos({ x: cx, y: place === 'top' ? r.top : r.bottom, side: place });
  }, [side, wide]);
  const hide = useCallback(() => setPos(null), []);

  // Give the child an accessible name from `label` ONLY when it has none — neither an explicit
  // aria-* attribute nor visible text of its own.
  //
  // The text check is the important half and was missing: injecting `aria-label` onto a control
  // that already renders text does not *add* a name, it REPLACES one. A button reading "qa ↗"
  // silently became "stage qa has no outcomes…" — the hint overwriting the name. A tooltip is a
  // hint, never a name; the only case that genuinely needs the injection is the icon-only button
  // whose old `title=` WAS its name.
  const labelled = (() => {
    if (!isValidElement(children)) return children;
    const p = (children as ReactElement).props as Record<string, unknown>;
    if (p['aria-label'] || p['aria-labelledby']) return children;
    if (hasRenderedText(p.children as ReactNode)) return children;
    return cloneElement(children as ReactElement, { 'aria-label': label } as Record<string, unknown>);
  })();

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={`inline-flex ${className}`}
    >
      {labelled}
      {pos && label && createPortal(
        <div
          ref={tipRef}
          data-side={pos.side}
          style={{
            position: 'fixed',
            left: pos.x + dx,
            top: pos.side === 'top' ? pos.y - 8 : pos.y + 8,
            transform: pos.side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
          className={`z-[200] pointer-events-none px-2 py-1 rounded-lg bg-slate-900 text-white text-2xs font-semibold shadow-lg ${wide ? 'max-w-[18rem] whitespace-normal leading-relaxed text-left' : 'whitespace-nowrap'}`}
          role="tooltip"
        >
          {label}
        </div>,
        document.body,
      )}
    </span>
  );
}

export default Tooltip;
