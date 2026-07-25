// Repointed to the VENDORED piranha Tooltip (src/piranha/Tooltip.tsx) so the
// table shares piranha's real tooltip with zero divergent code. Piranha's
// Tooltip takes a single `label` string (no `explanation`/`shortcut`/`delay`);
// call sites fold any shortcut into the label. At import into piranha, delete
// src/piranha/ and repoint importers at piranha's own Tooltip module.
export { Tooltip, default } from '../piranha/Tooltip'
