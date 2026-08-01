import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import rollupReplace from '@rollup/plugin-replace'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build'

  return {
    // The docs site serves this app from /demo/, so its asset URLs have to be
    // written for that prefix. Defaults to '/', which is what a local preview
    // and any other host want.
    base: process.env.DEMO_BASE ?? '/',
    server: {
      // Accept custom hostnames so subdomain-based template loading can be
      // tested locally — e.g. http://interior.localhost:5173 (Chrome resolves
      // *.localhost to loopback with no hosts-file edit). Dev server only.
      allowedHosts: true,
    },
    plugins: [
      rollupReplace({
        preventAssignment: true,
        values: {
          // These were pinned to development unconditionally, which shipped the
          // React development build — dev warnings and all — in every
          // production bundle. Follow the actual mode instead.
          __DEV__: JSON.stringify(!isBuild),
          'process.env.NODE_ENV': JSON.stringify(
            isBuild ? 'production' : 'development',
          ),
        },
      }),
      react(),
    ],
  }
})
