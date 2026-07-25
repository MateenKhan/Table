import React from 'react'
import { createPortal } from 'react-dom'

type Props = {
  src: string
  name: string
  onClose: () => void
}

// Full-size preview. Portalled to <body> so the scrolling `.table-region`
// cannot clip it, and every layout-critical rule is inline because the Twind
// shim is not dependable for position / z-index / transform.
export function AttachmentLightbox({ src, name, onClose }: Props) {
  const [broken, setBroken] = React.useState(false)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    setBroken(false)
  }, [src])

  // Move focus to the Close button on open, so a keyboard user is inside the
  // overlay and Enter / Esc act on it immediately.
  React.useEffect(() => {
    closeRef.current?.focus()
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Enter or Esc closes the preview from anywhere while it is open (the
      // close button being focused makes Enter a natural confirm too).
      if (event.key !== 'Escape' && event.key !== 'Enter') return
      event.preventDefault()
      // Capture phase + stopPropagation, so the grid's window-level handlers do
      // not also act (clear the selection, re-open the preview) behind the
      // overlay.
      event.stopPropagation()
      onClose()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // The close button is the only focusable element, so trap Tab onto it rather
  // than letting focus escape to the page behind the overlay.
  const onTrapKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    closeRef.current?.focus()
  }

  // React portals still bubble through the React tree, so without this the
  // table's <td> mouse handlers would fire for clicks on the backdrop.
  const swallow = (event: React.SyntheticEvent) => event.stopPropagation()

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onKeyDown={onTrapKeyDown}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
      onMouseUp={swallow}
      onClick={swallow}
      onDoubleClick={swallow}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '3rem 2rem',
      }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        title="Close (Esc)"
        // Shared icon-button, tuned for the dark overlay: white glyph, faint
        // white hover wash (§1 allows a dark modal surface).
        className="icon-btn text-white text-xl sm:hover:bg-white/10"
        style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 1001,
        }}
      >
        ×
      </button>

      {broken ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 'min(60vw, 20rem)',
            height: 'min(40vh, 14rem)',
            border: '1px dashed rgba(255,255,255,0.5)',
            borderRadius: '0.5rem',
            color: 'white',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          This image could not be loaded.
        </div>
      ) : (
        <img
          src={src}
          alt={name}
          onError={() => setBroken(true)}
          className="rounded-lg bg-white"
          style={{
            maxWidth: '92vw',
            maxHeight: '80vh',
            objectFit: 'contain',
            boxShadow: '0 1.25rem 3rem rgba(0,0,0,0.55)',
          }}
        />
      )}

      <div
        style={{
          color: 'white',
          fontSize: '0.875rem',
          maxWidth: '80vw',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
    </div>,
    document.body,
  )
}

export default AttachmentLightbox
