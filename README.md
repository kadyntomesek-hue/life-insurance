# Life Insurance CRM

A CRM for a life insurance agent: clients, policies, commission money, a **Bank** tab that matches carrier deposits
to your ledger, and a **Quote Cheat Sheet** built from the 2026 carrier underwriting guides (Term Life, IUL,
Whole Life / Final Expense).

It runs two ways:

| | Quick (no login) | Portal (login + bank) |
|---|---|---|
| How | open `index.html` in a browser | run the Node server |
| Data lives | in that browser only | on the server, behind your login |
| Bank tab | no | yes |
| Good for | trying it out, one computer | daily use, phone + laptop, shared computers |

## Portal: run the server

```bash
npm install
cp .env.example .env      # optional: edit port / Plaid keys
npm start                 # http://localhost:3000
```

The first visit asks you to **create your login**. After that only that account can sign in: there is no sign-up
page, five wrong passwords lock sign-in for 15 minutes, and you can change the password under Settings.

To use it from your phone or anywhere outside your house, put it on a small host that runs Node (Render, Railway,
Fly.io, a $5 VPS) behind HTTPS, and set `COOKIE_SECURE=true` in `.env`. Everything is stored as JSON files in
`data/` (set `DATA_DIR` to move it). Back that folder up, or use the Backup button in the app.

## Bank tab

Two ways to get deposits in:

1. **CSV statement import** (works immediately). Download transactions from your bank's website as CSV and drop
   the file on the Bank tab. Date, description and amount columns are detected automatically, duplicates are
   skipped.
2. **Plaid bank connection** (automatic sync). Create an account at dashboard.plaid.com, put your `client_id`
   and secret in `.env` as `PLAID_CLIENT_ID` / `PLAID_SECRET`, restart, then click **Connect a bank**.
   `PLAID_ENV=sandbox` is free and uses a fake bank for testing; real banks need `production` and Plaid's approval
   of your use case. Access tokens are encrypted at rest.

Either way, every deposit is run through the **carrier matching rules** (Mutual of Omaha, Americo, Transamerica,
Fidelity, Corebridge/AGL, Aetna/Accendo, Foresters, Prosperity/S.USA, American-Amicable, Ethos, National Life
Group out of the box; edit them on the Bank tab). Matched deposits show up as "Add to ledger"; one click records
them as commission payments on the Money tab, linked to the bank transaction so they can't be added twice. Deposits
with no match get a carrier dropdown, and you can ignore anything that isn't commission.

## Tabs

- **Dashboard** – annual premium written this month / YTD, commission received YTD, commission still in the
  pipeline, follow-ups due, a 12-month premium chart, pipeline by status, recent activity.
- **Clients** – contact info, DOB/age, height, weight, tobacco, health & medication notes, lead source, status,
  follow-up date. **Quote** jumps to the cheat sheet with the client's build pre-filled.
- **Policies** – carrier, product type (Term Life / IUL / Whole Life), face, premium and mode, status, commission
  rate and advance %. Annual premium, first-year commission and the advance you should receive are calculated.
- **Money** – ledger of commission statements, chargebacks, renewals and bonuses; received by month and by carrier;
  an **Owed to me** list of issued/paid policies whose advance hasn't been fully logged.
- **Bank** – see above (portal only).
- **Quote Cheat Sheet** – click **Term Life**, **IUL** or **Whole Life** for that product's carrier cards, the full
  A–Z condition grid color-coded like the PDF guides, keyword search, a height/weight build checker across every
  carrier chart, the build charts, and product notes.

## Files

- `index.html`, `login.html`, `css/app.css`, `js/app.js` – the app.
- `js/guides-data.js` – underwriting grids, build charts and notes extracted from the two PDFs.
- `server/` – Express server: login (`index.js`), JSON file store, bank matching (`bank.js`), Plaid (`plaid.js`).
- `tools/parse_guides.py` – rebuilds `guides-data.js` from new guide PDFs (needs poppler's `pdftotext`/`pdftoppm`).
- `test/server.test.js` – `npm test` runs the server smoke test.

## Keeping it private

Only the person with the login can see the data, and the data never touches this chat or GitHub: `data/` and `.env`
are git-ignored. Use a password nobody else knows, and don't share the Claude or GitHub accounts that can reach the
code.
