// Theming plumbing: the per-part `classNames` map a consumer passes to
// <SpreadsheetTable classNames={{ ... }} />. Portalled surfaces (tooltip,
// popup, toast, lightbox) live outside the grid's DOM subtree, so they can't
// read a class off an ancestor — they pull their extra class from this context
// instead. This is ONE of the three theming channels; the other two need no JS:
//   • CSS variables  — recolor via `--jt-*` (see index.css for the full list).
//   • data-jt attrs  — every surface carries `data-jt="<part>"`, so plain CSS
//                       like `[data-jt="tooltip"]{…}` restyles it anywhere,
//                       including the portalled ones. See the README theming
//                       section for the copy-paste recipes.

import React from 'react'

/** The stable set of styleable surfaces. Each also carries `data-jt="<part>"`. */
export type TablePart =
  | 'root'
  | 'toolbar'
  | 'tooltip'
  | 'popup'
  | 'toast'
  | 'lightbox'

/** Consumer-supplied extra classes, merged onto each part's own classes. */
export type TableClassNames = Partial<Record<TablePart, string>>

const EMPTY: TableClassNames = {}

const ClassNamesCtx = React.createContext<TableClassNames>(EMPTY)

export function TableThemeProvider({
  classNames,
  children,
}: {
  classNames?: TableClassNames
  children: React.ReactNode
}) {
  return (
    <ClassNamesCtx.Provider value={classNames ?? EMPTY}>
      {children}
    </ClassNamesCtx.Provider>
  )
}

/** The consumer's extra class for a part (or '' when none), ready to append. */
export function usePartClass(part: TablePart): string {
  return React.useContext(ClassNamesCtx)[part] ?? ''
}
