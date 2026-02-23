(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────────

  const SELECTORS = {
    threadList: 'div[aria-label="Thread list"]',
    chatGrid: 'div[aria-label="Chats"][role="grid"]',
    threadLink: 'a[href*="/marketplace/t/"]',
    threadName: "span.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft",
    sellingPageMain:
      'div[aria-label="Collection of your marketplace items"][role="main"]',
    sellingPageBtn: 'div[role="button"][aria-label]',
  };

  // Aria-label prefixes used by action buttons on the selling page.
  // These are NOT listing names and must be filtered out during scraping.
  const ACTION_PREFIXES = [
    "Mark as sold ",
    "Share ",
    "More options for ",
    "View insights for ",
    "Boost listings for ",
    "Boost listing for ",
  ];

  const SEPARATOR = " \u00b7 "; // " · "
  const STORAGE_KEY = "mp_filter_listings_v1";
  // Stored in chrome.storage.local with a timestamp; 8-hour TTL approximates
  // "browser session" semantics without requiring chrome.storage.session
  // (which is not reliably accessible from content scripts).
  const SESSION_FLAG_KEY = "mp_filter_session_v1";

  // ── State ──────────────────────────────────────────────────────────────

  let filterContainer = null;
  let currentFilter = null;
  let debounceTimer = null;
  let isLoading = false;
  let isObserving = false;
  let hasScrapedSellingPage = false;

  // True only after tryScrapeSellingPage() succeeds in this content-script
  // instance.  Resets to false on every new page load / new tab.  This gates
  // all filter behaviour so the dropdown never auto-populates from previously
  // stored data — the user must visit the selling page each session first.
  let sellingPageVisitedThisSession = false;

  // null  = not loaded yet
  // []    = loaded, nothing stored
  // [...]  = loaded, selling listings available as { name, listedOn } objects
  let storedSellingListings = null;

  // ── Cross-browser storage ──────────────────────────────────────────────

  // Resolves to chrome.storage.local, browser.storage.local, or a
  // sessionStorage shim for the local test page (single-tab, no extension API).
  // Local storage persists across browser sessions and is shared across all
  // tabs, so listings scraped on the selling page are immediately available in
  // any messenger tab.  The dropdown only populates after the user visits the
  // selling page — it never auto-loads listings from thread names.
  const _storage = (() => {
    try {
      if (typeof browser !== "undefined" && browser.storage?.local)
        return browser.storage.local;
    } catch (_) {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local)
        return chrome.storage.local;
    } catch (_) {}
    // Test-page / older-browser shim
    const P = "__mpf_";
    return {
      get: (key) => {
        try {
          return Promise.resolve({
            [key]: JSON.parse(sessionStorage.getItem(P + key) || "null"),
          });
        } catch {
          return Promise.resolve({ [key]: null });
        }
      },
      set: (obj) => {
        Object.entries(obj).forEach(([k, v]) => {
          try { sessionStorage.setItem(P + k, JSON.stringify(v)); } catch (_) {}
        });
        return Promise.resolve();
      },
    };
  })();

  async function persistListings({ selling, buying }) {
    try {
      await _storage.set({ [STORAGE_KEY]: { selling, buying, savedAt: Date.now() } });
    } catch (e) {
      console.warn("[MP Filter] Could not persist listings:", e);
    }
  }

  async function readPersistedListings() {
    try {
      const result = await _storage.get(STORAGE_KEY);
      return result[STORAGE_KEY] || { selling: [], buying: [] };
    } catch {
      return { selling: [], buying: [] };
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Converts legacy string entries in the selling array to
   * { name, listedOn: null } objects, for backward compatibility.
   */
  function normalizeSelling(arr) {
    if (!arr) return [];
    return arr.map((e) =>
      typeof e === "string" ? { name: e, listedOn: null } : e
    );
  }

  // ── Page detection ─────────────────────────────────────────────────────

  const IS_TEST = document.documentElement.dataset.mpFilterTest === "true";

  function isSellingPage() {
    const { hostname, pathname } = location;
    return (
      (hostname === "www.facebook.com" || IS_TEST) &&
      pathname.startsWith("/marketplace/you/selling")
    );
  }

  function isMessagingPage() {
    const { hostname, pathname } = location;
    // In test mode, act as messaging page for all paths EXCEPT the mock selling page
    if (IS_TEST) return !pathname.startsWith("/marketplace/you/selling");
    return (
      hostname === "www.messenger.com" ||
      (hostname === "www.facebook.com" && pathname.startsWith("/messages/"))
    );
  }

  // ── Session activation ─────────────────────────────────────────────────

  /**
   * Marks the selling page as visited for this browser session.
   * Called on URL detection — does NOT require the selling-page DOM to be
   * hydrated — so it succeeds even if the scraper hasn't run yet.
   * Idempotent: safe to call multiple times.
   */
  function markSellingPageVisited() {
    if (sellingPageVisitedThisSession) return;
    sellingPageVisitedThisSession = true;
    // Persist a timestamp so other tabs and page refreshes can restore the flag.
    // Uses chrome.storage.local — definitively accessible from all content scripts.
    _storage.set({ [SESSION_FLAG_KEY]: Date.now() }).catch(() => {});
    console.log("[MP Filter] Selling page detected — session flag set.");
  }

  // ── Selling-page scraper ───────────────────────────────────────────────

  /**
   * Runs once when listing cards are present on /marketplace/you/selling.
   *
   * The selling page renders listing cards as:
   *   <div role="main" aria-label="Collection of your marketplace items">
   *     <div role="button" aria-label="2016 Mazda Mazda3 GX">   ← listing card
   *       ... contains "Listed on 2/9" as a text node ...
   *     <div role="button" aria-label="Mark as sold 2016 Mazda Mazda3 GX">  ← action btn
   *
   * We grab every div[role="button"][aria-label] inside the main container,
   * filter out action-button prefixes, extract "Listed on X/Y" from each card,
   * de-duplicate, and persist to storage.
   */
  async function tryScrapeSellingPage() {
    if (hasScrapedSellingPage) return;

    const main = document.querySelector(SELECTORS.sellingPageMain);
    if (!main) return; // page not hydrated yet

    const buttons = main.querySelectorAll(SELECTORS.sellingPageBtn);
    if (buttons.length === 0) return; // cards not rendered yet

    hasScrapedSellingPage = true;
    markSellingPageVisited(); // idempotent — may already be set via URL detection

    const listingMap = new Map(); // name (string) → listedOn (string|null)

    for (const btn of buttons) {
      const label = (btn.getAttribute("aria-label") || "").trim();
      if (label.length <= 2) continue;
      if (ACTION_PREFIXES.some((p) => label.startsWith(p))) continue;

      if (!listingMap.has(label)) {
        // "Listed on 2/9" or "Listed on 12/17/2025" appears as a text node
        // directly inside a span, so btn.textContent captures it reliably.
        const m = btn.textContent.match(/Listed on (\d+\/\d+(?:\/\d+)?)/);
        listingMap.set(label, m ? m[1] : null);
      }
    }

    const selling = Array.from(listingMap.entries()).map(([name, listedOn]) => ({
      name,
      listedOn,
    }));
    storedSellingListings = selling;

    // Merge buying listings we may have captured via open-chat detection
    const existing = await readPersistedListings();
    await persistListings({ selling, buying: existing.buying || [] });

    console.log(
      `[MP Filter] Scraped ${selling.length} selling listing(s):`,
      selling
    );

    showSellingPageBadge(selling.length);
  }

  /** Brief confirmation badge injected on the selling page after scraping. */
  function showSellingPageBadge(count) {
    if (document.getElementById("mp-filter-badge")) return;
    const badge = document.createElement("div");
    badge.id = "mp-filter-badge";
    badge.textContent = `✓ Marketplace Filter: ${count} listing(s) saved`;
    Object.assign(badge.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "#1877f2",
      color: "#fff",
      padding: "9px 16px",
      borderRadius: "20px",
      fontSize: "13px",
      fontFamily: "Segoe UI, Helvetica, Arial, sans-serif",
      zIndex: "99999",
      boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
      pointerEvents: "none",
    });
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 4000);
  }

  // ── Open-chat role detector ────────────────────────────────────────────

  /**
   * Inspects the active chat panel for the "View buyer profile" or
   * "View seller profile" link that Facebook Marketplace injects.
   *
   * "View buyer profile" → the current user is the SELLER.
   * "View seller profile" → the current user is the BUYER.
   *
   * Returns 'selling' | 'buying' | null (undetermined / non-marketplace chat).
   */
  function getOpenChatRole() {
    const panels = document.querySelectorAll('[role="presentation"]');
    for (const panel of panels) {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.children.length > 0) continue; // leaf text nodes only
        const text = node.textContent.trim();
        if (text === "View buyer profile") return "selling";
        if (text === "View seller profile") return "buying";
      }
    }
    return null;
  }

  /**
   * When a chat is open, call this to capture its role (selling/buying) and
   * store the listing name appropriately.  Updates storage so the messenger
   * filter stays accurate even without a selling-page visit.
   */
  async function captureOpenChatListing() {
    const role = getOpenChatRole();
    if (!role) return;

    // Find the listing name from the active (highlighted) thread row
    const activeLink = document.querySelector(
      [
        `${SELECTORS.threadLink}[aria-current="page"]`,
        `${SELECTORS.threadLink}[aria-selected="true"]`,
        `${SELECTORS.threadLink}[aria-current="true"]`,
      ].join(", ")
    );
    if (!activeLink) return;

    const row = activeLink.closest('div[role="row"]');
    if (!row) return;

    const listing = extractListingName(parseThreadName({ row }));
    if (!listing) return;

    const stored = await readPersistedListings();

    // Build a map from lowercase name → existing entry (preserving listedOn)
    const sellingMap = new Map(
      normalizeSelling(stored.selling).map((e) => [e.name.toLowerCase(), e])
    );
    const buying = new Set(stored.buying || []);

    if (role === "selling") {
      // Only add if not already known (preserve any listedOn from scrape)
      if (!sellingMap.has(listing.toLowerCase())) {
        sellingMap.set(listing.toLowerCase(), { name: listing, listedOn: null });
      }
      buying.delete(listing);
    } else {
      sellingMap.delete(listing.toLowerCase());
      buying.add(listing);
    }

    const newSelling = Array.from(sellingMap.values());
    const newBuying = Array.from(buying);

    await persistListings({ selling: newSelling, buying: newBuying });

    // Update in-memory state if the listing is new (case-insensitive check)
    if (role === "selling") {
      const alreadyKnown =
        storedSellingListings !== null &&
        storedSellingListings.some(
          (s) => s.name.toLowerCase() === listing.toLowerCase()
        );
      if (!alreadyKnown) {
        storedSellingListings = newSelling;
        refreshListings();
      }
    }

    console.log(`[MP Filter] Open chat: ${role} — "${listing}"`);
  }

  // ── Thread parsing ─────────────────────────────────────────────────────

  /**
   * Structural fallback: find the "Buying" section divider inside the grid.
   * Used only when no stored selling listings are available.
   */
  function findBuyingBoundary(grid) {
    const walker = document.createTreeWalker(grid, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.children.length > 0) continue;
      const text = node.textContent.trim();
      if (/^Buying(\s*\(\d+\))?$/.test(text)) return node;
    }
    return null;
  }

  /**
   * Returns all { row, link } pairs from the chat grid.
   * When no stored listing data exists, threads that appear after the
   * "Buying" section divider are excluded via compareDocumentPosition.
   */
  function getThreadItems() {
    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid) return [];

    // Use DOM boundary only as a structural fallback
    const buyingBoundary =
      !storedSellingListings || storedSellingListings.length === 0
        ? findBuyingBoundary(grid)
        : null;

    const links = grid.querySelectorAll(SELECTORS.threadLink);
    const items = [];
    const seen = new Set();

    for (const link of links) {
      const row = link.closest('div[role="row"]');
      if (!row || seen.has(row)) continue;
      seen.add(row);

      if (buyingBoundary) {
        // DOCUMENT_POSITION_FOLLOWING means the boundary comes AFTER the row → selling ✓
        const pos = row.compareDocumentPosition(buyingBoundary);
        if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      }

      items.push({ row, link });
    }
    return items;
  }

  function parseThreadName(item) {
    const spans = item.row.querySelectorAll(SELECTORS.threadName);
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text.includes(SEPARATOR)) return text;
    }
    return null;
  }

  function extractListingName(fullName) {
    if (!fullName) return null;
    const idx = fullName.indexOf(SEPARATOR);
    return idx === -1 ? null : fullName.substring(idx + SEPARATOR.length).trim();
  }

  /**
   * Builds a Set of lowercased selling listing names for case-insensitive
   * comparison.  Returns null when no selling data is available.
   */
  function buildSellSetLower() {
    if (!sellingPageVisitedThisSession) return null;
    if (!storedSellingListings || storedSellingListings.length === 0) return null;
    return new Set(storedSellingListings.map((l) => l.name.toLowerCase()));
  }

  /**
   * Returns sorted unique listing names (strings) for the SELLING side only.
   *
   * The dropdown STRICTLY shows only selling listings:
   *   - When stored selling data exists → intersect thread listings with
   *     stored selling names (case-insensitive comparison).
   *   - When no selling data exists → return empty array (the UI will
   *     prompt the user to visit the selling page).
   */
  function getUniqueListings() {
    const items = getThreadItems();
    const allInThreads = new Set();
    for (const item of items) {
      const listing = extractListingName(parseThreadName(item));
      if (listing) allInThreads.add(listing);
    }

    const sellSetLower = buildSellSetLower();
    if (sellSetLower) {
      return Array.from(allInThreads)
        .filter((l) => sellSetLower.has(l.toLowerCase()))
        .sort();
    }

    // No stored selling data — return empty so the UI shows a prompt
    return [];
  }

  /**
   * Returns listing names from threads that are NOT in storedSellingListings.
   * Captured for future "Buying" features.  Uses case-insensitive comparison.
   */
  function getBuyingListingsFromThreads() {
    const sellSetLower = buildSellSetLower();
    if (!sellSetLower) return [];
    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid) return [];

    const links = grid.querySelectorAll(SELECTORS.threadLink);
    const buying = new Set();
    const seen = new Set();

    for (const link of links) {
      const row = link.closest('div[role="row"]');
      if (!row || seen.has(row)) continue;
      seen.add(row);
      const listing = extractListingName(parseThreadName({ row }));
      if (listing && !sellSetLower.has(listing.toLowerCase())) buying.add(listing);
    }
    return Array.from(buying).sort();
  }

  // ── Filtering ──────────────────────────────────────────────────────────

  function applyFilter(listing) {
    currentFilter = listing;

    const sellSetLower = buildSellSetLower();

    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid) return;

    const links = grid.querySelectorAll(SELECTORS.threadLink);
    const seen = new Set();
    let visibleCount = 0;

    for (const link of links) {
      const row = link.closest('div[role="row"]');
      if (!row || seen.has(row)) continue;
      seen.add(row);

      const rowListing = extractListingName(parseThreadName({ row }));
      let shouldShow;

      if (listing) {
        // Specific listing selected: case-insensitive match
        shouldShow =
          !!rowListing &&
          rowListing.toLowerCase() === listing.toLowerCase();
      } else if (sellSetLower) {
        // "All Listings" with stored data: show only selling threads
        shouldShow =
          !!(rowListing && sellSetLower.has(rowListing.toLowerCase()));
      } else {
        // No stored data: show everything (DOM boundary handled in getThreadItems)
        shouldShow = true;
      }

      row.style.display = shouldShow ? "" : "none";
      if (shouldShow) visibleCount++;
    }

    if (listing) {
      updateStatus(`Showing ${visibleCount} chat(s) for "${listing}"`);
    } else {
      updateStatus(
        sellSetLower
          ? `Showing ${visibleCount} selling chat(s)`
          : `Showing all ${visibleCount} chat(s)`
      );
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────

  function createFilterUI(threadList) {
    if (document.getElementById("mp-chat-filter")) return;

    isLoading = true;
    filterContainer = document.createElement("div");
    filterContainer.id = "mp-chat-filter";
    filterContainer.setAttribute("data-loading", "true");

    // ── Info element: shown when no selling data has been loaded yet ──
    const info = document.createElement("span");
    info.id = "mp-chat-filter-info";
    const infoLink = document.createElement("a");
    infoLink.id = "mp-chat-filter-info-link";
    infoLink.href =
      "https://www.facebook.com/marketplace/you/selling?state=LIVE&status%5B0%5D=IN_STOCK";
    infoLink.target = "_blank";
    infoLink.rel = "noopener noreferrer";
    infoLink.textContent = "Open your selling page";
    info.append("Filters inactive — ", infoLink, " to load listings.");

    // ── Dropdown: shown only when selling data is available ──
    const select = document.createElement("select");
    select.id = "mp-chat-filter-select";
    select.disabled = true;
    select.style.display = "none"; // hidden until selling data is loaded
    select.addEventListener("change", (e) => {
      const val = e.target.value || null;
      applyFilter(val);
      // Method 2: classify the currently open chat when a filter option is picked
      captureOpenChatListing();
    });

    const placeholderOpt = document.createElement("option");
    placeholderOpt.textContent = "Loading…";
    select.appendChild(placeholderOpt);

    const spinner = document.createElement("div");
    spinner.id = "mp-chat-filter-spinner";
    spinner.className = "mp-spinner";

    filterContainer.appendChild(info);
    filterContainer.appendChild(select);
    filterContainer.appendChild(spinner);

    // ── Status: block element inserted directly BELOW the filter bar ──
    const status = document.createElement("p");
    status.id = "mp-chat-filter-status";

    const header = threadList.querySelector("header");
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(filterContainer, header.nextSibling);
    } else {
      threadList.prepend(filterContainer);
    }
    // Insert status immediately after the filter bar (not inside it)
    filterContainer.insertAdjacentElement("afterend", status);

    refreshListings();
  }

  function refreshListings() {
    const select = document.getElementById("mp-chat-filter-select");
    const infoEl = document.getElementById("mp-chat-filter-info");
    if (!select) return;

    const hasSellData =
      sellingPageVisitedThisSession &&
      storedSellingListings &&
      storedSellingListings.length > 0;
    const previousValue = select.value;
    const listings = getUniqueListings(); // array of name strings

    // ── Toggle info vs dropdown ──
    if (!hasSellData) {
      if (infoEl) infoEl.style.display = "";
      select.style.display = "none";
      if (isLoading) {
        isLoading = false;
        if (filterContainer) filterContainer.removeAttribute("data-loading");
      }
      applyFilter(null);
      updateStatus("No listings loaded — visit your Marketplace selling page.");
      return;
    }

    if (infoEl) infoEl.style.display = "none";
    select.style.display = "";

    select.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent =
      listings.length > 0
        ? `My Listings (${listings.length})`
        : "My Listings (no matching threads)";
    select.appendChild(allOpt);

    for (const listing of listings) {
      // Case-insensitive count: thread listing may differ in case from stored name
      const count = getThreadItems().filter((item) => {
        const l = extractListingName(parseThreadName(item));
        return l && l.toLowerCase() === listing.toLowerCase();
      }).length;

      const opt = document.createElement("option");
      opt.value = listing;
      opt.textContent = `${listing} (${count})`;
      select.appendChild(opt);
    }

    if (isLoading) {
      isLoading = false;
      select.disabled = false;
      if (filterContainer) filterContainer.removeAttribute("data-loading");
    }

    // Restore previous selection (case-insensitive match)
    const prevLower = (previousValue || "").toLowerCase();
    const matchPrev = listings.find((l) => l.toLowerCase() === prevLower);
    const filterLower = (currentFilter || "").toLowerCase();
    const matchFilter = listings.find((l) => l.toLowerCase() === filterLower);

    if (matchPrev) {
      select.value = matchPrev;
      applyFilter(matchPrev);
    } else if (matchFilter) {
      select.value = matchFilter;
      applyFilter(matchFilter);
    } else {
      select.value = "";
      applyFilter(null);
    }

    const totalThreads = getThreadItems().length;
    const storedInfo = ` · ${storedSellingListings.length} listed`;
    updateStatus(
      `${totalThreads} thread(s), ${listings.length} listing(s)${storedInfo}`
    );
  }

  function updateStatus(msg) {
    const status = document.getElementById("mp-chat-filter-status");
    if (status) status.textContent = msg;
  }

  // ── Mutation observer (lazy-loaded threads) ───────────────────────────

  function observeNewThreads() {
    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid || isObserving) return;
    isObserving = true;

    const observer = new MutationObserver(() => {
      if (isLoading) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshListings();
        if (currentFilter) applyFilter(currentFilter);
        // Also run open-chat role capture on each DOM change
        captureOpenChatListing();
      }, 300);
    });

    observer.observe(grid, { childList: true, subtree: true });
  }

  // ── Injection ──────────────────────────────────────────────────────────

  function tryInject() {
    if (!isMessagingPage()) return;
    const threadList = document.querySelector(SELECTORS.threadList);
    if (!threadList) return;
    createFilterUI(threadList);
    observeNewThreads();
  }

  // ── Init ───────────────────────────────────────────────────────────────

  /**
   * Loads stored listing data and the cross-tab session flag in parallel.
   * Also immediately marks the session if the script loaded on the selling page
   * (e.g. user opened it in a new tab) — no DOM scrape required for activation.
   */
  async function init() {
    // URL-based detection fires before any async storage reads, so Tab A's
    // storage.onChanged listener receives the flag as early as possible.
    if (isSellingPage()) markSellingPageVisited();

    const [stored, flagData] = await Promise.all([
      readPersistedListings(),
      _storage.get(SESSION_FLAG_KEY).catch(() => ({})),
    ]);
    storedSellingListings = normalizeSelling(stored.selling);
    const flagTs = flagData[SESSION_FLAG_KEY];
    if (flagTs && (Date.now() - flagTs) < 8 * 3600 * 1000) {
      sellingPageVisitedThisSession = true;
      console.log("[MP Filter] Session flag restored — selling page visited this session.");
    }
    if (storedSellingListings.length > 0) {
      console.log(
        `[MP Filter] Loaded ${storedSellingListings.length} stored selling listing(s):`,
        storedSellingListings
      );
    }
    tryInject();
  }

  init();

  // ── Cross-tab storage listener ─────────────────────────────────────────
  // chrome.storage.local.onChanged fires in all content scripts across all tabs.
  // We watch for two keys:
  //   SESSION_FLAG_KEY — another tab visited the selling page → activate dropdown
  //   STORAGE_KEY      — another tab finished scraping listings → refresh data
  try {
    const _sAPI = (typeof browser !== "undefined" && browser.storage?.onChanged)
      ? browser.storage
      : chrome.storage;
    _sAPI.onChanged.addListener((changes, area) => {
      if (area !== "local" || !isMessagingPage()) return;

      let needsRefresh = false;

      // Another tab visited the selling page — activate the filter
      if (changes[SESSION_FLAG_KEY]?.newValue && !sellingPageVisitedThisSession) {
        sellingPageVisitedThisSession = true;
        needsRefresh = true;
      }

      // Listing data updated by the scraper in another tab
      if (changes[STORAGE_KEY]?.newValue && sellingPageVisitedThisSession) {
        storedSellingListings = normalizeSelling(changes[STORAGE_KEY].newValue.selling);
        needsRefresh = true;
      }

      if (needsRefresh) {
        // If listing data wasn't in this change batch, re-read it from storage
        if (!changes[STORAGE_KEY]) {
          readPersistedListings().then((s) => {
            storedSellingListings = normalizeSelling(s.selling);
            refreshListings();
          }).catch(() => {});
        } else {
          refreshListings();
        }
      }
    });
  } catch (_) {}

  // ── Heartbeat ──────────────────────────────────────────────────────────

  setInterval(() => {
    if (isSellingPage()) {
      markSellingPageVisited(); // url-based, no DOM needed, idempotent
      tryScrapeSellingPage();   // dom-based, may retry until hydrated
    } else if (isMessagingPage()) {
      tryInject();
      captureOpenChatListing(); // classify the currently open chat if role is detectable

      // Poll for the session flag on every tick while it hasn't been found yet.
      // This is the primary cross-tab activation path for Firefox, where
      // storage.onChanged does not fire in content scripts.
      // Once the flag is found the guard short-circuits and no further reads occur.
      if (!sellingPageVisitedThisSession) {
        Promise.all([
          _storage.get(SESSION_FLAG_KEY),
          readPersistedListings(),
        ]).then(([flagData, stored]) => {
          const ts = flagData[SESSION_FLAG_KEY];
          if (ts && (Date.now() - ts) < 8 * 3600 * 1000) {
            storedSellingListings = normalizeSelling(stored.selling);
            sellingPageVisitedThisSession = true;
            refreshListings();
          }
        }).catch(() => {});
      }
    }
  }, 1500);

  // ── SPA navigation ─────────────────────────────────────────────────────

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      isObserving = false;
      // Allow re-scrape if user navigates away from the selling page
      if (!isSellingPage()) hasScrapedSellingPage = false;
      // URL-based activation: fires immediately on SPA navigation to selling page,
      // before the DOM has even hydrated — no scrape required.
      if (isSellingPage()) markSellingPageVisited();
      // When navigating back to the messaging page, re-read the session flag
      // (another tab may have visited the selling page) then refresh the UI.
      if (isMessagingPage()) {
        _storage.get(SESSION_FLAG_KEY)
          .then((d) => {
            const ts = d[SESSION_FLAG_KEY];
            if (ts && (Date.now() - ts) < 8 * 3600 * 1000 && !sellingPageVisitedThisSession) {
              sellingPageVisitedThisSession = true;
            }
          })
          .catch(() => {})
          .finally(() => {
            setTimeout(() => {
              refreshListings();
              applyFilter(currentFilter);
            }, 300);
          });
      }
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });
})();
