import React from 'react'

// One toolbar control drives both the thumbnail edge length and the body row
// height, so images can either be scanned at a glance or packed away.
export type ThumbnailSize = 'S' | 'M' | 'L'

export type ThumbnailMetrics = {
  size: ThumbnailSize
  // Edge length of the square thumbnail, in px.
  thumb: number
  // Minimum height every body row is stretched to.
  rowHeight: number
  // Vertical padding on body cells - shrinking this is what actually makes the
  // small setting tight, since the emotion rule sets 0.5rem for every cell.
  cellPaddingY: number
}

export const THUMBNAIL_SIZES: ThumbnailSize[] = ['S', 'M', 'L']

export const THUMBNAIL_METRICS: Record<ThumbnailSize, ThumbnailMetrics> = {
  S: { size: 'S', thumb: 22, rowHeight: 26, cellPaddingY: 1 },
  M: { size: 'M', thumb: 48, rowHeight: 56, cellPaddingY: 4 },
  L: { size: 'L', thumb: 96, rowHeight: 108, cellPaddingY: 6 },
}

const ThumbnailSizeContext = React.createContext<ThumbnailMetrics>(
  THUMBNAIL_METRICS.M,
)

export const useThumbnailMetrics = () => React.useContext(ThumbnailSizeContext)

type Props = {
  size: ThumbnailSize
  children: React.ReactNode
}

export function ThumbnailSizeProvider({ size, children }: Props) {
  const metrics = THUMBNAIL_METRICS[size] ?? THUMBNAIL_METRICS.M

  return (
    <ThumbnailSizeContext.Provider value={metrics}>
      {children}
    </ThumbnailSizeContext.Provider>
  )
}

export default ThumbnailSizeProvider
