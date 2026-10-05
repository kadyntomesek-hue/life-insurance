# Life Insurance CRM

A no-install CRM for a life insurance agent: track clients, policies and commission money, plus a
**Quote Cheat Sheet** tab built from the 2026 carrier underwriting guides (Term Life, IUL, Whole Life / Final Expense).

## Run it

Open `index.html` in any modern browser. Nothing to install, no server, no account.
It also works as a static site (for example GitHub Pages: Settings → Pages → deploy from the `main` branch root).

All data is saved in that browser's local storage. Use **Backup** in the top bar to download a JSON file and
**Restore** to load it on another computer or browser.

## Tabs

- **Dashboard** – annual premium written this month / YTD, commission received YTD, commission still in the pipeline,
  follow-ups due, a 12-month premium chart, pipeline by policy status, recent activity.
- **Clients** – searchable client list with status (Lead → Quoted → Applied → Client / Lost), contact info, DOB/age,
  height, weight, tobacco, health & medication notes, lead source and a follow-up date. The **Quote** button jumps to
  the cheat sheet with the client's build pre-filled.
- **Policies** – one row per policy: client, carrier, product type (Term Life / IUL / Whole Life), face amount,
  premium and mode, status (Submitted → Pending → Approved → Issued → Paid, or Declined / Lapsed / Chargeback),
  commission rate and advance %. Annual premium, first-year commission and the advance you should receive are
  calculated for you.
- **Money** – log commission statements, chargebacks, renewals and bonuses. Shows received by month and by carrier,
  and an **Owed to me** list of issued/paid policies whose advance has not been fully logged yet.
- **Quote Cheat Sheet** – click **Term Life**, **IUL** or **Whole Life**. You get the carrier cards for that product,
  the full A–Z condition grid (color-coded exactly like the PDF guides: green day-one, blue graded/modified, orange GI
  route, yellow check meds, purple cross-ref, red decline), a keyword search across every cell, a height/weight build
  checker that reads every carrier's chart at once, the build charts themselves, and the product notes & reminders.
  "Show every carrier in this guide" widens Term or IUL to all eight carriers in the IUL & Term grid.

Default commission rates per product type, the advance %, and light/dark theme live under **Settings**.

## Files

- `index.html`, `css/app.css`, `js/app.js` – the app.
- `js/guides-data.js` – the underwriting grids, build charts and product notes extracted from the two PDFs.
- `tools/parse_guides.py` – the extractor used to build `guides-data.js` from the PDFs (needs `pdftotext` and `pdftoppm`
  from poppler; it reads the cell colors off a raster of each page so the grid colors match the source).

## Updating the cheat sheet

When you get new underwriting guide PDFs, run `pdftotext -layout`, `pdftotext -bbox-layout` and `pdftoppm -r 72` on
each one (named `wl.*` and `term.*` next to the script), run `tools/parse_guides.py`, and regenerate
`js/guides-data.js` from the resulting `guides.json` as `window.UW_GUIDES = …`.
