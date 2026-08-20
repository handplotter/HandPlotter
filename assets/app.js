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

  // ---- Segmented pill selectors (replace native <select> for size/density/
  // turnaround): the whole option set is visible at once, no menu to open,
  // and every chip is a full 40px+ tap target. ----
  function fillPillGroup(container, list, selectedId) {
    container.innerHTML = ''
    list.forEach((item) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'pill' + (item.id === selectedId ? ' active' : '')
      btn.dataset.id = item.id
      btn.setAttribute('role', 'radio')
      btn.setAttribute('aria-checked', item.id === selectedId ? 'true' : 'false')
      btn.textContent = item.label
      btn.addEventListener('click', () => {
        container.querySelectorAll('.pill').forEach((p) => { p.classList.remove('active'); p.setAttribute('aria-checked', 'false') })
        btn.classList.add('active')
        btn.setAttribute('aria-checked', 'true')
        renderEstimate()
      })
      container.appendChild(btn)
    })
  }
  function pillValue(container) {
    const active = container && container.querySelector('.pill.active')
    return active ? active.dataset.id : null
  }

  // ---- +/- steppers (piece count + the three diagram-tier counts): no
  // on-screen keyboard needed, and the count is always visible, not typed
  // into a number field a visitor could leave blank. ----
  function wireStepper(el, opts) {
    if (!el) return
    const min = opts.min || 0
    const valEl = el.querySelector(opts.valueSelector)
    const minus = el.querySelector('.minus')
    const plus = el.querySelector('.plus')
    function set(v) {
      v = Math.max(min, Math.min(999, Math.round(v) || 0))
      el.dataset.value = String(v)
      valEl.textContent = String(v)
    }
    set(Number(el.dataset.value) || min)
    minus.addEventListener('click', () => { set(Number(el.dataset.value) - 1); renderEstimate() })
    plus.addEventListener('click', () => { set(Number(el.dataset.value) + 1); renderEstimate() })
  }

  function readForm() {
    return {
      sizeId: pillValue($('f-size')),
      densityId: pillValue($('f-density')),
      pages: Math.max(1, Math.round(Number($('f-pieces').dataset.value) || 1)),
      turnaroundId: pillValue($('f-turnaround')),
      firstOrder: $('f-first').checked,
      diagrams: {
        simple: Number($('f-diag-simple').dataset.value) || 0,
        moderate: Number($('f-diag-moderate').dataset.value) || 0,
        complex: Number($('f-diag-complex').dataset.value) || 0,
      },
      fromPdf: $('f-frompdf') ? $('f-frompdf').checked : false,
      requiresHandTyping: $('f-handtyping') ? $('f-handtyping').checked : false,
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
    const totalEl = $('q-total')
    const newTotalText = peso(q.total)
    const changed = totalEl.textContent !== newTotalText && totalEl.textContent !== '–'
    totalEl.textContent = newTotalText
    if (changed) {
      totalEl.classList.remove('bump')
      void totalEl.offsetWidth // restart the CSS animation
      totalEl.classList.add('bump')
    }
    $('q-down').textContent = peso(q.downPayment)
    $('q-breakdown').innerHTML = [
      ['Base (' + q.size.label + ', ' + q.density.label + ') × ' + q.pages, peso(q.pagesTotal)],
      q.volumeDiscountAmt > 0 ? ['Volume discount (−' + Math.round(q.volumePct * 100) + '%)', '−' + peso(q.volumeDiscountAmt)] : null,
      q.diagramsTotal > 0 ? ['Diagrams / illustrations', peso(q.diagramsTotal)] : null,
      q.turnaround.mult !== 1 ? [q.turnaround.label, '×' + q.turnaround.mult] : null,
      q.firstOrderDiscountAmt > 0 ? ['First-order discount (−' + Math.round((q.firstOrderDiscountAmt / q.rushAdjustedTotal) * 100) + '%)', '−' + peso(q.firstOrderDiscountAmt)] : null,
      q.pdfDiscountAmt > 0 ? ['PDF submission discount', '−' + peso(q.pdfDiscountAmt)] : null,
      q.handTypingFeeAmt > 0 ? ['Hand-typing (' + q.pages + ' pg)', '+' + peso(q.handTypingFeeAmt)] : null,
      q.minimumApplied ? ['Minimum order applied', null] : null,
    ].filter(Boolean).map((row) => (
      '<div class="q-row"><span>' + row[0] + '</span>' + (row[1] != null ? '<span>' + row[1] + '</span>' : '') + '</div>'
    )).join('')
    $('q-cap-note').textContent = q.capNote || ''
    $('q-cap-note').style.display = q.capNote ? 'block' : 'none'
    const badge = $('pdf-save-badge')
    if (badge) {
      const amt = (DISK && isFinite(Number(DISK.pdfDiscount))) ? Number(DISK.pdfDiscount) : window.HandPlotterPricing.DEFAULTS.pdfDiscount
      badge.textContent = amt > 0 ? '(save ' + peso(amt) + ')' : ''
    }
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
      q.fromPdf ? "I'll send a PDF (typed text)" : null,
      q.requiresHandTyping ? 'This is a photo/scan -- needs hand-typing' : null,
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

  // isLikelyMobile(): navigator.share() also exists on desktop Windows/Mac,
  // where it opens the OS share sheet (Nearby Sharing, Discord, Outlook,
  // Teams...) with NO Messenger entry at all, because Messenger is a website
  // there, not an installed app the OS knows how to hand text to. Tested
  // live 2026-08-20 -- the desktop share sheet genuinely has nothing useful
  // in it. On a phone, the Messenger APP is what receives shared text, and
  // IS registered as a share target, so this only attempts Web Share where
  // it can actually reach Messenger; everywhere else goes straight to the
  // reliable redirect+copy path below.
  function isLikelyMobile() {
    if (/Android|iPhone|iPod/i.test(navigator.userAgent)) return true
    // iPadOS Safari reports itself as "MacIntel" -- multi-touch is what
    // actually distinguishes an iPad from a real Mac.
    if (/iPad/i.test(navigator.userAgent)) return true
    if (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true
    return false
  }

  // "Send my quote straight to Messenger": no backend, no App Review, and
  // Facebook does not let a plain web link pre-fill a message's TEXT for an
  // arbitrary Page (that would be message injection) -- so book-btn above is
  // the honest ceiling for a bare m.me link: copy + open, customer pastes.
  //
  // navigator.share() gets a real step closer WITHOUT any of that, but ONLY
  // on a phone (see isLikelyMobile above): it hands the quote text to the OS
  // share sheet, the customer taps the Messenger APP, and Messenger opens
  // with that text ALREADY in the compose box -- no manual copy, no manual
  // paste, just review and Send. This is the real mechanism iOS/Android
  // "share to Messenger" buttons use.
  //
  // Everywhere else (desktop, or share() itself failing), this REDIRECTS to
  // Messenger the same reliable way book-btn does (a real m.me link) and
  // copies the quote text so pasting it in is the only manual step left --
  // "opens Messenger" is guaranteed either way, "text already typed" is the
  // part that is only possible where the OS can actually hand it off.
  async function sendQuote() {
    const q = renderEstimate()
    const text = buildSummary(q)
    const status = $('send-status')
    const href = messengerHref()
    if (isLikelyMobile() && navigator.share) {
      try {
        await navigator.share({ text: text })
        status.textContent = 'Shared. If you picked Messenger, review it there and tap Send.'
        return
      } catch (e) {
        // AbortError = the customer closed the share sheet themselves; that
        // is not a failure worth reporting, just quietly stop.
        if (e && e.name === 'AbortError') return
        // Any other failure (no share target chosen, share() unsupported for
        // this content, etc.) falls through to the same copy+open book-btn
        // already relies on -- see below.
      }
    }
    // No Web Share (desktop, or it failed): open Messenger FIRST, still
    // synchronously inside this click handler, THEN copy the text. Opening
    // it AFTER an `await` (the clipboard write used to run first) loses the
    // "this came from a real click" flag some browsers require for
    // window.open -- the popup silently never appears, which is exactly the
    // "doesn't redirect to Messenger" report. book-btn never had this bug
    // because it is a real <a href> the browser navigates natively, not a
    // script-driven window.open.
    const win = href ? window.open(href, '_blank', 'noopener') : null
    try {
      await navigator.clipboard.writeText(text)
      status.textContent = win
        ? 'Copied your quote -- paste it into the Messenger tab that just opened.'
        : 'Copied your quote.'
    } catch (e) {
      $('copy-fallback-text').value = text
      $('copy-fallback').style.display = 'block'
      status.textContent = 'Could not auto-copy -- select the text below and copy it manually.'
    }
    if (href && !win) status.textContent += ' Your browser blocked the pop-up -- use "Message us on Facebook to book" above instead.'
  }
  function initSendButton() {
    const btn = $('send-btn'); if (!btn) return
    btn.addEventListener('click', () => { sendQuote() })
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

  // Sticky header grows a shadow (and shrinks the wordmark slightly) once
  // the page has scrolled -- a cheap, common "the page is alive" cue.
  function initHeaderScroll() {
    const header = $('site-header')
    if (!header) return
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('scrolled')
      else header.classList.remove('scrolled')
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  // Fade/slide each major section in as it enters the viewport. Falls back
  // to showing everything immediately if IntersectionObserver is missing
  // (very old browsers) -- content must never depend on JS running.
  function initRevealObserver() {
    const els = document.querySelectorAll('.reveal')
    if (!('IntersectionObserver' in window) || !els.length) {
      els.forEach((el) => el.classList.add('in-view'))
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view')
          io.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    els.forEach((el) => io.observe(el))
  }

  async function init() {
    const loaded = await window.HandPlotterPricing.loadRates()
    DISK = loaded.disk
    META = loaded.meta
    renderFreshnessBanner()

    const CAT = window.HandPlotterPricing.catalogFor(DISK)
    fillPillGroup($('f-size'), CAT.sizes, 'a4')
    fillPillGroup($('f-density'), CAT.densities, 'standard')
    fillPillGroup($('f-turnaround'), CAT.turnarounds, CAT.turnarounds[0].id)

    wireStepper($('f-pieces'), { min: 1, valueSelector: '.qty-val' })
    ;['f-diag-simple', 'f-diag-moderate', 'f-diag-complex'].forEach((id) => {
      wireStepper($(id), { min: 0, valueSelector: '.step-val' })
    })
    $('f-first').addEventListener('change', renderEstimate)
    // Submitting a PDF and needing hand-typing are opposite paths (machine-
    // readable text vs. a photo/scan someone has to retype) -- checking one
    // clears the other so the price never reflects a contradiction.
    if ($('f-frompdf') && $('f-handtyping')) {
      $('f-frompdf').addEventListener('change', () => { if ($('f-frompdf').checked) $('f-handtyping').checked = false; renderEstimate() })
      $('f-handtyping').addEventListener('change', () => { if ($('f-handtyping').checked) $('f-frompdf').checked = false; renderEstimate() })
    }

    $('book-btn').addEventListener('click', (e) => {
      if (!messengerHref()) { e.preventDefault(); return }
      copySummary()
    })
    initSendButton()

    initMessengerLinks()
    renderEstimate()
    loadProofPhotos()
    loadHandwritingSamples()
    initHeaderScroll()
    initRevealObserver()
  }

  document.addEventListener('DOMContentLoaded', init)
})()
