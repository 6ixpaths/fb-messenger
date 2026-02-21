(function () {
  "use strict";

  const SELECTORS = {
    threadList: 'div[aria-label="Thread list"]',
    chatGrid: 'div[aria-label="Chats"][role="grid"]',
    threadLink: 'a[href*="/marketplace/t/"]',
    threadName: "span.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft",
  };

  const SCROLL_PAUSE_MS = 800;
  const MIN_THREADS_TARGET = 50;
  const MAX_SCROLL_ATTEMPTS = 60;
  const SEPARATOR = " \u00b7 "; // " · "

  let filterContainer = null;
  let currentFilter = null;
  let isScrolling = false;
  let debounceTimer = null;
  let isLoading = false;
  let isObserving = false;

  // ── Utility ──────────────────────────────────────────────────────────

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Thread parsing ───────────────────────────────────────────────────

  /**
   * Returns an array of { row, link } objects for each marketplace thread.
   * `row` is the closest role="row" ancestor, `link` is the <a> element.
   */
  function getThreadItems() {
    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid) return [];

    const links = grid.querySelectorAll(SELECTORS.threadLink);
    const items = [];
    const seen = new Set();

    for (const link of links) {
      const row = link.closest('div[role="row"]');
      if (!row || seen.has(row)) continue;
      seen.add(row);
      items.push({ row, link });
    }
    return items;
  }

  function parseThreadName(item) {
    const { row } = item;
    const spans = row.querySelectorAll(SELECTORS.threadName);
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text.includes(SEPARATOR)) {
        return text;
      }
    }
    return null;
  }

  function extractListingName(fullName) {
    if (!fullName) return null;
    const idx = fullName.indexOf(SEPARATOR);
    if (idx === -1) return null;
    return fullName.substring(idx + SEPARATOR.length).trim();
  }

  function getUniqueListings() {
    const items = getThreadItems();
    const listings = new Set();
    for (const item of items) {
      const name = parseThreadName(item);
      const listing = extractListingName(name);
      if (listing) listings.add(listing);
    }
    return Array.from(listings).sort();
  }

  // ── Auto-scroll ──────────────────────────────────────────────────────

  function getScrollableContainer() {
    const threadList = document.querySelector(SELECTORS.threadList);
    if (!threadList) return null;

    // Walk up to find the scrollable ancestor
    let el = threadList;
    while (el) {
      const style = window.getComputedStyle(el);
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight
      ) {
        return el;
      }
      el = el.parentElement;
    }

    // Fallback: find scrollable child inside thread list
    const children = threadList.querySelectorAll("*");
    for (const child of children) {
      const style = window.getComputedStyle(child);
      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        child.scrollHeight > child.clientHeight
      ) {
        return child;
      }
    }
    return threadList;
  }

  async function autoScroll() {
    if (isScrolling) return;
    isScrolling = true;

    const loadBtn = document.getElementById("mp-chat-filter-load");
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = "Loading...";
    }
    updateStatus("Loading threads...");

    const container = getScrollableContainer();
    if (!container) {
      updateStatus("Could not find scrollable container");
      isScrolling = false;
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = "Load More";
      }
      return;
    }

    let attempts = 0;
    let lastCount = 0;
    let staleRounds = 0;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
      const currentCount = getThreadItems().length;

      if (currentCount >= MIN_THREADS_TARGET) {
        break;
      }

      if (currentCount === lastCount) {
        staleRounds++;
        if (staleRounds >= 5) break;
      } else {
        staleRounds = 0;
      }

      lastCount = currentCount;
      updateStatus(`Loading threads... (${currentCount} found)`);

      container.scrollTop = container.scrollHeight;
      await sleep(SCROLL_PAUSE_MS);
      attempts++;
    }

    // Scroll back to top
    container.scrollTop = 0;
    isScrolling = false;

    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = "Load More";
    }

    const finalCount = getThreadItems().length;
    updateStatus(`${finalCount} threads loaded`);
    refreshListings();
  }

  // ── Filtering ────────────────────────────────────────────────────────

  function applyFilter(listing) {
    currentFilter = listing;
    const items = getThreadItems();
    let visibleCount = 0;

    for (const item of items) {
      // Find the outermost hideable wrapper — walk up from the row
      // to the nearest sibling-level container so spacing stays clean
      const hideTarget = item.row;

      if (!listing) {
        hideTarget.style.display = "";
        visibleCount++;
        continue;
      }

      const name = parseThreadName(item);
      const rowListing = extractListingName(name);

      if (rowListing === listing) {
        hideTarget.style.display = "";
        visibleCount++;
      } else {
        hideTarget.style.display = "none";
      }
    }

    if (listing) {
      updateStatus(`Showing ${visibleCount} chat(s) for "${listing}"`);
    } else {
      updateStatus(`Showing all ${visibleCount} chats`);
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────

  function createFilterUI(threadList) {
    if (document.getElementById("mp-chat-filter")) return;

    isLoading = true;
    filterContainer = document.createElement("div");
    filterContainer.id = "mp-chat-filter";
    filterContainer.setAttribute("data-loading", "true");

    // Dropdown (disabled while loading)
    const select = document.createElement("select");
    select.id = "mp-chat-filter-select";
    select.disabled = true;
    select.addEventListener("change", (e) => {
      applyFilter(e.target.value || null);
    });

    // Create placeholder option
    const placeholderOpt = document.createElement("option");
    placeholderOpt.textContent = "Loading threads...";
    select.appendChild(placeholderOpt);

    // Refresh button (disabled while loading)
    const refreshBtn = document.createElement("button");
    refreshBtn.id = "mp-chat-filter-refresh";
    refreshBtn.textContent = "\u21bb";
    refreshBtn.title = "Refresh listings";
    refreshBtn.disabled = true;
    refreshBtn.addEventListener("click", () => refreshListings());

    // Scroll-load button (disabled while loading)
    const loadBtn = document.createElement("button");
    loadBtn.id = "mp-chat-filter-load";
    loadBtn.textContent = "Load More";
    loadBtn.title = "Auto-scroll to load at least 50 threads";
    loadBtn.disabled = true;
    loadBtn.addEventListener("click", () => autoScroll());

    // Loading spinner
    const spinner = document.createElement("div");
    spinner.id = "mp-chat-filter-spinner";
    spinner.className = "mp-spinner";

    // Status text
    const status = document.createElement("span");
    status.id = "mp-chat-filter-status";
    status.textContent = "Scanning threads...";

    filterContainer.appendChild(select);
    filterContainer.appendChild(refreshBtn);
    filterContainer.appendChild(loadBtn);
    filterContainer.appendChild(spinner);
    filterContainer.appendChild(status);

    // Insert after the header inside the thread list
    const header = threadList.querySelector("header");
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(filterContainer, header.nextSibling);
    } else {
      threadList.prepend(filterContainer);
    }

    // Trigger initial refresh (will disable loading state when done)
    refreshListings();
  }

  function refreshListings() {
    const select = document.getElementById("mp-chat-filter-select");
    if (!select) return;

    const previousValue = select.value;
    const listings = getUniqueListings();

    select.innerHTML = "";

    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = `All Listings (${listings.length})`;
    select.appendChild(allOpt);

    for (const listing of listings) {
      // Count threads per listing
      const count = getThreadItems().filter((item) => {
        const name = parseThreadName(item);
        return extractListingName(name) === listing;
      }).length;

      const opt = document.createElement("option");
      opt.value = listing;
      opt.textContent = `${listing} (${count})`;
      select.appendChild(opt);
    }

    // Enable UI now that listings are loaded
    if (isLoading) {
      isLoading = false;
      select.disabled = false;
      const refreshBtn = document.getElementById("mp-chat-filter-refresh");
      const loadBtn = document.getElementById("mp-chat-filter-load");
      if (refreshBtn) refreshBtn.disabled = false;
      if (loadBtn) loadBtn.disabled = false;
      filterContainer.removeAttribute("data-loading");
    }

    // Restore previous selection if it still exists
    if (previousValue && listings.includes(previousValue)) {
      select.value = previousValue;
      applyFilter(previousValue);
    } else if (currentFilter && listings.includes(currentFilter)) {
      select.value = currentFilter;
      applyFilter(currentFilter);
    } else {
      select.value = "";
      applyFilter(null);
    }

    const totalThreads = getThreadItems().length;
    updateStatus(`${totalThreads} thread(s), ${listings.length} listing(s)`);
  }

  function updateStatus(msg) {
    const status = document.getElementById("mp-chat-filter-status");
    if (status) status.textContent = msg;
  }

  // ── Mutation Observer (handle lazy-loaded threads) ───────────────────

  function observeNewThreads() {
    const grid = document.querySelector(SELECTORS.chatGrid);
    if (!grid || isObserving) return;
    isObserving = true;

    const observer = new MutationObserver(() => {
      if (isScrolling || isLoading) return;

      // Debounce rapid mutations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshListings();
        if (currentFilter) {
          applyFilter(currentFilter);
        }
      }, 300);
    });

    observer.observe(grid, { childList: true, subtree: true });
  }

  // ── Target page detection ─────────────────────────────────────────────

  function isTargetPage() {
    // Allow local test page to bypass the domain check
    if (document.documentElement.dataset.mpFilterTest === "true") return true;
    const { hostname, pathname } = location;
    return (
      hostname === "www.messenger.com" ||
      (hostname === "www.facebook.com" &&
        (pathname.startsWith("/marketplace/") ||
          pathname.startsWith("/messages/")))
    );
  }

  // ── Inject ────────────────────────────────────────────────────────────

  // Attempt a single inject: if thread list is in the DOM and filter bar
  // isn't yet, create the UI and start observing. Safe to call repeatedly.
  function tryInject() {
    if (!isTargetPage()) return;
    const threadList = document.querySelector(SELECTORS.threadList);
    if (!threadList) return;
    createFilterUI(threadList);   // guarded by getElementById check inside
    observeNewThreads();          // guarded by isObserving flag
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────

  // Polls every 1.5s so we catch the thread list regardless of when React
  // finishes hydrating — handles initial load, hard refresh, and SPA navigation.
  setInterval(tryInject, 1500);

  // ── SPA navigation observer ───────────────────────────────────────────

  // When Facebook/Messenger navigates client-side, the URL changes but the
  // page doesn't fully reload. Reset observing flag so we re-attach after
  // the new route renders its thread list.
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      isObserving = false; // allow re-attaching MutationObserver on new route
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // ── Initial attempt ───────────────────────────────────────────────────

  // Try immediately in case the thread list is already in the DOM.
  tryInject();
})();
