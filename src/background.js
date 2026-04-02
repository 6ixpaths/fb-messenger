// Background service worker
//
// The `activate` event fires on every service worker startup — including after
// CRXJS triggers chrome.runtime.reload() on each HMR cycle. We use it to
// reload any open tabs that have the content script injected.

const CONTENT_SCRIPT_HOSTS = [
  'facebook.com/marketplace',
  'facebook.com/messages',
  'messenger.com/marketplace/',
]

function reloadMatchingTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && CONTENT_SCRIPT_HOSTS.some((h) => tab.url.includes(h))) {
          chrome.tabs.reload(tab.id)
        }
      }
      resolve()
    })
  })
}

// Handle download requests from content scripts (bypasses CSP blob: restrictions)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'download' && msg.url && msg.filename) {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename,
      saveAs: false,
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[OL Downloader] Download failed:', chrome.runtime.lastError)
      } else {
        console.log('[OL Downloader] Download started:', downloadId)
      }
    })
    sendResponse({ ok: true })
  }
})

self.addEventListener('activate', (event) => {
  console.log('[MP Filter] SW activate → reloading tabs')
  event.waitUntil(reloadMatchingTabs())
})

// During development, CRXJS only restarts the service worker when background.js
// itself changes (which fires `activate`). Changes to content.js go through a
// separate hot-update path and do NOT restart the SW.
//
// To cover that case we listen for the custom 'reload-tabs' event that
// vite.config.js emits via `server.ws.send()` on every content.js / styles.css
// hot update.  `import.meta.hot` is `undefined` in production builds so this
// block is dead-code-eliminated by Rollup.
if (import.meta.hot) {
  import.meta.hot.on('reload-tabs', () => {
    console.log('[MP Filter] content-script HMR → reloading tabs')
    reloadMatchingTabs()
  })
}
