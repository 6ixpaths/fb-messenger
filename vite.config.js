import { defineConfig } from 'vite'
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
}

export default defineConfig(async () => {
  const plugins = []

  if (browser === 'chrome') {
    const { default: manifest } = await import('./manifest.chrome.js')
    plugins.push(crx({ manifest }))
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
