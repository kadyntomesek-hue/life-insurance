# Life Insurance CRM

A CRM for a life insurance agent: clients, policies, commission money, a **Bank** tab that matches carrier deposits
to your ledger, and a **Quote Cheat Sheet** built from the 2026 carrier underwriting guides (Term Life, IUL,
Whole Life / Final Expense).

It runs two ways:

| | Quick (no login) | Portal (login + bank) |
|---|---|---|
| How | open `index.html` in a browser | run `server.py` with Python |
| Data lives | in that browser only | on the server, behind your login |
| Bank tab | no | yes |
| Good for | trying it out, one computer | daily use, phone + laptop, shared computers |

## Portal: run the server

You only need Python 3.8 or newer. Nothing to install.

- **Windows:** double-click `start.bat` (or run `python server.py` in the folder).
- **Mac / Linux:** run `./start.sh` or `python3 server.py`.

Then open http://localhost:3000. The first visit asks you to **create your login**. After that only that account
can sign in: there is no sign-up page, five wrong passwords lock sign-in for 15 minutes, and you can change the
password under Settings.

Everything is stored as JSON files in `data/` next to `server.py` (set `DATA_DIR` in `.env` to move it). Back that
folder up, or use the Backup button in the app. `python test_server.py` runs a quick self-test.

To use it from your phone or outside your house, run it on a small host that has Python (a $5 VPS, PythonAnywhere,
Render, Railway) behind HTTPS, and set `COOKIE_SECURE=true` in `.env`.

## Bank tab

Two ways to get deposits in:

1. **CSV statement import** (works immediately). Download transactions from your bank's website as CSV and drop
   the file on the Bank tab. Date, description and amount columns are detected automatically, duplicates are
   skipped.
2. **Plaid bank connection** (automatic sync). Create an account at dashboard.plaid.com, put your `client_id`
   and secret in `.env` as `PLAID_CLIENT_ID` / `PLAID_SECRET`, restart, then click **Connect a bank**.
   `PLAID_ENV=sandbox` is free and uses a fake bank for testing; real banks need `production` and Plaid's approval
   of your use case. Bank access tokens are kept in `data/bank.json`, so keep the `data/` folder private.

Either way, every deposit is run through the **carrier matching rules** (Mutual of Omaha, Americo, Transamerica,
Fidelity, Corebridge/AGL, Aetna/Accendo, Foresters, Prosperity/S.USA, American-Amicable, Ethos, National Life
Group out of the box; edit them on the Bank tab). Matched deposits show up as "Add to ledger"; one click records
them as commission payments on the Money tab, linked to the bank transaction so they can't be added twice. Deposits
with no match get a carrier dropdown, and you can ignore anything that isn't commission.

## Email leads

On the **Clients** tab, **Email leads** goes through every Lead and Quoted client, works out what kind of lead each one
is, and emails each person the matching message with their name filled in.

**Lead types** come from the client's age, health and medication notes, free-text notes, status, lead source and
follow-up date (so the more you type into a client card, the better the sorting):

| Type | Picked when | Email talks about |
|---|---|---|
| Final Expense / Whole Life | 60+, or burial / funeral mentioned, or 50+ with serious health conditions | small whole life policy, no exam, premium never rises |
| Term / Family Protection | younger, or mortgage / kids / income mentioned | term life, fixed cost, quick no-exam approval |
| IUL / Cash Value | retirement, savings, investing, tax-free mentioned | indexed universal life, cash value with a floor |
| Quoted - needs a decision | status is Quoted | locking the rate in, adjusting the quote, applying |
| General inquiry | nothing to go on yet | asks what they want covered and about health |

Each lead also gets a **heat**: Hot (quoted, follow-up due, referral or walk-in, "call me" in the notes), Warm, or Cold
(added 30+ days ago, no follow-up). Tobacco and a heavy build are flagged so you know to shop the right carriers.
The reasons are shown on every row and on the client card.

**Templates** (the Templates button, or Settings) hold one message per lead type. Fields: `{first}`, `{last}`, `{name}`,
`{agent}`, `{phone}`. Your name and phone come from Settings. Click any row to preview the exact email and edit it for
that one person before sending.

**Sending.** With the portal server and SMTP settings in `.env` (see `.env.example`; Gmail and Outlook need an *app
password*), the Send button mails everyone selected, one personal email each, from your own address. Everyone emailed
gets "Last emailed" on their card, an activity entry, and (if the box is ticked) a follow-up date 3 days out. Keep
batches to about 50 a day on a personal mail account so it is not flagged as spam. Without SMTP, or in the quick
no-login version, **Open in mail app** opens the personalised email for the selected lead in your mail program, and
**Copy addresses** copies the selected addresses.

**Analyze with AI** (optional). Put an `ANTHROPIC_API_KEY` in `.env` and the button appears. Claude reads the selected
leads' notes, confirms or corrects the type and heat, writes a one-line summary (kept on the client card) and drafts a
personal email for each lead in the tone of your templates. You see every draft before anything is sent. Leads are sent
to the API in batches of 12; health notes are included because they drive the recommendation, so only turn this on if
you are comfortable with that. The model defaults to `claude-opus-5-5` (`ANTHROPIC_MODEL` overrides it).

## Tabs

- **Dashboard** – annual premium written this month / YTD, commission received YTD, commission still in the
  pipeline, follow-ups due, a 12-month premium chart, pipeline by status, recent activity.
- **Clients** – contact info, DOB/age, height, weight, tobacco, health & medication notes, lead source, status,
  follow-up date, lead type and heat, last emailed. **Quote** jumps to the cheat sheet with the client's build pre-filled;
  **Email** opens the email screen for that one person; **Email leads** does the whole list.
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
- `server.py` – the portal server (login, data files, bank matching, Plaid, email sending, AI lead analysis). `start.bat` / `start.sh` launch it.
- `tools/parse_guides.py` – rebuilds `guides-data.js` from new guide PDFs (needs poppler's `pdftotext`/`pdftoppm`).
- `test_server.py` – server self-test.

## Keeping it private

Only the person with the login can see the data, and the data never touches this chat or GitHub: `data/` and `.env`
are git-ignored. Email goes straight from your server to your mail provider; the only outside service that ever sees
lead details is the Claude API, and only when you turn on **Analyze with AI**. Use a password nobody else knows, and don't share the Claude or GitHub accounts that can reach the
code.
