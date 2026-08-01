import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outdir: 'public',
  entryNames: 'app',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})
