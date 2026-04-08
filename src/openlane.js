import JSZip from 'jszip'
import openlaneCSS from './openlane.css?inline'

;(function () {
  const LOG = '[OL Downloader]'
  let downloadBtnInjected = false

  /* ── Tag-name helpers ───────────────────────────────────
   * Openlane uses Stencil-scoped custom elements whose tag names carry a
   * build hash (e.g. ignite-typography-7x-42y-0z, …-8x-5y-4z, etc.) that
   * changes every release.  We cannot hardcode the suffix — match by
   * tag-name prefix instead.
   */
  function queryByTagPrefix(root, prefix) {
    const p = prefix.toLowerCase()
    return Array.from(root.querySelectorAll('*')).find(
      el => el.tagName.toLowerCase().startsWith(p)
    ) || null
  }
  function queryAllByTagPrefix(root, prefix) {
    const p = prefix.toLowerCase()
    return Array.from(root.querySelectorAll('*')).filter(
      el => el.tagName.toLowerCase().startsWith(p)
    )
  }

  /* ── Inject styles ──────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('ol-dl-styles')) return
    const style = document.createElement('style')
    style.id = 'ol-dl-styles'
    style.textContent = openlaneCSS
    document.head.appendChild(style)
  }

  /* ── Parse gallery categories ───────────────────────────── */
  function parseCategories(modal) {
    const sections = modal.querySelectorAll('.modal__images')
    const categories = []

    sections.forEach(section => {
      const typo = queryByTagPrefix(section, 'ignite-typography-')
      if (!typo) return
      const label = typo.textContent.trim().toLowerCase()

      let type = null
      let mediaType = 'image'
      if (label.includes('condition images')) type = 'condition'
      else if (label.includes('overview images')) type = 'overview'
      else if (label.includes('video')) { type = 'video'; mediaType = 'video' }
      else return

      if (mediaType === 'video') {
        // Videos don't have ignite-photo IDs in the sidebar; count placeholders
        // and resolve actual indices from the preview carousel later
        const videoSlots = section.querySelectorAll('.image')
        categories.push({ type, label: typo.textContent.trim(), ids: [], videoCount: videoSlots.length, mediaType })
      } else {
        const imageSlots = section.querySelectorAll('.image')
        const ids = []
        imageSlots.forEach(slot => {
          const photo = queryByTagPrefix(slot, 'ignite-photo-')
          if (photo) {
            const n = parseInt(photo.id, 10)
            if (!isNaN(n)) ids.push(n)
          }
        })
        categories.push({ type, label: typo.textContent.trim(), ids, mediaType: 'image' })
      }
    })

    return categories
  }

  /* ── Collect all media URLs from preview carousel ────────── */
  function collectAllMediaUrls(modal) {
    const urls = {}
    modal.querySelectorAll('.modal__preview div[data-index]').forEach(slide => {
      const idx = slide.dataset.index
      const img = slide.querySelector('img')
      if (img && img.src) {
        urls[idx] = { url: img.src, mediaType: 'image' }
      }
      const video = slide.querySelector('video')
      if (video && video.src) {
        urls[idx] = { url: video.src, mediaType: 'video' }
      }
    })
    return urls
  }

  /* ── Resolve video indices from the carousel ──────────── */
  function resolveVideoIndices(categories, mediaUrls) {
    for (const cat of categories) {
      if (cat.mediaType !== 'video') continue
      const videoIndices = Object.entries(mediaUrls)
        .filter(([, m]) => m.mediaType === 'video')
        .map(([idx]) => parseInt(idx, 10))
        .sort((a, b) => a - b)
      cat.ids = videoIndices
    }
  }

  /* ── Build selection panel ──────────────────────────────── */
  function buildSelectionPanel(modal, categories, mediaUrls) {
    // Remove any leftover panel from a previous modal — the panel lives on
    // document.body, so it isn't cleaned up when the Openlane modal closes.
    const existing = document.querySelector('.ol-dl-panel')
    if (existing) existing.remove()

    const panel = document.createElement('div')
    panel.className = 'ol-dl-panel'

    const header = document.createElement('div')
    header.className = 'ol-dl-panel-header'
    header.innerHTML = '<span>Select media to download</span>'
    const closeBtn = document.createElement('button')
    closeBtn.className = 'ol-dl-panel-close'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => panel.remove())
    header.appendChild(closeBtn)
    panel.appendChild(header)

    const body = document.createElement('div')
    body.className = 'ol-dl-panel-body'

    categories.forEach(cat => {
      if (cat.ids.length === 0) return

      const section = document.createElement('div')
      section.className = 'ol-dl-section'

      const sectionHeader = document.createElement('div')
      sectionHeader.className = 'ol-dl-section-header'

      const selectAll = document.createElement('input')
      selectAll.type = 'checkbox'
      selectAll.checked = true
      selectAll.className = 'ol-dl-select-all'

      const sectionLabel = document.createElement('span')
      sectionLabel.textContent = cat.label

      sectionHeader.appendChild(selectAll)
      sectionHeader.appendChild(sectionLabel)
      section.appendChild(sectionHeader)

      const grid = document.createElement('div')
      grid.className = 'ol-dl-grid'

      cat.ids.forEach((id, i) => {
        const item = document.createElement('label')
        item.className = 'ol-dl-item'

        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = true
        cb.dataset.imgIndex = id
        cb.dataset.category = cat.type
        cb.dataset.mediaType = cat.mediaType

        const thumb = document.createElement('div')
        thumb.className = 'ol-dl-thumb'
        const media = mediaUrls[id]
        if (media && media.mediaType === 'image') {
          thumb.style.backgroundImage = `url(${media.url})`
        } else if (media && media.mediaType === 'video') {
          thumb.classList.add('ol-dl-thumb-video')
        }

        const num = document.createElement('span')
        num.className = 'ol-dl-num'
        num.textContent = i + 1

        item.appendChild(cb)
        item.appendChild(thumb)
        item.appendChild(num)
        grid.appendChild(item)
      })

      // Select-all toggle
      selectAll.addEventListener('change', () => {
        grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = selectAll.checked
        })
      })
      // Update select-all when individual checkboxes change
      grid.addEventListener('change', () => {
        const cbs = grid.querySelectorAll('input[type="checkbox"]')
        selectAll.checked = Array.from(cbs).every(cb => cb.checked)
        selectAll.indeterminate = !selectAll.checked && Array.from(cbs).some(cb => cb.checked)
      })

      section.appendChild(grid)
      body.appendChild(section)
    })

    panel.appendChild(body)

    // Download button
    const footer = document.createElement('div')
    footer.className = 'ol-dl-panel-footer'

    const dlBtn = document.createElement('button')
    dlBtn.className = 'ol-dl-download-btn'
    dlBtn.textContent = 'Download Selected'
    dlBtn.addEventListener('click', () => downloadSelected(modal, panel, mediaUrls))
    footer.appendChild(dlBtn)
    panel.appendChild(footer)

    // Overlay the gallery sidebar (not the full screen).  Fall back to body
    // if the sidebar isn't found for some reason.
    const sidebar = modal.querySelector('.modal__sidebar')
    if (sidebar) {
      // Ensure the sidebar can host an absolutely-positioned child without
      // altering its own layout.
      if (getComputedStyle(sidebar).position === 'static') {
        sidebar.style.position = 'relative'
      }
      sidebar.appendChild(panel)
    } else {
      document.body.appendChild(panel)
    }
  }

  /* ── Download selected media as ZIP ─────────────────────── */
  async function downloadSelected(modal, panel, mediaUrls) {
    const checked = panel.querySelectorAll('.ol-dl-grid input[type="checkbox"]:checked')
    if (checked.length === 0) return

    const dlBtn = panel.querySelector('.ol-dl-download-btn')
    const originalText = dlBtn.textContent
    dlBtn.disabled = true
    dlBtn.textContent = 'Fetching media…'

    // Get vehicle name from modal header for zip filename
    const header = modal.querySelector('.modal__header')
    const titleEl = header ? queryByTagPrefix(header, 'ignite-typography-') : null
    const vehicleName = titleEl ? titleEl.textContent.trim() : 'vehicle'

    const zip = new JSZip()
    let completed = 0
    let added = 0
    const categoryCounters = {}

    for (const cb of checked) {
      const index = cb.dataset.imgIndex
      const category = cb.dataset.category
      const media = mediaUrls[index]
      if (!media || !media.url) {
        console.warn(LOG, `No URL found for media index ${index}`)
        completed++
        dlBtn.textContent = `Fetching media… (${completed}/${checked.length})`
        continue
      }

      categoryCounters[category] = (categoryCounters[category] || 0) + 1
      try {
        const resp = await fetch(media.url)
        if (!resp.ok) {
          console.error(LOG, `Fetch failed for media ${index}: HTTP ${resp.status}`)
          completed++
          dlBtn.textContent = `Fetching media… (${completed}/${checked.length})`
          continue
        }
        const buf = await resp.arrayBuffer()
        if (buf.byteLength === 0) {
          console.warn(LOG, `Empty response for media ${index}`)
          completed++
          dlBtn.textContent = `Fetching media… (${completed}/${checked.length})`
          continue
        }
        const contentType = resp.headers.get('content-type') || ''
        let ext
        if (media.mediaType === 'video') {
          ext = contentType.includes('webm') ? 'webm' : 'mp4'
        } else {
          ext = contentType.includes('png') ? 'png' : 'jpg'
        }
        const filename = `${category}_${categoryCounters[category]}.${ext}`
        zip.file(filename, buf)
        added++
        console.log(LOG, `Added ${filename} (${buf.byteLength} bytes)`)
      } catch (err) {
        console.error(LOG, `Failed to fetch media ${index}:`, err)
      }

      completed++
      dlBtn.textContent = `Fetching media… (${completed}/${checked.length})`
    }

    if (added === 0) {
      console.error(LOG, 'No images were successfully fetched — skipping ZIP')
      dlBtn.textContent = originalText
      dlBtn.disabled = false
      return
    }

    dlBtn.textContent = 'Creating ZIP…'
    console.log(LOG, `Generating ZIP with ${added} files…`)

    try {
      const base64 = await zip.generateAsync({ type: 'base64' })
      const dataUrl = 'data:application/zip;base64,' + base64

      // Use chrome.downloads API if available (bypasses CSP blob: restrictions)
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          { action: 'download', url: dataUrl, filename: `${vehicleName}.zip` },
          (resp) => {
            if (chrome.runtime.lastError) {
              console.error(LOG, 'Download message failed:', chrome.runtime.lastError)
              fallbackDownload(dataUrl, vehicleName)
            }
          }
        )
      } else {
        fallbackDownload(dataUrl, vehicleName)
      }
    } catch (err) {
      console.error(LOG, 'Failed to generate ZIP:', err)
    }

    dlBtn.textContent = originalText
    dlBtn.disabled = false
  }

  function fallbackDownload(dataUrl, vehicleName) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${vehicleName}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  /* ── Inject download button into modal header ───────────── */
  function injectDownloadButton(modal) {
    if (modal.querySelector('.ol-dl-btn')) return

    const headerControl = modal.querySelector('.modal__header-control')
    if (!headerControl) return

    const btn = document.createElement('button')
    btn.className = 'ol-dl-btn'
    btn.title = 'Download gallery images'
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

    btn.addEventListener('click', () => {
      const categories = parseCategories(modal)
      if (categories.length === 0) {
        console.warn(LOG, 'No media categories found')
        return
      }
      const mediaUrls = collectAllMediaUrls(modal)
      resolveVideoIndices(categories, mediaUrls)
      console.log(LOG, `Found ${Object.keys(mediaUrls).length} media URLs`)
      buildSelectionPanel(modal, categories, mediaUrls)
    })

    // Insert before the existing controls (escape/close)
    headerControl.insertBefore(btn, headerControl.firstChild)
    console.log(LOG, 'Download button injected')
  }

  /* ── Observe for gallery modal ──────────────────────────── */
  function observeGalleryModal() {
    const observer = new MutationObserver(() => {
      const modal = document.querySelector('.modal__header')
      if (modal) {
        const modalRoot = modal.closest('.modal')
        if (modalRoot && !modalRoot.querySelector('.ol-dl-btn')) {
          injectDownloadButton(modalRoot)
        }
      } else {
        // Modal is gone — drop any leftover selection panel so it doesn't
        // overlay the next page.
        const stalePanel = document.querySelector('.ol-dl-panel')
        if (stalePanel) stalePanel.remove()
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
    console.log(LOG, 'Observing for gallery modal')

    // Also check immediately in case modal is already open
    const modal = document.querySelector('.modal__header')
    if (modal) {
      const modalRoot = modal.closest('.modal')
      if (modalRoot) injectDownloadButton(modalRoot)
    }
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    injectStyles()
    observeGalleryModal()
    console.log(LOG, 'Initialized')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
