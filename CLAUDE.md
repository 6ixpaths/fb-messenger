# FB Marketplace Chat Filter — CLAUDE.md

## Project Overview

A browser extension (Chrome MV3 + Firefox MV2) that injects a filter dropdown into the
Facebook Messenger/Marketplace chat sidebar. The dropdown is populated exclusively from
listings scraped off the user's own selling page, letting them filter chats by listing name.

## File Structure

```
fb-messenger/
├── content.js              # All extension logic (single content script)
├── styles.css              # Injected CSS for the filter bar
├── manifest.json           # Chrome MV3 manifest
├── manifest.firefox.json   # Firefox MV2 manifest (used when building for Firefox)
├── icon48.png
├── icon128.png
└── test/
    └── index.html          # Local test page (no extension APIs needed)
```

## User Flow

1. User opens the Facebook Messenger/chat page → sees "Filters inactive — Open your selling
   page to load listings." with a clickable link.
2. User opens their selling page (`/marketplace/you/selling`) — same tab or new tab.
3. The content script scrapes listing names from that page and stores them in
   `chrome.storage.local`.  A blue badge briefly appears confirming the count.
4. The chat page activates the dropdown (immediately via `storage.onChanged` on Chrome;
   within ~1.5 s via heartbeat polling on Firefox).
5. User selects a listing from the dropdown → chats are shown/hidden instantly, no scrolling.

## Architecture

### content.js (single IIFE, no build step)

Key sections in order:

| Section | Purpose |
|---|---|
| Constants / SELECTORS | CSS selectors for FB DOM elements; ACTION_PREFIXES to strip action buttons |
| State | Module-level flags (`sellingPageVisitedThisSession`, `storedSellingListings`, etc.) |
| `_storage` resolver | Returns `browser.storage.local`, `chrome.storage.local`, or a `window.sessionStorage` shim for the test page |
| `markSellingPageVisited()` | URL-based (no DOM needed); idempotent; writes timestamp to `_storage` |
| `tryScrapeSellingPage()` | DOM-based scraper; runs on heartbeat until selling-page DOM is hydrated |
| `captureOpenChatListing()` | Detects selling/buying role from the open chat panel; supplements stored data |
| `buildSellSetLower()` | Returns lowercased Set of selling names; `null` if session flag not set |
| `getUniqueListings()` | Intersects thread listings with stored selling names → dropdown options |
| `applyFilter(listing)` | Shows/hides thread rows in the chat grid |
| `createFilterUI()` | Injects filter bar + status element into the thread list |
| `refreshListings()` | Rebuilds dropdown options; toggles info vs dropdown |
| `init()` | Reads stored data + session flag in parallel; calls `tryInject()` |
| `storage.onChanged` listener | Cross-tab activation for Chrome |
| Heartbeat (`setInterval`) | Scrapes selling page + polls session flag every 1.5 s (Firefox cross-tab fix) |
| URL observer | SPA navigation detection; resets scrape state; re-checks session flag |

### Storage Schema

Two keys in `chrome.storage.local`:

```json
// STORAGE_KEY = "mp_filter_listings_v1"
{
  "selling": [{ "name": "My Listing Title", "listedOn": "2/9" }],
  "buying":  ["Some item I'm buying"],
  "savedAt": 1700000000000
}

// SESSION_FLAG_KEY = "mp_filter_session_v1"
1700000000000   // Unix timestamp (ms); 8-hour TTL gates the dropdown
```

### Session Flag Logic

`chrome.storage.session` is **not** reliably accessible from content scripts in either
browser. Instead, a `Date.now()` timestamp is stored in `chrome.storage.local` with an
8-hour TTL, approximating "browser session" semantics.

The flag gates `buildSellSetLower()` and `refreshListings()` so the dropdown never
auto-populates from stale data — the user must visit the selling page each session.

Three paths restore the flag in a chat-page tab:
1. `init()` — reads and checks TTL on page load / extension install.
2. `storage.onChanged` ("local" area) — fires immediately in Chrome when another tab sets it.
3. Heartbeat poll — fires every 1.5 s in Firefox (where `storage.onChanged` does not fire in
   content scripts).

## Facebook DOM Selectors (may break with FB updates)

| Selector | Purpose |
|---|---|
| `div[aria-label="Thread list"]` | Container for the whole chat sidebar |
| `div[aria-label="Chats"][role="grid"]` | The scrollable list of threads |
| `a[href*="/marketplace/t/"]` | Individual thread links |
| `span.x1lliihq.x193iq5w…` | Thread title span (contains "Name · Listing Title") |
| `div[aria-label="Collection of your marketplace items"][role="main"]` | Selling page container |
| `div[role="button"][aria-label]` | Listing cards on selling page |

If the extension stops working, the most likely cause is Facebook changing one of these
selectors. Check the browser console for `[MP Filter]` log lines to diagnose.

## Test Page (`test/index.html`)

- Set `data-mp-filter-test="true"` on `<html>` to enable test mode.
- In test mode, `isSellingPage()` matches `/marketplace/you/selling` paths; all other paths
  act as messaging pages.
- `_storage` falls back to a `window.sessionStorage` shim so storage calls work without
  the extension API.
- Load by opening the file directly in a browser — no server needed.

## Loading the Extension

### Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this directory
4. After any code change: click the **↺** reload icon on the extension card

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** → select `manifest.firefox.json`
3. After any code change: click **Reload** on the extension card

> **Note:** Firefox uses `manifest.firefox.json` (MV2). Chrome uses `manifest.json` (MV3).
> Firefox temporary add-ons are removed when the browser restarts.

## Development Notes

- **No build step.** `content.js` is a plain IIFE; edit and reload.
- **Debounce.** The MutationObserver on the chat grid debounces at 300 ms to avoid
  redundant re-renders while threads lazy-load.
- **`captureOpenChatListing()`** supplements storage with any open-chat selling listings
  the scraper may have missed (e.g., sold items no longer on the selling page). It does
  **not** add thread-parsed listings to the dropdown unless they also appear in stored
  selling data.
- **`getUniqueListings()`** intersects thread names with stored selling names — the
  dropdown never shows thread names that aren't in the stored selling list.
- **`normalizeSelling(arr)`** converts legacy `string` entries in storage to
  `{ name, listedOn: null }` objects for backward compatibility.
- **ACTION_PREFIXES** must stay in sync with Facebook's aria-label patterns for selling-page
  action buttons (e.g., "Mark as sold ", "Share ", "More options for ").
