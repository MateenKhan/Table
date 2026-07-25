/** @type {import('tailwindcss').Config} */
//
// Tokens here mirror piranha's theme layer (ui/src/theme/theme.json) so this
// table drops into that app unchanged: the same class names (bg-white,
// border-slate-200, rounded-lg, accent-500, min-h-control, sm:hover:...) resolve
// to the same visuals in both places. See ui-rules.md §2/§3/§7/§16.
//
// `extend`, not a replacement — Tailwind's own slate-*/rose-*/emerald-* scales
// survive underneath, which is what keeps the existing utility classes working.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark is an explicit attribute, never the OS preference — piranha is light by
  // default (§1). We don't ship a dark toggle here, but the selector matches
  // piranha so a dark preset would behave identically once imported.
  darkMode: ['selector', '[data-theme-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        // The brand ramp — #ff3b1d at 500. Tier-1 identity ONLY (logo, active
        // tab, links, focus accents, selection), never a routine button (§2).
        accent: {
          50: '#fff1ee',
          100: '#ffe0d9',
          200: '#ffc2b3',
          300: '#ff9a83',
          400: '#ff6a4d',
          500: '#ff3b1d',
          600: '#e62e12',
          700: '#bf2410',
          800: '#991f13',
          900: '#7e1d15',
          950: '#450a05',
        },
        // ── Semantic category tokens for the VENDORED piranha components ──────
        // (src/piranha/*: semanticColors.ts / SectionHeading / Modal). Those
        // files emit literal classes like `text-work-ink`, `bg-data-subtle`,
        // `border-agent-border`; without these keys those classes are no-ops.
        // Each category gets ink/subtle/border → `text-<c>-ink`,
        // `bg-<c>-subtle`, `border-<c>-border` (and `bg-<c>-ink` for dots).
        // Hexes are standard Tailwind palette steps (ink=700, subtle=50,
        // border=200) chosen only so the class NAMES resolve — piranha's real
        // theme.json values apply at import. DELETE this block at import time.
        work: { ink: '#0369a1', subtle: '#f0f9ff', border: '#bae6fd' },      // sky
        data: { ink: '#4338ca', subtle: '#eef2ff', border: '#c7d2fe' },      // indigo
        design: { ink: '#a21caf', subtle: '#fdf4ff', border: '#f5d0fe' },    // fuchsia
        code: { ink: '#0e7490', subtle: '#ecfeff', border: '#a5f3fc' },      // cyan
        agent: { ink: '#6d28d9', subtle: '#f5f3ff', border: '#ddd6fe' },     // violet
        run: { ink: '#047857', subtle: '#ecfdf5', border: '#a7f3d0' },       // emerald
        cost: { ink: '#0f766e', subtle: '#f0fdfa', border: '#99f6e4' },      // teal
        attention: { ink: '#b45309', subtle: '#fffbeb', border: '#fde68a' }, // amber
        danger: { ink: '#be123c', subtle: '#fff1f2', border: '#fecdd3' },    // rose
        success: { ink: '#047857', subtle: '#ecfdf5', border: '#a7f3d0' },   // emerald
        warning: { ink: '#b45309', subtle: '#fffbeb', border: '#fde68a' },   // amber
        neutral: { ink: '#334155', subtle: '#f8fafc', border: '#e2e8f0' },   // slate
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          'Roboto',
          "'Helvetica Neue'",
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          "'Liberation Mono'",
          'monospace',
        ],
      },
      // Named steps replace ad-hoc text-[10px]/text-[11px] (§3).
      fontSize: {
        micro: ['10px', '14px'],
        '2xs': ['11px', '16px'],
      },
      // Canonical control sizes, both square (§7): control 36px (pointer),
      // control-lg 44px (HIG touch minimum). Reach for min-h-control / w-control
      // rather than a hand-picked min-h-[Npx].
      spacing: {
        control: '36px',
        'control-lg': '44px',
      },
      minHeight: {
        control: '36px',
        'control-lg': '44px',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        entrance: 'cubic-bezier(0, 0, 0, 1)',
        exit: 'cubic-bezier(0.3, 0, 1, 1)',
        emphasized: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        normal: '200ms',
        slow: '320ms',
      },
    },
  },
  plugins: [],
}
