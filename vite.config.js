import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import rollupReplace from '@rollup/plugin-replace'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Accept custom hostnames so subdomain-based template loading can be tested
    // locally — e.g. http://interior.localhost:5173 (Chrome resolves *.localhost
    // to loopback with no hosts-file edit). Dev server only.
    allowedHosts: true,
  },
  plugins: [
    rollupReplace({
      preventAssignment: true,
      values: {
        __DEV__: JSON.stringify(true),
        'process.env.NODE_ENV': JSON.stringify('development'),
      },
    }),
    react(),
  ],
})
