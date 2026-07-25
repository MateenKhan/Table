// VENDORED VERBATIM FROM piranha ui/src/components/Modal.tsx — do NOT diverge; at import into piranha, delete src/piranha/ and repoint to the originals.
import React, { useEffect, useId, useRef } from 'react';
import { Tooltip } from './Tooltip';
import { X } from 'lucide-react';
import { headingClasses } from './SectionHeading';
import { ink, type SemanticCategory } from './semanticColors';

// ─────────────────────────────────────────────────────────────────────────────
// Modal — the app's shared dialog (the "git modal" look: centered card on
// desktop, bottom sheet on mobile). Global so any feature can reuse it. Closes on
// X, Esc, and backdrop click; announced as a labelled dialog and focus-managed.
//
// Previously lived at src/pages/tasks/components/Modal.tsx; that path now
// re-exports this one so existing importers keep working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /**
   * WHAT THIS DIALOG IS ABOUT (ui-rules.md §2a). Colours the title and — because Lucide icons
   * stroke with `currentColor` — the icon badge with it, as one unit, through the shared
   * `headingClasses()` path. Omit it and the dialog keeps its previous neutral `text-slate-900`
   * title, so every existing caller is untouched. An icon that sets its own colour still wins.
   */
  category?: SemanticCategory;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind max-width class for desktop, e.g. 'sm:max-w-md' */
  maxW?: string;
  featureId?: string;
  /**
   * Accessible name for the dialog. Defaults to the visible `title`.
   * Provide this when `title` is non-textual (icon/element) so screen
   * readers still announce a meaningful label.
   */
  ariaLabel?: string;
  /**
   * Let the page BEHIND the dialog stay interactive: the dim/blur backdrop becomes
   * `pointer-events-none` so an HTML5 drag can start outside the dialog and finish inside it,
   * and outside-click close moves to a document `click` listener (a click only fires on
   * press+release without a drag, so dragging into the dialog never closes it).
   *
   * Needed by drop-target dialogs such as the canvas Features dialog: a normal
   * `fixed inset-0` backdrop swallows every pointer event on the palette/inspector, which makes
   * dragging an item INTO the dialog physically impossible. Focus is not trapped and
   * `aria-modal` is omitted in this mode, because the rest of the page is genuinely reachable.
   */
  allowOutsideInteraction?: boolean;
}

/**
 * Common modal: bottom sheet on mobile, centered card on desktop.
 * Closes on X, Esc, and backdrop click — consistently, everywhere.
 * Announced as a labelled dialog and receives focus on open.
 */
export function Modal({ isOpen, onClose, title, subtitle, icon, category, children, footer, maxW = 'sm:max-w-md', featureId, ariaLabel, allowOutsideInteraction = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Move focus into the dialog on open so keyboard/AT users land inside it, and hand it back
  // to whatever opened the dialog on close (e.g. the canvas node that was double-clicked).
  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, [isOpen]);

  // Outside-click close when the backdrop can't receive clicks (see `allowOutsideInteraction`).
  useEffect(() => {
    if (!isOpen || !allowOutsideInteraction) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null;
      // A click INSIDE that re-renders the dialog (e.g. an "add" button whose row then moves to
      // another list) leaves `target` detached by the time this bubbles to the document, and a
      // detached node is never `contains()`-ed by the panel — treating that as "outside" would
      // close the dialog on its own buttons. Only a target still in the document can be outside.
      if (!target || !document.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) onClose();
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [isOpen, allowOutsideInteraction, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[1000] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/30 backdrop-blur-sm ${allowOutsideInteraction ? 'pointer-events-none' : ''}`}
      onClick={allowOutsideInteraction ? undefined : onClose}
      data-feature-id={featureId ?? 'common-modal'}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={allowOutsideInteraction ? undefined : 'true'}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl w-full ${maxW} max-h-[90dvh] flex flex-col shadow-2xl shadow-slate-500/30 overflow-hidden outline-none ${allowOutsideInteraction ? 'pointer-events-auto' : ''}`}
      >
        {/* Grab handle (mobile affordance) */}
        <div className="sm:hidden w-10 h-1 bg-slate-300 rounded-full mx-auto mt-3" />

        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <div className={`w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-xl shrink-0 ${category ? ink(category) : ''}`}>{icon}</div>}
            <div className="min-w-0">
              <h2 id={titleId} className={`leading-tight ${category ? headingClasses(category, 'lg') : 'text-base font-bold text-slate-900'}`}>{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          <Tooltip label="Close (Esc)"><button
            onClick={onClose}
            className="flex flex-col items-center justify-center gap-0.5 min-w-control-lg min-h-control-lg -m-2 text-slate-500 active:bg-slate-200 sm:hover:text-slate-900 rounded-lg transition-colors shrink-0"
            aria-label="Close (Esc)"
          >
            <X size={18} />
            <span className="text-[9px] font-semibold uppercase tracking-wider leading-none text-slate-500">esc</span>
          </button></Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6">
          {children}
        </div>

        {footer && (
          <div className="flex gap-2 px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
