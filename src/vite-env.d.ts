/// <reference types="vite/client" />

// Augment Vite's import.meta.env with the app's own variables. VITE_APP_URL is
// the public origin a shared view should open against (empty in dev → we fall
// back to window.location.origin). See getAppUrl() in snapshot.ts.
interface ImportMetaEnv {
  readonly VITE_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
