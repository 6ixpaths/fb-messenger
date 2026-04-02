import { defineConfig, build as viteBuild } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import fs from 'fs'
import path from 'path'

const browser = process.env.BROWSER || 'chrome'
const outDir = browser === 'firefox' ? 'dist-firefox' : 'dist-chrome'

// Custom plugin for Firefox MV2
const firefoxPlugin = {
  name: 'firefox-mv2',
  enforce: 'post',
  writeBundle() {
    const { default: manifest } = require('./manifest.firefox.js')

    // Write manifest.json for Firefox
    fs.writeFileSync(
      path.join(outDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    )

    // Copy styles.css for Firefox
    fs.copyFileSync('src/styles.css', path.join(outDir, 'styles.css'))

  },
  async closeBundle() {
    // Build openlane.js as a separate IIFE bundle
    await viteBuild({
      configFile: false,
      build: {
        outDir,
        emptyOutDir: false,
        rollupOptions: {
          input: 'src/openlane.js',
          output: {
            dir: outDir,
            entryFileNames: 'openlane.js',
            format: 'iife',
          },
        },
      },
    })
  },
}

export default defineConfig(async () => {
  const plugins = []

  if (browser === 'chrome') {
    const { default: manifest } = await import('./manifest.chrome.js')
    plugins.push(crx({ manifest }))

    // Dev-only: when content.js or styles.css change, send a custom HMR event
    // so the background service worker can reload matching tabs.
    // (CRXJS only restarts the SW — firing `activate` — when background.js itself
    // changes; content script changes go through a different hot-update path.)
    plugins.push({
      name: 'content-script-tab-reloader',
      apply: 'serve',
      handleHotUpdate({ file, server }) {
        if (file.includes('/src/content') || file.includes('/src/styles')) {
          server.ws.send({ type: 'custom', event: 'reload-tabs', data: {} })
        }
      },
    })
  } else {
    plugins.push(firefoxPlugin)
  }

  return {
    plugins,
    build: {
      outDir,
      rollupOptions: browser === 'firefox' ? {
        input: 'src/content.js',
        output: {
          dir: outDir,
          entryFileNames: 'content.js',
          format: 'iife',
        },
      } : undefined,
    },
    server: {
      cors: {
        origin: [
          /chrome-extension:\/\//,
          /moz-extension:\/\//,
        ],
      },
    },
  }
})
