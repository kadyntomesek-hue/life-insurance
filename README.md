# Life Insurance CRM

A CRM for a life insurance agent: clients, policies, commission money, a **Commissions** check, a **Bank** tab that
matches carrier deposits to your ledger, an **Email leads** screen, and a **Quoter** that reads the 2026 carrier
underwriting guides (Term Life, IUL, Whole Life / Final Expense) and lists the carriers most likely to approve a client.

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

## Commissions tab: getting paid the right amount

The **Money** tab is the ledger of what came in. The **Commissions** tab checks it: for every policy it works out what
the carrier should have paid you *by today* and compares that with the payments you have linked to the policy.

**Expected to date** = advance + as-earned months + renewals − chargeback, where

- the **advance** (advance % × first-year commission) is due once the policy is Issued or Paid and covers the first
  N months (75% = 9 months, 50% = 6);
- after the advance period each premium paid earns **monthly premium × rate** ("as earned");
- from month 13 the policy pays **renewals** at the renewal % (per policy, or the default in Settings; 0 = not tracked);
- if the policy **lapses** inside the advance period the carrier claws back the unearned part: advance − months paid ×
  monthly commission. Put the lapse date on the policy to get this exact.

Every policy gets a verdict: **Paid correctly**, **Underpaid**, **Overpaid**, **Overcharged** (a chargeback bigger than
the unearned advance), **Waiting on advance** / **Advance overdue** (issued, nothing logged), **Not due yet**, or
**Set lapse date**. "Problems only" is the default view; the tiles total what you are short, what is over, advances
you are waiting on, and the **advance at risk** (what a lapse today would claw back). Click a row for the full
breakdown, the payments against it, a month-by-month schedule, and a box to **accept** an explained difference so it
stops showing as a problem. **By carrier** sums expected vs received per carrier so you can check a statement at a
glance, **Chargeback watch** lists policies still inside their advance period and lapsed ones with what should have
been clawed back, and **Coming up** shows the next 60 days: as-earned starting, year-2 renewals starting, overdue
advances.

Only payments linked to a policy can be checked, so link them (the tile tells you how many are not). Bonus and Other
payments are shown but not counted against the expected amount. Differences of $1 or less are ignored.

## Tabs

- **Dashboard** – annual premium written this month / YTD, commission received YTD, commission still in the
  pipeline, follow-ups due, a 12-month premium chart, pipeline by status, recent activity.
- **Clients** – contact info, DOB/age, sex, height, weight, tobacco, health & medication notes, lead source, status,
  follow-up date, lead type and heat, last emailed. **Quote** jumps to the cheat sheet with the client's build pre-filled;
  **Email** opens the email screen for that one person; **Email leads** does the whole list.
- **Policies** – carrier, product type (Term Life / IUL / Whole Life), face, premium and mode, status, commission
  rate and advance %. Annual premium, first-year commission and the advance you should receive are calculated.
- **Money** – ledger of commission statements, chargebacks, renewals and bonuses; received by month and by carrier;
  an **Owed to me** list of issued/paid policies whose advance hasn't been fully logged.
- **Commissions** – see above: expected vs received per policy and per carrier, chargeback watch, what's coming up.
- **Bank** – see above (portal only).
- **Quoter** – type in date of birth, sex, state, height, weight, tobacco, and the meds and conditions in plain words
  ("metformin, lisinopril, cpap, stent 2019, afib on eliquis"). It recognizes several hundred medication and condition
  names, shows what it picked up (click × on a wrong one) and flags meds that are not rated. Then it scores all 17
  carrier products from both underwriting guides: age band and
  tobacco band from the carrier notes, "not sold in" states, the carrier's height/weight chart, and the color of every
  selected condition's cell. Carriers come back in five groups, best first: **Most likely to approve** (level,
  day-one), **Likely, graded or modified tier**, **Possible, depends on the details**, **Only a guaranteed-issue
  route**, and **Unlikely** (collapsed, with the rule that knocked them out). Each card shows the exact underwriting
  rule for each condition and the build verdict. **Quote** on a client card fills the form from the client, including
  conditions picked out of their health notes. Sex is kept for the quote and the client record; the guides do not
  rate by sex.

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
