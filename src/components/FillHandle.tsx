import React from 'react'

type Props = {
  onFillStart: (event: React.MouseEvent) => void
  onFillToBottom: () => void
}

// The little square on the bottom-right corner of the selection. Positioned
// with explicit inline styles because the Twind CDN shim is unreliable for
// anything layout critical, and it has to sit half outside its `<td>`.
export const FillHandle: React.FC<Props> = ({ onFillStart, onFillToBottom }) => {
  const handleDoubleClick = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onFillToBottom()
  }

  return (
    <div
      title="Drag to fill in any direction, double-click to fill down to the last visible row"
      onMouseDown={onFillStart}
      onDoubleClick={handleDoubleClick}
      // Selection identity, so the handle is accent, not the old blue. Colour /
      // border are Tailwind; position + size stay inline (it sits half outside
      // its <td>, which the Tailwind grid can't express).
      className="bg-accent-500 border border-white"
      style={{
        position: 'absolute',
        right: '-4px',
        bottom: '-4px',
        width: '8px',
        height: '8px',
        boxSizing: 'border-box',
        cursor: 'crosshair',
        zIndex: 4,
      }}
    />
  )
}

export default FillHandle
