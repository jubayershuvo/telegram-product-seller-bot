# Telegram Multi-Product Selling Bot

Node.js + TypeScript + Telegraf + MongoDB (Mongoose) + ExcelJS. Sells **many products**; each product's stock comes from uploaded `.xlsx` / `.csv` files.
Everything (admin and users) happens **inside Telegram**. There is no web dashboard.

## Features

**Admin** — `/admin` opens a button panel; **🗂 Products** is the product manager
- **Everything about a product lives on the product** — there is no shop-wide price. Create it (name → 💵 price → description) and **edit it any time**: ✏️ name, 💵 price, 📏 **order limits** (min / max quantity per order), 📝 description, 👁 hide/show in the shop, 📄 delivery format (XLSX/CSV), 🧹 clear unsold items, 🗑 delete (only if it never sold)
- Each product card shows its stock, **sales and revenue**; the product list marks 🟢 in stock • ⚠️ low • 🔴 sold out • ⚪ hidden
- **Low-stock alerts:** admins are notified when a product sells out or drops to the `lowStockAlert` level (default 5, `0` = off)
- **Upload stock into a product** — two ways, both work:
  1. open the product → **📥 Upload file** → send the file, or
  2. just send an `.xlsx` / `.csv` file to the bot, then **pick the product** (or create a new one) from the buttons
- **The first file defines the product's file structure** (all columns, and whether row 1 is a header — the bot asks you). Later uploads must have the **same structure** (same column count, same header names) or they are rejected; buyers always receive a file with exactly that layout
- One row = one sellable item. Rows are de-duplicated per product (a row that was already added or sold is skipped, so nothing can be sold twice)
- `/stats` revenue, last-24h sales and stock **per product**; `/products`, `/newproduct`, `/imports`
- `/admin` is a dashboard: last-24h sales, product count with sold-out / low-stock warnings, recharge status, then buttons for everything
- `/settings_edit`, `/settings`, `/set`, `/resetsetting` — **store-wide options only** (shop name, currency, timezone, support, low-stock level, recharge, force join, uploads, TrxID rules)
- `/users`, `/user`, `/allorders`, `/alldeposits`, `/alltx`, `/addbalance`, `/deductbalance`, `/ban`, `/unban`

**Users**
- `/start` registers automatically; wallet balance
- **🛍 Shop → pick a product → tap a quantity (or type one) → confirm** → the file with the purchased rows arrives instantly, in that product's structure and format (XLSX or CSV). The product page shows price, stock, the product's min/max per order and the live total for every quick-quantity button
- Order history (re-download any file — it is rebuilt with the structure the product had when you bought it), transaction history, recharge history
- Recharge via bKash/Nagad: pick provider → pay → send TrxID → verified from synced SMS → wallet credited

**Upgrading from the single-product version:** on first start the old `emails` collection is converted automatically into a product called **Emails** (1 column, no header, XLSX — exactly like before). Old orders keep working and can still be re-downloaded. The old collection is kept, renamed to `emails_migrated`.

**Upgrading from the version that still had a shop-wide `price` / `maxQty` setting:** on first start the old values are moved onto the products automatically — the old `maxQty` becomes each product's max per order, the `price` setting is deleted (every product already has its own price; the converted **Emails** product takes the old price). Nothing to do by hand.

## Force channel subscription

Users must join every required channel before they can use the bot.

- `/start` (and every other message/button) checks membership with Telegram `getChatMember`. Not joined → the user sees a **📢 Join** button per missing channel and an **✅ I've Joined** button. Access opens only after verification; membership is re-checked on every use (a 10 s burst cache avoids hammering the API on rapid taps). Admins are exempt.
- Public channels (`@username`) and private channels (numeric ID + invite link) are supported, any number of them.
- **The bot must be an administrator of each channel**, otherwise Telegram does not let it read members. This is checked when you add a channel.
- Manage from Telegram: `/admin` → **📢 Channels**, or **⚙️ Settings → 📢 Required channels** (add, remove, turn force join on/off). Adding accepts `@username`, a `t.me` link, a numeric ID, or simply a **forwarded message** from the channel.
- Commands: `/channels`, `/addchannel <@username|id> [invite link]`, `/removechannel <@username|id>`, `/forcejoin on|off`.
- If the bot loses admin rights in a channel (or Telegram errors), users are **not** locked out; the admins get a warning message instead (max once per 30 min per channel).

## Broadcast

- `/broadcast` (or **📣 Broadcast** in `/admin`), admin only. Send text or any media (photo, video, document, audio, voice, GIF, sticker…, caption/formatting kept). You get a preview and a recipient count, then confirm.
- Sent with `copyMessage` to every registered user (one document per Telegram ID, `telegramId` is unique, so no duplicates). Banned users and users who already blocked the bot are skipped.
- Live progress (bar, successful, failed) with a **🛑 Stop** button, and a final summary. History is stored in the `broadcasts` collection.
- Rate limits: max ~20 messages/second; on HTTP 429 the whole broadcast pauses for the `retry_after` Telegram returns and the message is retried. Users who block the bot are counted as failed and flagged, they are un-flagged automatically when they message the bot again.
- One broadcast at a time. A broadcast runs inside the bot process, so restarting the bot during a broadcast stops it.

## Folder structure

```
src/
  index.ts                    entrypoint (DB, bot launch, recovery job, graceful shutdown)
  config/      env.ts (secrets only)  db.ts
  lib/         payment-verifier.ts + bkash/nagad SMS extractors
  models/      User Product Item Order Deposit Transaction ImportBatch Setting (defaults live here)
  services/
    wallet.ts       atomic + idempotent credit/debit (ledger)
    catalog.ts      products, per-product price + min/max order limits, stock, structure-checked import
    inventory.ts    atomic per-product item reservation / release
    purchase.ts     purchase flow (one product per order) + rollback
    migrateLegacy.ts one-time emails -> product migration
    migrateSettings.ts one-time: shop-wide price / maxQty settings -> per-product values
    deposit.ts      TrxID claim -> verify -> credit
    dataFile.ts     read .xlsx/.csv (ExcelJS / own CSV parser) and build delivery files
    settings.ts (DB-backed, cached)  settingsParser.ts  stats.ts  userLock.ts  recovery.ts
    rechargeGate.ts admin on/off + daily schedule
  bot/
    index.ts  context.ts  ui.ts  notify.ts
    middlewares/    auth.ts (load user, ban, admin check)  rateLimit.ts
    handlers/       shop.ts  products.ts  recharge.ts  admin.ts  text.ts
```

## Setup on Windows

1. Install **Node.js 20 LTS** from https://nodejs.org (tick "Add to PATH").
2. Install MongoDB: either
   - **MongoDB Community Server** (https://www.mongodb.com/try/download/community, install as a Windows service), URI: `mongodb://127.0.0.1:27017/email_bot`, or
   - free **MongoDB Atlas** cluster (https://www.mongodb.com/atlas), copy the `mongodb+srv://...` URI and allow your IP.
3. Create the bot with **@BotFather** → `/newbot` → copy the token.
4. Get your numeric Telegram ID from **@userinfobot**.
5. Open PowerShell in the project folder:
   ```powershell
   npm install
   copy .env.example .env
   notepad .env
   ```
   Fill `BOT_TOKEN`, `ADMIN_IDS`, `MONGODB_URI`. Nothing else is needed in `.env`; configure the shop from Telegram with `/settings`.
6. Run in development: `npm run dev`
7. Production build: `npm run build` then `npm start`
8. Open your bot in Telegram, send `/start`, then `/admin`.

### Keep it running on Windows
```powershell
npm install -g pm2
npm run build
pm2 start ecosystem.config.js
pm2 save
```
To auto-start after reboot use `npm i -g pm2-windows-startup && pm2-startup install`, or create a Task Scheduler task (trigger: at startup) running `node dist\index.js` in the project folder, or wrap it with NSSM as a Windows service.

## Deployment (Linux VPS)

```bash
# Ubuntu 22.04/24.04
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
git clone <your repo> email-bot && cd email-bot      # or upload the zip
npm install && cp .env.example .env && nano .env
npm run build
sudo npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
```
Use MongoDB Atlas or install MongoDB on the server (bind to localhost, enable auth).

**Docker:** `docker compose up -d --build` (starts MongoDB + bot; reads `.env`).

**Webhook mode (optional):** set `WEBHOOK_DOMAIN=bot.example.com` and put Nginx/Caddy with HTTPS in front of `PORT` (the webhook secret is derived from the bot token automatically). Polling (default) needs no domain and is fine for most shops.

## File import format (.xlsx / .csv)

- `.xlsx`: first worksheet that has data, **all columns**. `.csv`: comma, semicolon or tab separated, UTF-8 (BOM ok). Old `.xls` is not supported (Save As .xlsx).
- A header row is optional. For a product's **first** upload the bot shows the first rows and asks "is row 1 a header?".
- Every non-empty row is one item. Cell values are stored as text, so leading zeros and long numbers are kept as-is.
- Duplicates (identical row, case-insensitive) inside a file or already in that product are skipped. The same row may exist in *different* products.
- Upload as a *document* (paperclip → File), max `maxUploadMb` (Telegram bots can download up to 20 MB).

## Settings (database, editable by admins)

`.env` only holds `NODE_ENV`, `BOT_TOKEN`, `ADMIN_IDS`, `MONGODB_URI` and the optional `WEBHOOK_DOMAIN` / `PORT`.
Everything else is a document in the `settings` collection. Defaults are defined once in `src/models/Setting.ts`
(`SETTING_DEFAULTS`); on startup any missing key is inserted with its default, existing values are never overwritten.

| Command | What it does |
|---|---|
| `/settings_edit` | step-by-step editor: pick a category, pick a setting, send the value (or tap an option) |
| `/settings` | show every setting |
| `/set <key> <value>` | change one (use `-` as value to clear text/list settings) |
| `/resetsetting <key>` | restore the default from the model |

Keys: `shopName currencySymbol timezone support lowStockAlert rechargeEnabled rechargeScheduleEnabled rechargeOpenTime rechargeCloseTime bkashNumber nagadNumber minRecharge maxRecharge rechargePresets forceJoinEnabled maxUploadMb trxIdRegex maxFailedTrxPerHour`
(short aliases: `shop`, `lowstock`, `bkash`, `nagad`, `presets`).

> **Not settings any more:** price, description, min/max quantity per order, delivery format and visibility are **per product** — edit them in `/products`.

**Prices** are per product (up to 2 decimals); totals are price × quantity rounded to 2 decimals (0.85 × 2 = 1.70). The price is frozen on the order, and if an admin changes it while a buyer is on the confirm screen, the purchase is stopped and the buyer sees the new price.

**Order limits (per product):** each product has its own `min` and `max` quantity per order (📏 Limits on the product card: send `5 100`, `10 0` for no max, or `-` to remove limits). The range a buyer can order is `min – min(max, items in stock)`. If the stock is below the product's minimum, the product shows as unavailable until it is restocked. Defaults: min 1, no max.

## Recharge (SMS verification)

Flow for users: **➕ Recharge → select provider (bKash / Nagad) → send TrxID → ✅ success / ❌ rejected**.
There is no amount step: the wallet is credited with the amount found in the payment SMS (whole taka, limited by `minRecharge` / `maxRecharge`).

Payments are verified by `src/lib/payment-verifier.ts`, which looks the TrxID up in the SMS inbox synced from your phone
(SMSSync server). Set `SMSSYNC_API_KEY` in `.env`. SMS parsing lives in `src/lib/bkash-sms-data-extractor.ts` and `nagad-sms-data-extractor.ts`.

Rules: unknown TrxID → rejected (counts as a failed attempt); SMS service down / bad key → "temporarily unavailable", the TrxID is **not** burned and not counted; amount unreadable or outside limits → rejected; each TrxID works once.

### Admin recharge control
- Master switch for **all users**, any time: panel button **🟢/🔴 Recharge**, or `/recharge_on` / `/recharge_off`
- Daily schedule: panel → **⏰ Recharge schedule**, or `/recharge_hours 09:00 22:00` (overnight like `22:00-06:00` works; `/recharge_hours off` removes it). Uses the `timezone` setting.
- Recharge is open only if the master switch is ON **and** (when the schedule is ON) the current time is inside the hours. Enforced both in the menus and again when a TrxID is submitted.
- `/recharge_status` shows the current state. The same values are in `/settings_edit` → Recharge.

### Ban / unban
`/ban <id|@user>`, `/unban <id|@user>`, user card button in the panel, and **🚫 Banned users** list (`/banned`). The user is notified; admins can't be banned.

## How double-selling and fake recharges are prevented

- `Item` has a **unique index on (productId, row fingerprint)**; each item is reserved with a per-document atomic update filtered on `status:'available'`, so two simultaneous buyers can never get the same row. (No replica set required, so it works on a plain local MongoDB.)
- Wallet changes use one atomic `findOneAndUpdate` with a `balance >= amount` guard and an **idempotency key** stored on the user, so a retry can never charge or credit twice and balances can't go negative.
- A purchase that fails halfway releases its items and refunds automatically; a background job (every 5 min and at startup) repairs anything a crash left in "processing".
- `Deposit.trxId` has a **unique partial index**: one TrxID can only ever be claimed once; failed verifications release it so honest users can retry. Failed-attempt limit per user per hour (`maxFailedTrxPerHour` setting).
- Per-user DB lock stops double-tapping Confirm / double submissions; flood rate-limit per user; banned users blocked; admin commands guarded by `ADMIN_IDS`; bot only talks in private chats.
- All state (balances, stock, conversation steps) lives in MongoDB, so restarts lose nothing.

## Security notes

- Never commit `.env`. Rotate the bot token in @BotFather if it leaks.
- Logs never contain the bot token or raw HTTP error objects.
- Back up MongoDB regularly (`mongodump`); the product inventory and balances are your business data.
- Delivered items stay linked to the order, so users can re-download from **My Orders**.
