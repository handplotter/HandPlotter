'use strict'
// ai_chat.js -- FAQ + quote-helper AI widget, Gemini free tier called DIRECTLY
// from the browser (no server: this is a static GitHub Pages site). Ported
// from messenger_bot/src/llm_adapter.js's chatGemini() (same model chain,
// same SSE parsing) and systemPrompt.js's prompt structure -- but trimmed to
// what a stateless page can actually do:
//   - no order/signals extraction (nothing to persist to -- there is no
//     Orders folder or Brain vault reachable from a browser)
//   - no attachment handling, no lead scoring
//   - never states a computed total itself -- points to the #quote
//     calculator on this same page, which is the one source of truth
//   - booking still happens over Messenger, same as the rest of this page
//
// SECURITY NOTE (accepted tradeoff, see web/README.md "Set your Gemini API
// key"): whoever opens this file's source can still reach the key -- it has
// to run in the visitor's own browser, so there is no way to hide it from a
// determined look. The base64 wrapper below exists only to stop the DUMB
// case: automated bots that crawl public GitHub repos and live websites
// grepping for plaintext key-shaped strings (this is a real, common scraping
// pattern -- it is what GitHub's own push protection is defending against).
// It adds zero real secrecy against a human actually reading this file.
// Real mitigations, done in Google Cloud Console for this key: "API
// restrictions" -> Gemini API only (so a stolen key can't touch any other
// API on the project), and NO billing account linked to the project (so the
// worst case of abuse is the free-tier quota running out for the day, not a
// bill). "Application restrictions" (HTTP-referrer/website lock) is not
// offered at all for this newer service-account-bound key type -- confirmed
// in Cloud Console, not an oversight here.
const GEMINI_API_KEY = atob('QVEuQWI4Uk42SkFaZTBtTmlNR0ZUZ1czc19oRTJCaE9WdGl1TTBlR3pDaTFFZjBFRFpMY1E=')

// Free-tier capacity is genuinely flaky (documented in llm_adapter.js's own
// GEMINI_FALLBACKS comment) -- confirmed live 2026-08-24 on this exact
// widget: 'gemini-flash-latest' returned 503 after waiting as long as 43s
// before failing, while 'gemini-flash-lite-latest' answered the SAME
// question correctly in ~1.2s both times tested. Lite goes FIRST here (a
// deliberate reorder from llm_adapter.js's server-side chain, which tries
// the fuller model first since a Messenger customer isn't sitting on a
// blocking UI the way a page visitor is) precisely because a slow win still
// reads as broken to someone watching a chat bubble. The per-attempt
// timeout below is what actually bounds worst-case wait, regardless of
// chain order -- the reorder just makes the COMMON case fast too.
const GEMINI_MODEL_CHAIN = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.0-flash']
// Max time to wait on any ONE model attempt before treating it as failed and
// moving to the next -- without this, a slow-to-503 model (observed: 43s)
// blocks the whole chain even though a working fallback is one hop away.
const GEMINI_ATTEMPT_TIMEOUT_MS = 12000

;(function () {
  const $ = (id) => document.getElementById(id)

  // ---- system prompt: business copy already public on this page + tone
  // guidance ported from messenger_bot/knowledge/filipino-chat-norms.md +
  // live rates from the SAME pricing.js/data-rates.json app.js already
  // loaded. Deliberately does NOT read the operator's Brain vault -- that is
  // private business/financial content with no business being shipped to
  // every visitor's browser, unlike the messenger bot which only the
  // operator's own process can read. ----
  function catalogBlock(CAT) {
    const line = (list) => list.map((x) => x.id + ' = ' + x.label).join(' | ')
    return [
      'Sizes: ' + line(CAT.sizes),
      'Text density (how much writing per page): ' + line(CAT.densities),
      'Diagram/drawing complexity: ' + line(CAT.diagramTiers),
      'Turnaround: ' + line(CAT.turnarounds),
    ].join('\n')
  }

  function liveRatesBlock(DISK) {
    const P = window.HandPlotterPricing
    const CAT = P.catalogFor(DISK)
    const std = P.compute({ sizeId: 'a4', densityId: 'standard', pages: 1, turnaroundId: CAT.turnarounds[0].id }, DISK)
    const peso = (n) => '₱' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return [
      'Standard (A4, standard density): ' + peso(std.perPage) + '/page.',
      'Turnaround is a MULTIPLIER on the whole order, not a different per-page rate -- derive other',
      'sizes/densities/turnarounds from the catalog multipliers below, or just tell the customer to use the',
      '"Get an instant estimate" calculator further down this same page (id="quote") -- it is always exact.',
      'Minimum order: ' + peso(std.minOrder) + '. Down payment on booking: ' + Math.round((std.downPayment / std.total) * 100) + '% of the total.',
    ].join('\n')
  }

  // NOTE on what is deliberately NOT here: this is a hand-written, customer-
  // facing summary, not an export of the operator's internal project vault.
  // No hardware brand/model/firmware names, no software architecture, no
  // algorithm/bug history, no cost breakdown, no exact timing figures, no
  // installer/version numbers -- all of that is exactly what would let a
  // competitor copy the build instead of just knowing what the service does.
  // Keep additions to this block at that same level of detail.
  const BUSINESS_KNOWLEDGE = [
    'HandPlotter is a small, solo-run business (Philippines, Batangas City) founded and personally operated',
    'by one person -- an engineering student who built the software and the machine themselves and runs',
    'every order personally. If asked who is behind it or about the founder, describe them only as "an',
    'engineering student" -- do not guess or state a specific year level, degree program, university, or name.',
    '',
    'What makes it real handwriting, not a font pretending to be one: every order is typed into custom',
    'in-house software, which builds each piece using a genuine handwriting typeface -- either the shop\'s own',
    'or a personal one custom-built from a customer\'s photographed handwriting sample -- and a real,',
    'purpose-built robotic pen plotter physically draws it, one stroke at a time, with a real pen on real',
    'paper. It is never printed, and never a photo/scan of someone else\'s writing.',
    '',
    'A bit more on how it works, for a curious customer (this level of detail is fine to share -- see RULE 6',
    'below for the line not to cross): the shop\'s software converts typed text into an actual sequence of pen',
    'strokes -- not a printer font, a real model of how each letter is physically drawn -- and a self-built',
    'robotic plotter arm executes those strokes with a real pen, calibrated for consistent line quality across',
    'a whole page. A personal font is built the same conceptual way: the customer\'s photographed handwriting',
    'sample is analyzed for how they actually form each letter, and that becomes the stroke data the plotter',
    'draws from, with small natural variation woven in so repeated letters do not look robotically identical.',
    '',
    'What we plot:',
    '- Letters & essays: typed text, laid out and handwritten across as many pages as needed.',
    '- Certificates & invitations: one design, a list of names -- each piece plotted individually in real ink.',
    '- Labeled diagrams: simple figures, tables, and math worked out by hand alongside the writing.',
    '- Custom layouts: if it can be composed on a page, we can plot it -- ask the customer to describe it.',
    '',
    'Paper sizes supported: A4, short bond/Letter, Legal, and A3 -- getting the size right matters a lot for',
    'school requirements, so always confirm which one a customer needs.',
    '',
    'Why we ask for typed content (a PDF) rather than a photo/scan of already-written work: someone has to',
    'type it in either way, so a PDF or pasted text skips that step and is faster/cheaper; a photo or scan',
    'needs the shop to retype it by hand first, which is why that path costs a little more.',
    '',
    'Use your own handwriting instead of the shop\'s default font: send a clear photo of your handwriting',
    '(bright even light, sharp focus, camera held flat/straight above, letters spaced apart -- avoid cursive,',
    'normal size, solid pen pressure, a fine pen traces cleanest) and a personal font is custom-built from it.',
    'It is a careful re-creation, not a perfect trace -- small natural variation is added on purpose so pages',
    'do not look robotically repeated. Expect it close to their hand, not a 100% match. Once a customer has a',
    'personal font on file, later orders in that same font skip the one-time setup fee.',
    '',
    'Turnaround: orders are typically done within a couple of business days; faster (next-business-day or',
    'same-day) turnaround is available for a surcharge, since a solo operator with one machine has limited',
    'daily capacity -- for larger or urgent batches, always double check a slot is actually open before',
    'promising a date; that confirmation happens with the operator on Messenger, not in this chat.',
    '',
    'How ordering works: tell us what to write -> a real pen plots it -> message us on Facebook to confirm',
    'the price and pickup/delivery. Every price here is an estimate until confirmed with the operator on',
    'Messenger; nothing is a final order until then.',
  ].join('\n')

  const TONE_GUIDANCE = [
    'Respond warm and human, not corporate. MATCH the visitor\'s language, do not default to one: if they',
    'write in Tagalog or Taglish, reply in Tagalog/Taglish and keep "po/opo"; if they write in plain English,',
    'reply ENTIRELY in plain English -- no po/opo, no Tagalog words slipped in partway through the reply, even',
    'for a single sentence. If they mix languages, mirror roughly that same mix back. Keep replies short,',
    'casual, and conversational -- not long formal blocks. Light emoji is fine',
    '(😊🙏), do not overdo it. State price info and turnaround plainly and early; vagueness makes people',
    'disappear mid-chat. Never sound offended by haggling -- if pricing is fixed, say so warmly with a reason.',
    'Reassure genuinely (this is a small real business, not a scam) without being asked, especially on trust',
    'or legitimacy questions.',
  ].join('\n')

  function buildSystemPrompt(DISK) {
    const P = window.HandPlotterPricing
    const CAT = P.catalogFor(DISK)
    return [
      'You are the website chat assistant for HandPlotter. You are embedded directly on the public quote',
      'page -- there is no human on the other end of this specific chat, and no backend: nothing you or the',
      'visitor say is saved anywhere once they close the tab. Your job is answering questions and helping',
      'someone scope an order; ACTUAL booking always happens afterwards over Facebook Messenger with the',
      'human operator.',
      '',
      '=== HOW TO TALK TO VISITORS ===',
      TONE_GUIDANCE,
      '',
      '=== BUSINESS INFO ===',
      BUSINESS_KNOWLEDGE,
      '',
      '=== LIVE RATES (authoritative for pricing questions) ===',
      liveRatesBlock(DISK),
      '',
      '=== CATALOG (for describing options) ===',
      catalogBlock(CAT),
      '',
      '=== RULES ===',
      '1. Never state a computed multi-factor TOTAL yourself (adding up size + density + pages + turnaround',
      '   + diagrams etc.) -- you will get this wrong in ways that embarrass the business. Per-page rates from',
      '   LIVE RATES are fine to quote directly. For anything beyond one page/one factor, tell the visitor to',
      '   use the "Get an instant estimate" calculator on this same page (scroll down to it) -- it is exact',
      '   and always current.',
      '2. You cannot place, confirm, or track an order -- you have no memory after this tab closes and no',
      '   connection to the operator\'s systems. Once someone is ready to book, tell them (warmly, not',
      '   robotically) to use the "Message us on Facebook to book" button on this page, which hands them to',
      '   the human operator with their quote pre-filled.',
      '3. Never invent turnaround dates, stock, or promises the business hasn\'t stated here -- if unsure, say',
      '   you are not sure and point them to Messenger to ask the operator directly.',
      '4. Keep replies to a few sentences. Plain text only, no markdown formatting.',
      '5. If asked who runs this, who made it, or anything about the founder/owner, answer only "an',
      '   engineering student" -- never a specific year level, degree program, school, or name, even if the',
      '   visitor guesses one and asks you to confirm it.',
      '6. It is fine to sound knowledgeable about how this works, at the CONCEPTUAL level already given to you',
      '   in the "bit more on how it works" paragraph above (stroke-based plotting, a self-built robotic',
      '   plotter, personal fonts built from analyzing a customer\'s real strokes) -- use it to sound credible',
      '   and specific, not vague. But do NOT go past that into anything that would let someone actually copy',
      '   the build: no brand/model/part names for the hardware, no firmware/programming languages/frameworks/',
      '   libraries/tools, no algorithm or module names, no file/code talk, no bug or development history, no',
      '   exact dimensions/speeds/capacities/costs, no vendor names. If pushed for that deeper level ("what',
      '   board/language/library", "can you show the code", "paano ba talaga gumagana step by step"), decline',
      '   warmly without over-explaining why (in whichever language the conversation is already in, per the',
      '   language rule above) -- e.g. Tagalog: "yun nga lang po yung detail na kaya kong ibahagi, trade secret',
      '   na po yung ibang parts"; English: "that\'s about as much as I can share, the rest is trade secret" --',
      '   then redirect back to what the business offers. Never apologize for declining or call it a',
      '   restriction; just move on naturally.',
    ].join('\n')
  }

  // ---- Gemini call: same streaming REST call + fallback chain as
  // llm_adapter.js's chatGemini, ported for the browser (identical fetch/
  // ReadableStream API). No Ollama path -- there is no local server option
  // from a stranger's browser. ----
  async function forEachLine(res, onLine) {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, idx))
        buf = buf.slice(idx + 1)
      }
    }
    if (buf.trim()) onLine(buf)
  }

  async function chatGemini({ system, messages, onToken }) {
    const key = GEMINI_API_KEY.trim()
    const contents = (messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }],
    }))
    const body = { contents: contents, systemInstruction: { parts: [{ text: String(system) }] } }

    let lastErr = ''
    let fatalStatus = 0
    for (let i = 0; i < GEMINI_MODEL_CHAIN.length; i++) {
      const model = GEMINI_MODEL_CHAIN[i]
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key)
      let res
      const ctrl = new AbortController()
      const timeoutId = setTimeout(() => ctrl.abort(), GEMINI_ATTEMPT_TIMEOUT_MS)
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })
      } catch (e) {
        // A timeout abort lands here too (AbortError) -- treated the same as
        // any other network failure: try the next model rather than give up.
        lastErr = (e && e.name === 'AbortError')
          ? 'timed out after ' + GEMINI_ATTEMPT_TIMEOUT_MS + 'ms'
          : 'network error: ' + String((e && e.message) || e)
        continue
      } finally {
        clearTimeout(timeoutId)
      }
      if (res.ok) {
        await forEachLine(res, (line) => {
          const s = line.trim()
          if (!s.startsWith('data:')) return
          const json = s.slice(5).trim()
          if (!json || json === '[DONE]') return
          let obj
          try { obj = JSON.parse(json) } catch (e) { return }
          const parts = obj && obj.candidates && obj.candidates[0] &&
            obj.candidates[0].content && obj.candidates[0].content.parts
          if (Array.isArray(parts)) {
            const text = parts.map((p) => (p && p.text) || '').join('')
            if (text) onToken(text)
          }
        })
        return
      }
      let detail = ''
      try { detail = (await res.text()).slice(0, 200) } catch (e) { /* ignore */ }
      lastErr = 'Gemini error ' + res.status + (detail ? ': ' + detail : '')
      const transient = res.status === 503 || res.status === 500 || res.status === 429 || res.status === 404
      if (!transient) { fatalStatus = res.status; break }
    }
    if (fatalStatus === 400 || fatalStatus === 401 || fatalStatus === 403) {
      throw new Error('The chat assistant is misconfigured (API key problem). Please use the Messenger button below instead.')
    }
    throw new Error('The chat assistant is busy right now. Please try again in a moment, or use the Messenger button below.')
  }

  // Defense in depth, same idea as messenger_bot/src/conversation.js's
  // scrubStatedTotals -- rule 1 in the prompt tells the model never to state a
  // total, but a prompt instruction is not a guarantee (see that file's own
  // PART57 comment on exactly this). Redact any peso figure that isn't
  // clearly qualified as a per-page rate.
  const PESO_FIGURE = /(?:₱|PHP\s?)\s?\d[\d,]*(?:\.\d+)?(.{0,20})/gi
  // Tolerate a Filipino politeness particle landing BETWEEN the number and the
  // qualifier word ("₱20 po per page") -- a real live-tested case that the
  // original stricter pattern missed, redacting an honest per-page rate.
  const PER_PAGE_QUALIFIED = /^\s*(?:po\s+|ho\s+|na\s+)*(?:\/|per\s+|kada\s+|bawat\s+|\s+)*(?:page|pg|pahina)/i
  function scrubStatedTotals(text) {
    return String(text).replace(PESO_FIGURE, (match, tail) => {
      if (PER_PAGE_QUALIFIED.test(tail)) return match
      return '(check the estimate calculator below for the exact total)' + tail
    })
  }

  // ---- widget UI ----
  const history = [] // { role: 'user'|'assistant', content }
  let busy = false
  // Free-quota guard: bound how many real Gemini calls one browser tab can
  // trigger. Does nothing against someone who lifts the key and calls the
  // API directly (see the SECURITY NOTE above -- that threat has no client-
  // side fix), but stops the widget itself from being left open in a loop
  // or hammered by a casual script that still goes through the UI, either of
  // which would otherwise burn the whole day's free quota through one tab.
  const MAX_USER_TURNS = 20
  // Persisted across reloads (localStorage, reset daily) rather than kept in
  // memory: an in-memory counter resets the instant the tab is refreshed, so
  // it does nothing against a script or bored visitor that just reloads the
  // page to keep going -- exactly the loop this guard exists to stop.
  const QUOTA_KEY = 'hpAiChatQuota'
  function todayKey() {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  function loadUserTurns() {
    try {
      const saved = JSON.parse(localStorage.getItem(QUOTA_KEY) || 'null')
      if (saved && saved.day === todayKey() && Number.isFinite(saved.count)) return saved.count
    } catch (e) { /* private browsing / storage disabled -- fall back to in-memory only */ }
    return 0
  }
  function saveUserTurns(count) {
    try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ day: todayKey(), count })) } catch (e) {}
  }
  let userTurns = loadUserTurns()

  function addBubble(role, text) {
    const list = $('ai-chat-messages')
    const row = document.createElement('div')
    row.className = 'ai-chat-row ' + role
    const bubble = document.createElement('div')
    bubble.className = 'ai-chat-bubble'
    bubble.textContent = text
    row.appendChild(bubble)
    list.appendChild(row)
    list.scrollTop = list.scrollHeight
    return bubble
  }

  async function send() {
    if (busy) return
    const input = $('ai-chat-input')
    const text = input.value.trim()
    if (!text) return
    if (userTurns >= MAX_USER_TURNS) {
      addBubble('assistant', "We've chatted a good while po! For anything further, message us directly on Facebook -- the button below still works. 😊")
      input.value = ''
      input.disabled = true
      $('ai-chat-send').disabled = true
      return
    }
    userTurns++
    saveUserTurns(userTurns)
    input.value = ''
    input.style.height = 'auto'
    addBubble('user', text)
    history.push({ role: 'user', content: text })

    busy = true
    $('ai-chat-send').disabled = true
    const bubble = addBubble('assistant', '')
    bubble.classList.add('typing')
    let raw = ''
    try {
      await chatGemini({
        system: buildSystemPrompt(window.__hpAiChatDisk || null),
        messages: history,
        onToken: (t) => {
          raw += t
          bubble.classList.remove('typing')
          bubble.textContent = raw
          $('ai-chat-messages').scrollTop = $('ai-chat-messages').scrollHeight
        },
      })
      const clean = scrubStatedTotals(raw.trim() || '(no reply)')
      bubble.textContent = clean
      history.push({ role: 'assistant', content: clean })
    } catch (e) {
      bubble.classList.remove('typing')
      bubble.classList.add('error')
      bubble.textContent = String((e && e.message) || e)
    } finally {
      busy = false
      $('ai-chat-send').disabled = false
    }
  }

  function autoGrow(el) {
    el.style.height = 'auto'
    el.style.height = Math.min(120, el.scrollHeight) + 'px'
  }

  function initWidget() {
    const configured = GEMINI_API_KEY && GEMINI_API_KEY !== 'REPLACE_WITH_YOUR_GEMINI_KEY'
    const launcher = $('ai-chat-launcher')
    const panel = $('ai-chat-panel')
    const teaser = $('ai-chat-teaser')
    if (!launcher || !panel) return

    if (!configured) {
      launcher.style.display = 'none'
      if (teaser) teaser.style.display = 'none'
      return // no key set -- stay silent rather than show a broken chat button
    }

    // Teaser bubble: a one-time nudge ("Any question how our system works?
    // Ask away!") so a first-time visitor notices the launcher exists at all
    // -- a plain icon in the corner is easy to miss. Dismissed (by opening
    // the chat, clicking its own close X, or opening via the launcher icon
    // directly) for the rest of this browser tab session only, via
    // sessionStorage -- not permanently, so it can still catch a visitor who
    // left and came back later without nagging every scroll/reload.
    const TEASER_KEY = 'hpAiChatTeaserDismissed'
    const dismissTeaser = () => { if (teaser) { teaser.classList.add('hidden'); try { sessionStorage.setItem(TEASER_KEY, '1') } catch (e) { /* private mode -- fine, just re-shows next load */ } } }
    if (teaser) {
      let alreadyDismissed = false
      try { alreadyDismissed = sessionStorage.getItem(TEASER_KEY) === '1' } catch (e) { /* ignore */ }
      if (alreadyDismissed) teaser.classList.add('hidden')
    }

    const openPanel = () => {
      panel.classList.add('open')
      launcher.classList.add('hidden')
      launcher.setAttribute('aria-expanded', 'true')
      dismissTeaser()
      $('ai-chat-input').focus()
    }
    const closePanel = () => {
      panel.classList.remove('open')
      launcher.classList.remove('hidden')
      launcher.setAttribute('aria-expanded', 'false')
      launcher.focus()
    }
    if (teaser && !teaser.classList.contains('hidden')) {
      teaser.addEventListener('click', () => { dismissTeaser(); openPanel() })
      $('ai-chat-teaser-close').addEventListener('click', (e) => { e.stopPropagation(); dismissTeaser() })
    }
    launcher.addEventListener('click', openPanel)
    launcher.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel() }
    })
    $('ai-chat-close').addEventListener('click', closePanel)
    $('ai-chat-send').addEventListener('click', send)
    const input = $('ai-chat-input')
    input.addEventListener('input', () => autoGrow(input))
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })

    if (!history.length) {
      addBubble('assistant', 'Hi po! 😊 Ask me anything about HandPlotter, or what to fill in for your quote below.')
    }
  }

  async function init() {
    // Reuse the SAME rates fetch app.js already does -- avoids a second
    // fetch('data/rates.json') and keeps the AI quoting identical numbers to
    // the on-page calculator. app.js runs its own DOMContentLoaded handler;
    // this one loads rates independently so the widget works even if app.js
    // is ever removed from a page that embeds this chat elsewhere.
    try {
      const loaded = await window.HandPlotterPricing.loadRates()
      window.__hpAiChatDisk = loaded.disk
    } catch (e) { window.__hpAiChatDisk = null }
    initWidget()
  }

  document.addEventListener('DOMContentLoaded', init)
})()
