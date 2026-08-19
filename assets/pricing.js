'use strict'
// pricing.js -- the estimate formula, ported verbatim from
// messenger_bot/src/pricing.js's compute() (itself a port of the in-app
// PricingEngine in app/src/index.html, ~line 8868). THREE copies of this
// formula now exist across the project (app / bot / this site) -- see
// WEB_INTAKE_PLAN.md's note that a fourth reader is exactly the drift this
// file's own history warns about. If you change the arithmetic, change it in
// all three and re-check them against each other; do not tune this copy
// separately -- that IS the staleness bug.
//
// CATALOG / DEFAULTS below are ONLY the offline fallback: first load before
// data/rates.json exists, a fetch failure (e.g. opening this file directly
// off disk), or a stale cache. The moment data/rates.json is present (the
// app's "Export rate card for website" button writes it -- see
// index.html's qc-settings-export-web handler), its numbers win. This page
// never guesses silently: HP_RATES_META (set by loadRates) records whether
// the live file loaded, and app.js surfaces that to the visitor instead of
// quoting stale numbers as if they were current.

window.HandPlotterPricing = (function () {
  const CATALOG = {
    sizes: [
      { id: 'a6', label: 'A6 / card stock' },
      { id: 'a5', label: 'A5' },
      { id: 'a4', label: 'A4 (standard)' },
      { id: 'long', label: 'Long bond (8.5×13)' },
      { id: 'a3', label: 'A3' },
    ],
    densities: [
      { id: 'light', label: 'Light (≤ 75 words/pg)' },
      { id: 'standard', label: 'Standard (76–200 words/pg)' },
      { id: 'full', label: 'Full (201–400 words/pg)' },
      { id: 'max', label: 'Max (400+ words/pg)' },
    ],
    diagramTiers: [
      { id: 'simple', label: 'Simple (box / arrow / basic chart)' },
      { id: 'moderate', label: 'Moderate (table / labeled figure)' },
      { id: 'complex', label: 'Complex (custom illustration)' },
    ],
    turnarounds: [
      { id: 'regular', label: 'Regular (2 business days)' },
      { id: 'semi-rush', label: 'Semi-rush (next business day)' },
      { id: 'rush', label: 'Rush (same day)' },
    ],
    volumeTiers: [
      { id: 'v20', min: 20, label: '20+ pages' },
      { id: 'v10', min: 10, label: '10–19 pages' },
      { id: 'v5', min: 5, label: '5–9 pages' },
    ],
  }

  const DEFAULTS = {
    base: 60,
    sizeMult: { a6: 0.45, a5: 0.60, a4: 1.00, long: 1.15, a3: 2.00 },
    densityMult: { light: 0.60, standard: 1.00, full: 1.50, max: 2.00 },
    diagramFee: { simple: 20, moderate: 40, complex: 80 },
    volumePct: { v20: 0.15, v10: 0.10, v5: 0.05 },
    turnaroundMult: { regular: 1.0, 'semi-rush': 1.5, rush: 2.5 },
    turnaroundCap: { regular: null, 'semi-rush': 10, rush: 5 },
    minOrder: 100,
    firstOrderDiscount: 0.10,
    downPaymentPct: 0.50,
  }

  const clone = (o) => JSON.parse(JSON.stringify(o))

  // Shape-preserving overlay, identical logic to the bot's mergeOver: copies
  // every numeric key the exported file carries under a known group, so a
  // size/tier the operator added in-app arrives here with its multiplier
  // intact instead of silently dropping to the DEFAULTS fallback.
  function mergeOver(input) {
    const out = clone(DEFAULTS)
    input = input || {}
    for (const g of Object.keys(DEFAULTS)) {
      if (input[g] == null) continue
      if (typeof DEFAULTS[g] === 'object' && DEFAULTS[g] !== null) {
        for (const k of Object.keys(input[g])) {
          const v = input[g][k]
          if (v != null && isFinite(Number(v))) out[g][k] = Number(v)
          else if (v === null) out[g][k] = null
        }
      } else if (isFinite(Number(input[g]))) {
        out[g] = Number(input[g])
      }
    }
    return out
  }

  function mergedCatalog(disk) {
    const c = disk && disk.__catalog
    const list = (x) => Array.isArray(x) && x.length > 0 && x.every((e) => e && typeof e.id === 'string')
    if (c && list(c.sizes) && list(c.densities) && list(c.turnarounds) && list(c.diagramTiers)) return c
    return CATALOG
  }

  const labelFor = (list, id) => { const f = list.find((x) => x.id === id); return f ? f.label : id }

  function volumePctFor(pages, cfg) {
    if (pages >= 20) return cfg.volumePct.v20
    if (pages >= 10) return cfg.volumePct.v10
    if (pages >= 5) return cfg.volumePct.v5
    return 0
  }

  // compute(params, disk): disk is the parsed data/rates.json (or null to use
  // the offline DEFAULTS/CATALOG above). Same params shape and same return
  // shape as the app/bot engines -- see their compute() for field meanings.
  function compute(params, disk) {
    const cfg = mergeOver(disk)
    const CAT = mergedCatalog(disk)
    const p = params || {}
    const sizeId = CAT.sizes.some((s) => s.id === p.sizeId) ? p.sizeId : CAT.sizes[0].id
    const densityId = CAT.densities.some((d) => d.id === p.densityId) ? p.densityId : CAT.densities[1].id
    const turnaroundId = CAT.turnarounds.some((t) => t.id === p.turnaroundId) ? p.turnaroundId : CAT.turnarounds[0].id
    const pages = Math.max(1, Math.round(Number(p.pages) || 1))
    const diagrams = p.diagrams || {}

    const num = (v, d) => (v != null && isFinite(Number(v))) ? Number(v) : d
    const sizeMult = num(cfg.sizeMult[sizeId], 1)
    const densityMult = num(cfg.densityMult[densityId], 1)
    const perPage = cfg.base * sizeMult * densityMult
    const pagesTotal = perPage * pages

    const diagramLines = CAT.diagramTiers.map((t) => {
      const qty = Math.max(0, Math.round(Number(diagrams[t.id]) || 0))
      const fee = num(cfg.diagramFee[t.id], 0)
      return { id: t.id, label: t.label, qty: qty, fee: fee, lineTotal: qty * fee }
    })
    const diagramsTotal = diagramLines.reduce((s, l) => s + l.lineTotal, 0)

    const volumePct = volumePctFor(pages, cfg)
    const volumeDiscountAmt = pagesTotal * volumePct
    const orderSubtotal = (pagesTotal - volumeDiscountAmt) + diagramsTotal

    const turnaroundMult = num(cfg.turnaroundMult[turnaroundId], 1)
    const turnaroundCap = cfg.turnaroundCap[turnaroundId] == null ? null : Number(cfg.turnaroundCap[turnaroundId])
    const rushAdjustedTotal = orderSubtotal * turnaroundMult

    const firstOrderDiscountAmt = p.firstOrder ? rushAdjustedTotal * cfg.firstOrderDiscount : 0
    const afterFirstOrder = rushAdjustedTotal - firstOrderDiscountAmt

    const total = Math.round(Math.max(cfg.minOrder, afterFirstOrder) * 100) / 100
    const minimumApplied = total > Math.round(afterFirstOrder * 100) / 100
    const downPayment = Math.round(total * cfg.downPaymentPct * 100) / 100

    const turnaroundLabel = labelFor(CAT.turnarounds, turnaroundId)
    const capNote = (turnaroundCap && pages > turnaroundCap)
      ? (turnaroundLabel + ' is normally capped at ' + turnaroundCap + ' pieces for a batch this size — we will confirm a slot is actually open before promising this date.')
      : null

    return {
      size: { id: sizeId, label: labelFor(CAT.sizes, sizeId), mult: sizeMult },
      density: { id: densityId, label: labelFor(CAT.densities, densityId), mult: densityMult },
      pages: pages,
      turnaround: { id: turnaroundId, label: turnaroundLabel, mult: turnaroundMult, cap: turnaroundCap },
      perPage: perPage, pagesTotal: pagesTotal,
      diagramLines: diagramLines, diagramsTotal: diagramsTotal,
      volumePct: volumePct, volumeDiscountAmt: volumeDiscountAmt,
      orderSubtotal: orderSubtotal, rushAdjustedTotal: rushAdjustedTotal,
      firstOrder: !!p.firstOrder, firstOrderDiscountAmt: firstOrderDiscountAmt,
      minimumApplied: minimumApplied, minOrder: cfg.minOrder,
      total: total, downPayment: downPayment, capNote: capNote,
    }
  }

  // loadRates(): fetch data/rates.json (same-origin relative path -- works on
  // GitHub Pages, any static host, and local `python -m http.server`; fetch()
  // rejects on file:// with no server, which is the one case app.js's catch
  // has to cover). Returns { disk, meta } where disk feeds compute() above and
  // meta records live-vs-fallback + the export timestamp for the UI to show.
  async function loadRates() {
    try {
      const res = await fetch('data/rates.json', { cache: 'no-store' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const disk = await res.json()
      return { disk: disk, meta: { live: true, generatedAt: disk.generatedAt || null } }
    } catch (e) {
      return { disk: null, meta: { live: false, generatedAt: null, error: String(e) } }
    }
  }

  // catalogFor(disk): the SAME catalog-selection logic compute() uses
  // internally, exposed so app.js builds its dropdowns from the identical
  // source compute() will actually price against -- never a second copy that
  // could disagree with it.
  function catalogFor(disk) { return mergedCatalog(disk) }

  return { CATALOG: CATALOG, DEFAULTS: DEFAULTS, compute: compute, loadRates: loadRates, catalogFor: catalogFor }
})()
