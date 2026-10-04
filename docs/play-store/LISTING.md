# Google Play — what to paste into the Console

Everything below matches what the app actually does (version 1.2.0). Update it
if the app changes what it collects.

---

## Store listing

**App name** (30 max)
```
Genius Pro POS
```

**Short description** (80 max)
```
Sales, stock, receipts & books for your shop — works offline, syncs to cloud.
```

**Full description** (4,000 max)
```
Genius Pro POS runs your whole shop from your phone — selling, stock, money and books — and keeps working when the network does not.

SELL FAST
• Ring up sales in seconds: search, scan barcodes, or pick from your items
• Cash, mobile money, bank, credit and split payments
• Print receipts on Bluetooth or network printers, or share an A4 PDF
• Send invoices, quotations and receipts by WhatsApp, SMS or email
• Quotations, delivery notes, returns, recurring sales and instalment plans

KNOW YOUR STOCK
• Items, services, units, categories and barcodes
• Batches and expiry dates, with the soonest-to-expire sold first
• IMEI tracking for phones, with condition (new or used)
• Purchases from suppliers, stock adjustments, transfers and stock counts
• Low-stock alerts and a reorder list

MONEY AND BOOKS
• Expenses and income filed under your own ledgers
• Payments in and out, settled against the exact invoices
• Payment reminders to customers by WhatsApp, SMS or email
• Profit & loss, balance sheet, trial balance and general ledger with drill-down
• 70+ reports: sales, purchases, stock, receivables, payables and more
• Export reports to PDF and Excel

FOR THE WHOLE TEAM
• Staff with their own PIN and roles you control, down to each permission
• Shifts, day close (Z report) and cash counts
• Several branches in one business
• Cloud sync keeps every phone in the shop up to date

MOVE FROM VYAPAR
Bring your customers, suppliers, items, sales and balances across from a Vyapar backup in a few taps.

PRIVATE BY DESIGN
Your books stay on your phone. Cloud sync is your choice. No ads, no tracking.
```

**App category:** Business
**Contact email:** saljotech256@gmail.com
**Website:** https://saljoetech.tech
**Privacy policy URL:** https://saljoetech.tech/privacy.html  *(host `docs/web/privacy.html` there)*

**Graphics you need to make**
| Asset | Size | Notes |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit | from `assets/icon.png` |
| Feature graphic | 1024 × 500 PNG/JPG | name + a phone showing Home |
| Phone screenshots | 2–8, 1080 × 1920 or similar | Home, New sale, Activity, a report, Items, reminders |

---

## App content (Policy → App content)

**Privacy policy:** the URL above.

**Ads:** No, the app does not contain ads.

**App access:** "All or some functionality is restricted" → give a reviewer
login: an email and password of a test owner account with a sample business
and an active licence. Mention: "Sign in with email, then open the business".

**Content rating questionnaire:** category *Utility, Productivity,
Communication or Other* → answer No to violence, sexuality, language,
controlled substances, gambling; users do not interact with each other;
no location sharing; no digital purchases inside the app. Result: Everyone.

**Target audience:** 18 and over. Not designed for children.

**News app:** No. **Government app:** No. **Financial features:** none of the
listed (it is bookkeeping, not lending, banking or payments processing).

**Account deletion:**
- In-app: Yes — Menu → Delete account
- Web link: https://saljoetech.tech/delete-account.html *(host `docs/web/delete-account.html`)*

---

## Data safety

**Does your app collect or share user data?** Yes, collects. Not shared.
**Is all data encrypted in transit?** Yes (HTTPS).
**Can users request deletion?** Yes (in-app and the web link above).

| Data type | Collected | Shared | Optional? | Why |
|---|---|---|---|---|
| Personal info → Email address | Yes | No | Required to sign in | Account management, App functionality |
| Personal info → Name | Yes | No | Optional | Account management |
| Personal info → Phone number | Yes (customer/supplier/business numbers the owner enters, when cloud sync is on) | No | Optional | App functionality |
| Personal info → Address | Yes (business/customer addresses entered, when sync is on) | No | Optional | App functionality |
| Financial info → Purchase history | Yes (the shop's sales and purchases, when sync is on) | No | Optional | App functionality |
| Financial info → Other financial info | Yes (payments, balances, when sync is on) | No | Optional | App functionality |
| Photos | Yes (logo, signature, product photos, when sync is on) | No | Optional | App functionality |
| App info and performance → Crash logs | Yes | No | Required | Analytics (fixing faults) |
| Device or other IDs | Yes (device identifier for licence seats) | No | Required | App functionality, Fraud prevention/security |

Not collected: location (the permission exists only so Android 11 and older
can search for Bluetooth printers — no location is read), contacts, messages,
audio, calendar, health, web browsing, advertising ID.

---

## Release

1. Play Console → Create app → name, default language English (UK/US), App,
   Free or Paid.
2. **Play App Signing:** accept. Upload `app-release.aab`; your
   `genius-pro-release.jks` becomes the upload key (keep it safe).
3. New personal developer accounts: **Closed testing** with at least 12
   testers for 14 days in a row before Production can be requested.
4. Each later upload needs a higher `versionCode` (now 2) in
   `android/app/build.gradle` and `app.json`.

---

## Before you submit — two things outside the Console

**1. Play build switch.** `app.json` → `"extra": { "playStore": true }` hides
plan prices and "Get plan" buttons (Play forbids pointing people to pay outside
Play for the app's own features). Keep it `true` for every build uploaded to
Play. For an APK you hand out yourself, set it to `false` before building if
you want prices and buy buttons shown.

**2. Account deletion needs the new server code.** In-app deletion calls
`POST /v1/account/delete` (`server/src/auth.js`). Push it to the repository
the VPS updater follows (or deploy by hand) before review — Google will try
it. Test it once with a throwaway account.
