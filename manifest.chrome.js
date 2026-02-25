import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  name: mode === 'development' ? 'FB MARKETPLACE DEV' : 'FB Marketplace Chat Filter',
  version: '1.0.0',
  description: 'Filter chats',
  permissions: ["storage"],
  host_permissions: [
    "https://www.facebook.com/*",
    "https://www.messenger.com/*"
  ],
  content_scripts: [
    {
      matches: [
        "https://www.facebook.com/marketplace/*",
        "https://www.facebook.com/messages/*",
        "https://www.messenger.com/*"
      ],
      js: ["src/content.js"],
      run_at: "document_idle"
    }
  ],
  // Allow the CRXJS HMR service worker to load scripts from the Vite dev server
  ...(mode === 'development' && {
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval' http://localhost:* http://127.0.0.1:*; object-src 'self'"
    }
  }),
}))
