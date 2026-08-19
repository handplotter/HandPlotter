'use strict'
// app.js -- wires the quote form to HandPlotterPricing.compute() and builds
// the Messenger hand-off. No server, no submission endpoint: the "book"
// action opens Messenger with a copyable summary the customer pastes in.
// That is deliberate (see WEB_INTAKE_PLAN.md D2/D4) -- a page with no backend
// has nothing to go down when the operator's PC is off, and Messenger is
// already the intake channel the bot + Orders workflow are built around.
//
// The HandPlotter Facebook Page (Batangas City). No vanity username is set on
// the Page yet, so this is the numeric Page ID from its profile.php?id= URL --
// m.me/<id> works exactly like m.me/<username> for a Page. Confirmed live
// 2026-08-19 against https://www.facebook.com/profile.php?id=61591994786404.
const MESSENGER_PAGE_USERNAME = '61591994786404'

;(function () {
  const $ = (id) => document.getElementById(id)
  const peso = (n) => '₱' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  let DISK = null      // parsed data/rates.json, or null (offline fallback)
  let META = { live: false, generatedAt: null }

  function fillSelect(sel, list) {
    sel.innerHTML = ''
    list.forEach((item) => {
      const opt = document.createElement('option')
      opt.value = item.id
      opt.textContent = item.label
      sel.appendChild(opt)
    })
  }

  function readForm() {
    return {
      sizeId: $('f-size').value,
      densityId: $('f-density').value,
      pages: Math.max(1, Math.round(Number($('f-pieces').value) || 1)),
      turnaroundId: $('f-turnaround').value,
      firstOrder: $('f-first').checked,
      diagrams: {
        simple: Number($('f-diag-simple').value) || 0,
        moderate: Number($('f-diag-moderate').value) || 0,
        complex: Number($('f-diag-complex').value) || 0,
      },
    }
  }

  function renderFreshnessBanner() {
    const el = $('rates-banner')
    if (!el) return
    if (META.live && META.generatedAt) {
      const d = new Date(META.generatedAt)
      const stamp = isNaN(d.getTime()) ? META.generatedAt : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      el.textContent = 'Rates last published ' + stamp + '.'
      el.classList.remove('warn')
    } else {
      el.textContent = 'Showing example rates -- this estimate is illustrative. We will confirm your exact price when you message us.'
      el.classList.add('warn')
    }
  }

  function renderEstimate() {
    const q = window.HandPlotterPricing.compute(readForm(), DISK)
    $('q-total').textContent = peso(q.total)
    $('q-down').textContent = peso(q.downPayment)
    $('q-breakdown').innerHTML = [
      ['Base (' + q.size.label + ', ' + q.density.label + ') × ' + q.pages, peso(q.pagesTotal)],
      q.volumeDiscountAmt > 0 ? ['Volume discount (−' + Math.round(q.volumePct * 100) + '%)', '−' + peso(q.volumeDiscountAmt)] : null,
      q.diagramsTotal > 0 ? ['Diagrams / illustrations', peso(q.diagramsTotal)] : null,
      q.turnaround.mult !== 1 ? [q.turnaround.label, '×' + q.turnaround.mult] : null,
      q.firstOrderDiscountAmt > 0 ? ['First-order discount (−' + Math.round((q.firstOrderDiscountAmt / q.rushAdjustedTotal) * 100) + '%)', '−' + peso(q.firstOrderDiscountAmt)] : null,
      q.minimumApplied ? ['Minimum order applied', null] : null,
    ].filter(Boolean).map((row) => (
      '<div class="q-row"><span>' + row[0] + '</span>' + (row[1] != null ? '<span>' + row[1] + '</span>' : '') + '</div>'
    )).join('')
    $('q-cap-note').textContent = q.capNote || ''
    $('q-cap-note').style.display = q.capNote ? 'block' : 'none'
    return q
  }

  function buildSummary(q) {
    const lines = [
      'Hi! I would like a quote / to book a HandPlotter order.',
      '',
      'Size: ' + q.size.label,
      'Writing amount: ' + q.density.label,
      'Pieces: ' + q.pages,
      'Turnaround: ' + q.turnaround.label,
      q.diagramsTotal > 0 ? 'Diagrams/illustrations included: yes' : null,
      q.firstOrder ? 'This is my first order' : null,
      '',
      'Estimated total: ' + peso(q.total) + ' (example/estimate only -- please confirm)',
      'Estimated down payment (' + Math.round((q.downPayment / q.total) * 100) + '%): ' + peso(q.downPayment),
    ].filter(Boolean)
    return lines.join('\n')
  }

  async function copySummary() {
    const q = renderEstimate()
    const text = buildSummary(q)
    const status = $('copy-status')
    try {
      await navigator.clipboard.writeText(text)
      status.textContent = 'Copied. Paste it into the Messenger chat that just opened.'
    } catch (e) {
      // Clipboard API needs a secure context (https) or can be blocked by the
      // browser; fall back to showing the text so the customer can select and
      // copy it by hand rather than the button silently doing nothing.
      $('copy-fallback-text').value = text
      $('copy-fallback').style.display = 'block'
      status.textContent = 'Could not auto-copy -- select the text below and copy it manually.'
    }
  }

  // loadProofPhotos(): fetches data/proof.json (Finance Manager's "Website"
  // tab writes it -- see finance_manager/src/main.js) and renders whatever is
  // there. Built with DOM APIs (not innerHTML string-building, unlike the
  // rest of this file) because captions are free-text the operator typed --
  // no need for an escaping helper if the text never passes through HTML
  // parsing at all. Empty/missing/malformed all render the same honest
  // "coming soon" state rather than erroring or showing nothing.
  async function loadProofPhotos() {
    const gallery = $('proof-gallery')
    if (!gallery) return
    let photos = []
    try {
      const res = await fetch('data/proof.json', { cache: 'no-store' })
      if (res.ok) {
        const parsed = await res.json()
        if (Array.isArray(parsed)) photos = parsed
      }
    } catch (e) { /* offline / no file yet -- falls through to the empty state */ }

    gallery.innerHTML = ''
    if (!photos.length) {
      const note = document.createElement('p')
      note.className = 'sub'
      note.textContent = 'Photos of finished pieces are coming soon.'
      gallery.appendChild(note)
      return
    }
    photos.forEach((p) => {
      if (!p || !p.file) return
      const item = document.createElement('div')
      item.className = 'proof-item'
      const img = document.createElement('img')
      img.src = String(p.file)
      img.alt = String(p.caption || 'Plotted handwriting sample')
      img.loading = 'lazy'
      item.appendChild(img)
      if (p.caption) {
        const cap = document.createElement('div')
        cap.className = 'proof-caption'
        cap.textContent = String(p.caption)
        item.appendChild(cap)
      }
      gallery.appendChild(item)
    })
  }

  // loadHandwritingSamples(): fetches data/samples.json (Finance Manager's
  // "Website" tab writes it, same publish mechanism as proof photos) and
  // renders each {before, after, note} pair. Empty/missing/malformed all
  // render the same honest "coming soon" state, matching loadProofPhotos.
  async function loadHandwritingSamples() {
    const gallery = $('sample-gallery')
    if (!gallery) return
    let samples = []
    try {
      const res = await fetch('data/samples.json', { cache: 'no-store' })
      if (res.ok) {
        const parsed = await res.json()
        if (Array.isArray(parsed)) samples = parsed
      }
    } catch (e) { /* offline / no file yet -- falls through to the empty state */ }

    gallery.innerHTML = ''
    if (!samples.length) {
      const note = document.createElement('p')
      note.className = 'sub'
      note.textContent = 'A real before-and-after example is coming soon.'
      gallery.appendChild(note)
      return
    }
    samples.forEach((s) => {
      if (!s || !s.before || !s.after) return
      const pair = document.createElement('div')
      pair.className = 'sample-pair'

      const beforeFig = document.createElement('figure')
      const beforeImg = document.createElement('img')
      beforeImg.src = String(s.before)
      beforeImg.alt = 'Original handwriting sample'
      beforeImg.loading = 'lazy'
      const beforeCap = document.createElement('figcaption')
      beforeCap.textContent = 'Your handwriting'
      beforeFig.appendChild(beforeImg)
      beforeFig.appendChild(beforeCap)

      const afterFig = document.createElement('figure')
      const afterImg = document.createElement('img')
      afterImg.src = String(s.after)
      afterImg.alt = 'Result as a custom font'
      afterImg.loading = 'lazy'
      const afterCap = document.createElement('figcaption')
      afterCap.textContent = 'As your font'
      afterFig.appendChild(afterImg)
      afterFig.appendChild(afterCap)

      pair.appendChild(beforeFig)
      pair.appendChild(afterFig)

      if (s.note) {
        const note = document.createElement('div')
        note.className = 'sample-note'
        note.textContent = String(s.note)
        pair.appendChild(note)
      }
      gallery.appendChild(pair)
    })
  }

  function messengerHref() {
    if (!MESSENGER_PAGE_USERNAME || MESSENGER_PAGE_USERNAME === 'REPLACE_WITH_YOUR_PAGE_USERNAME') return null
    return 'https://m.me/' + encodeURIComponent(MESSENGER_PAGE_USERNAME)
  }

  function initMessengerLinks() {
    const href = messengerHref()
    document.querySelectorAll('[data-messenger-link]').forEach((el) => {
      if (href) { el.href = href; el.removeAttribute('aria-disabled') }
      else { el.href = '#'; el.setAttribute('aria-disabled', 'true'); el.title = 'Messenger link not configured yet' }
    })
    if (!href) {
      const warn = $('messenger-config-warning')
      if (warn) warn.style.display = 'block'
    }
  }

  async function init() {
    const loaded = await window.HandPlotterPricing.loadRates()
    DISK = loaded.disk
    META = loaded.meta
    renderFreshnessBanner()

    const CAT = window.HandPlotterPricing.catalogFor(DISK)
    fillSelect($('f-size'), CAT.sizes)
    fillSelect($('f-density'), CAT.densities)
    fillSelect($('f-turnaround'), CAT.turnarounds)
    $('f-size').value = 'a4'
    $('f-density').value = 'standard'

    ;['f-size', 'f-density', 'f-pieces', 'f-turnaround', 'f-first',
      'f-diag-simple', 'f-diag-moderate', 'f-diag-complex'].forEach((id) => {
      $(id).addEventListener('input', renderEstimate)
    })

    $('book-btn').addEventListener('click', (e) => {
      if (!messengerHref()) { e.preventDefault(); return }
      copySummary()
    })

    initMessengerLinks()
    renderEstimate()
    loadProofPhotos()
    loadHandwritingSamples()
  }

  document.addEventListener('DOMContentLoaded', init)
})()
