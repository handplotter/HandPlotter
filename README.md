# HandPlotter quote page

A single static page: instant order estimate + a "Message us on Facebook to
book" button. No server, no database, no submission endpoint -- see
`WEB_INTAKE_PLAN.md` sections D2/D4/6.5 for why that's deliberate. Free to
host, works while your PC is off, nothing here can go down but the host
itself.

## Before you publish (do these in order)

### 1. Set your Messenger Page

Open `assets/app.js` and change the first real line of code:

```js
const MESSENGER_PAGE_USERNAME = 'REPLACE_WITH_YOUR_PAGE_USERNAME'
```

Use your Page's username (the part after `facebook.com/` in your Page URL),
not the Page's display name. Until this is set, the button on the page stays
visibly disabled with a warning banner -- that's intentional, so a forgotten
step is obvious instead of silently linking nowhere.

### 2. Export real rates from the app

The page ships with the same *example* numbers as the app's defaults, and
says so ("Showing example rates"). Before this goes live, publish your real,
tuned rate card:

1. Open the Electron app -> **Orders** tab -> **Rate settings** (this is the
   same panel that already computes your in-app quotations).
2. Click **"Export rate card for website..."**.
3. Save it as `handplotter_rates.json`, then move/rename it to
   **`web/data/rates.json`** in this repo, overwriting the placeholder.
4. Commit and redeploy.

The page will then show "Rates last published \<date\>" instead of the
example-rates warning. **There is no auto-sync** -- if you retune rates in the
app later, repeat this export, or the site will keep quoting the old numbers
(clearly labeled as example/estimate either way, so nothing is silently
wrong, but the estimate itself will drift). See `WEB_INTAKE_PLAN.md`'s note on
why a fourth undead copy of the pricing formula is exactly the bug this
export step exists to prevent -- `assets/pricing.js` is a faithful port of
`messenger_bot/src/pricing.js`'s `compute()`; if you ever change the pricing
*formula* (not just the numbers), update it in both places.

### 3. Replace the photo placeholder

`index.html`'s `#proof` section is a clearly-marked placeholder box, not a
real gallery -- there was no plotted output to photograph yet when this page
was built. Before publishing:

1. Plot 2-4 real pieces.
2. Photograph the ink up close (line quality) and a full finished page.
3. Drop the images into `assets/`.
4. Replace the `<div class="proof-placeholder">...</div>` block in
   `index.html` with an `<img>` gallery.

Do not publish the link with the placeholder still showing -- a proof section
with no proof undercuts the whole page.

## Deploying (GitHub Pages, free)

1. Push this `web/` folder's contents to a GitHub repo (a new repo, or a
   `docs/` folder / `gh-pages` branch of an existing one -- GitHub Pages
   supports either).
2. Repo Settings -> Pages -> pick the branch/folder -> Save.
3. GitHub gives you a URL like `https://<username>.github.io/<repo>/`. That's
   your link -- put it in your Facebook Page's bio/services and anywhere else
   you point people.

No build step: it's plain HTML/CSS/JS, so "deploy" is just "the files are on
the host." Any static host (Cloudflare Pages, Netlify) works the same way if
you'd rather use one of those instead.

## How the estimate works

`assets/pricing.js` is `compute()` ported line-for-line from
`messenger_bot/src/pricing.js` (itself mirroring the in-app `PricingEngine`
in `app/src/index.html`). It fetches `data/rates.json` at page load; if that
fetch fails (offline testing, opening the file directly instead of via a
server, or the export step above was skipped) it falls back to the same
`DEFAULTS`/`CATALOG` literals baked into the module, and the banner says so.

**If you ever change the pricing formula** (not just retune numbers), the
change has to be made in three places for the estimate to stay honest:
`app/src/index.html`'s `PricingEngine`, `messenger_bot/src/pricing.js`, and
this file. `WEB_INTAKE_PLAN.md` proposes extracting a real `shared/pricing.js`
so this stops being three hand-synced copies -- worth doing if this page
proves itself and the formula starts changing often.

## What deliberately is NOT here

- **No submission backend.** "Book" copies a summary to the clipboard and
  opens Messenger; the customer pastes it in. Meta runs your inbox uptime,
  not you.
- **No PDF upload / composer.** Per the current plan, those wait until a real
  customer sends a PDF and composing it by hand actually hurts, or the
  business needs justify the composer split. See `WEB_INTAKE_PLAN.md`.
- **No analytics, no cookies, no tracking scripts.** Nothing to configure,
  nothing to disclose, nothing to go wrong.

## Local testing

Any static file server works, e.g.:

```bash
cd web
python -m http.server 8080
```

Then open `http://localhost:8080`. Opening `index.html` directly via
`file://` also mostly works, except the `fetch('data/rates.json')` call will
fail under `file://` in most browsers -- that's fine, it's the same fallback
path as a missing file, and the banner will say "example rates."
