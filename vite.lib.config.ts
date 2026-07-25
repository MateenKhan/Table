import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import rollupReplace from '@rollup/plugin-replace'
import dts from 'vite-plugin-dts'

// Library build for `@jugaaadi/table` (separate from the demo-app `vite.config.js`).
// Emits an ESM bundle of THIS project's source only — React and every runtime
// dependency are marked external so npm resolves them from the consumer. Also
// emits the compiled stylesheet (dist/style.css) and bundled types (index.d.ts).

// Runtime deps + React are external: the consumer already has (or installs) them.
const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@tanstack/react-table',
  '@tanstack/match-sorter-utils',
  'framer-motion',
  'lucide-react',
  'react-colorful',
  'react-day-picker',
  'react-dropzone',
  'lz-string',
  'date-fns',
]

export default defineConfig({
  plugins: [
    rollupReplace({
      preventAssignment: true,
      values: {
        __DEV__: JSON.stringify(false),
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src'],
      // Ship only real types — no test harnesses or the demo entry point.
      exclude: ['src/**/*.test.ts', 'src/main.tsx'],
    }),
  ],
  build: {
    lib: {
      entry: 'src/lib.tsx',
      formats: ['es'],
      fileName: 'table',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: (id) =>
        external.includes(id) ||
        external.some((dep) => id.startsWith(`${dep}/`)),
    },
    emptyOutDir: true,
  },
})
