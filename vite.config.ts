import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function emitWorkerFallback(): Plugin {
  let workerSource = ''
  return {
    name: 'moneyflow-worker-fallback',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const urls = Object.keys(bundle).filter((name) => name !== 'sw.js' && /\.(?:js|css|html|svg|png|woff2|webmanifest)$/.test(name))
      const precache = [...new Set([...urls, 'moneyflow-pwa.svg', 'favicon.svg'])]
      const entries = precache.map((url) => {
        const output = bundle[url]
        const contents = output ? output.type === 'chunk' ? output.code : output.source : readFileSync(new URL(`./public/${url}`, import.meta.url))
        return { url, revision: createHash('sha256').update(contents).digest('hex') }
      })
      workerSource = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8').replace('self.__WB_MANIFEST', JSON.stringify(entries))
      const existingWorker = bundle['sw.js']
      if (existingWorker?.type === 'asset') existingWorker.source = workerSource
      else this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource })
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (workerSource) writeFileSync(new URL('./dist/sw.js', import.meta.url), workerSource)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.js',
    registerType: 'autoUpdate',
    includeManifestIcons: false,
    manifest: {
      name: 'MoneyFlow',
      short_name: 'MoneyFlow',
      description: 'A clear, private view of your personal finances.',
      theme_color: '#0b1a2d',
      background_color: '#06101f',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [{ src: '/moneyflow-pwa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    },
  }), emitWorkerFallback()],
  server: {
    host: '0.0.0.0',
  },
})
