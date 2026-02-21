# FB Marketplace Chat Filter

A browser extension that filters Facebook Marketplace messenger chats by listing name.

## What it does

When you're selling multiple items on Facebook Marketplace and have dozens of chats, this extension makes it easy to organize and filter conversations by the item being sold.

**Features:**
- 📋 **Auto-detect listings** — Scans your thread list and extracts unique listing names
- 🔍 **Quick filter dropdown** — Select a listing to show only conversations about that item
- 🔄 **Auto-scroll loader** — Click "Load More" to automatically scroll and load at least 50 message threads (useful for lazy-loaded lists)
- ♻️ **Refresh button** — Update listings if new chats arrive
- ⏳ **Loading state** — Shows a spinner while threads are being scanned
- 🌙 **Dark mode support** — Adapts to your Facebook theme

**Example:**
- Chat shows: `Nav · 2016 Mazda Mazda3 GX`
- Extension extracts: `2016 Mazda Mazda3 GX`
- Filter dropdown includes: `2016 Mazda Mazda3 GX (3 chats)`

## How it works

The extension injects a filter bar below the "Marketplace" heading in your Messenger sidebar:

```
┌─────────────────────────────────────┐
│ Marketplace                         │
├─────────────────────────────────────┤
│ [All Listings ▼] [↻] [Load More]   │
│ 20 thread(s), 5 listing(s)          │
├─────────────────────────────────────┤
│ Don · 2009 Lexus RX 350             │
│ Nav · 2016 Mazda Mazda3 GX          │
│ ...                                 │
└─────────────────────────────────────┘
```

**Parsing:** Thread names are in the format `FirstName · ItemListing`. The extension splits on the `·` separator to extract the listing name.

**Filtering:** When you select a listing from the dropdown, all other threads are hidden with `display: none`. Select "All Listings" to show everything again.

**Auto-scroll:** The "Load More" button triggers automatic scrolling to the bottom of the thread list, pausing 800ms between scrolls to let Facebook load new conversations. It stops after reaching 50 threads or detecting no new threads were loaded.

**Lazy loading support:** A MutationObserver watches for new threads being added to the DOM and automatically refreshes the listings dropdown.

## Installation

### Chrome (Manifest V3)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the **root folder** of this project (the one containing `manifest.json`, `content.js`, etc.)
5. Navigate to [Facebook Marketplace Messages](https://www.facebook.com/marketplace/)
6. The filter bar will appear below the "Marketplace" heading

**Note:** The extension will show as "Unpacked" and may show a warning about not being from the Chrome Web Store. This is normal for development/local extensions.

### Firefox (Manifest V2)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Navigate to the **root folder** and select **`manifest.firefox.json`**
4. Firefox will ask for permission to access facebook.com — accept it
5. Navigate to [Facebook Marketplace Messages](https://www.facebook.com/marketplace/)
6. The filter bar will appear below the "Marketplace" heading

**Note:** Temporary add-ons are removed when Firefox restarts. To make it permanent, you'd need to sign the extension and have it reviewed by Mozilla (outside the scope of this guide).

## Files

```
├── manifest.json          # Chrome extension config (Manifest V3)
├── manifest.firefox.json  # Firefox extension config (Manifest V2)
├── content.js             # Main filtering logic & UI (shared)
├── styles.css             # Filter bar styling (shared)
├── icon48.png             # Extension icon (48×48px)
├── icon128.png            # Extension icon (128×128px)
└── test/                  # Test page with mock data
    └── index.html
```

Both `manifest.json` and `manifest.firefox.json` reference the same `content.js`, `styles.css`, and icons — there is no duplicated code.

## How the extension finds listings

The extension looks for:
1. Links with `href="/marketplace/t/NUMBER"` (marketplace thread IDs)
2. Within each thread row, a span containing `FirstName · ListingName` format
3. Extracts everything after the `·` separator as the listing name
4. Removes duplicates and sorts alphabetically

## UI Elements

| Element | Purpose |
|---------|---------|
| **Dropdown** | Select a listing to filter by, or "All Listings" to show everything |
| **↻ Button** | Refresh the listings if new chats arrive |
| **Load More** | Auto-scroll to load at least 50 message threads from the lazy-loaded list |
| **Status text** | Shows thread count and unique listing count |

## Troubleshooting

**Filter bar doesn't appear?**
- Make sure you're on the [Facebook Marketplace Messages](https://www.facebook.com/marketplace/) page
- The extension needs a few seconds to scan threads after the page loads
- Try refreshing the page
- Check browser console (F12 → Console) for errors

**"Can't read and change data on this site" (Firefox)?**
- You may have declined the permission prompt
- Go to `about:addons`, find "FB Marketplace Chat Filter"
- Click the extension menu and check "Manage" → "Permissions"
- Make sure it's allowed on `facebook.com`

**Listings not showing?**
- Make sure your chats follow the `Name · Item` format
- If chats are still loading, wait a moment and click the ↻ button
- Use "Load More" to scroll and load more threads

**Dark mode not working?**
- The extension uses Facebook's CSS custom properties for theming
- It should auto-adapt to your Facebook dark mode setting

## Privacy & Permissions

This extension:
- ✅ Only works on `facebook.com/marketplace/*`, `facebook.com/messages/*`, and `messenger.com`
- ✅ Reads only the text visible in your chat list sidebar (thread names and listing titles)
- ✅ Does **not** send data anywhere — all filtering happens locally in your browser
- ✅ Does **not** modify your messages or chats
- ✅ Does **not** track you or store your data

## Browser compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 88+ | ✅ Supported |
| Firefox | 109+ | ✅ Supported (temporary add-on) |
| Safari | — | ❌ Not supported (would need webkit extension API) |
| Edge | 88+ | ✅ Supported (use Chrome version) |

## Tips

- **Bulk delete/archive:** Once you've filtered to a single listing, you can archive multiple chats at once
- **Fast switching:** Filter to a listing, respond to messages, then switch to another listing with one click
- **Load More before replying:** If you know you're missing chats, click "Load More" before starting your workflow
- **Check "Showing X chats":** The status bar tells you how many threads match your current filter

## License

This extension is provided as-is for personal use.

---

**Questions or issues?** Check the troubleshooting section above or refer to the browser's developer tools (F12) to debug.