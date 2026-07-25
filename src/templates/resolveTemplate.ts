// Resolve which vertical/template to preload from the URL.
// EXCLUDED from the shared UI import — the shared UI picks the template via its own props.

import { getVertical } from './registry'
import { Vertical } from './types'

/**
 * The vertical id implied by the current URL, or null for the default sheet.
 *
 * Order: `?template=` query param wins (the zero-config local-testing override —
 * `localhost:5173/?template=interior`), then the hostname's first label
 * (`interior.example.com`, or `interior.localhost:5173` which Chrome resolves to
 * loopback with no hosts-file edit). Plain `localhost` / `table.*` → null → default.
 */
export function resolveVerticalId(loc: Location = window.location): string | null {
  const param = new URLSearchParams(loc.search).get('template')
  if (param) return param.trim() || null

  const label = loc.hostname.split('.')[0]
  return label || null
}

export function resolveVertical(loc?: Location): Vertical | null {
  return getVertical(resolveVerticalId(loc)) ?? null
}
