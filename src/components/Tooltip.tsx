// Repointed to the VENDORED the shared UI Tooltip (src/ui/Tooltip.tsx) so the
// table shares the shared UI's real tooltip with zero divergent code. the shared UI's
// Tooltip takes a single `label` string (no `explanation`/`shortcut`/`delay`);
// call sites fold any shortcut into the label. At import into the shared UI, delete
// src/ui/ and repoint importers at the shared UI's own Tooltip module.
export { Tooltip, default } from '../ui/Tooltip'
