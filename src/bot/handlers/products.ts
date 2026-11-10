import axios from 'axios';
import { Markup, Telegraf } from 'telegraf';
import { Types } from 'mongoose';
import { BotContext } from '../context';
import { HTML, LINE, clearState, editOrReply, esc, setState, trunc } from '../ui';
import { adminOnly } from '../middlewares/auth';
import { getSettings } from '../../services/settings';
import {
  DESC_MAX,
  NAME_MAX,
  clearUnsold,
  createProduct,
  deleteProduct,
  describeLimits,
  getProduct,
  getProductStock,
  getStockMap,
  importIntoProduct,
  isStructureLocked,
  parseLimits,
  renameProduct,
  setDescription,
  setPrice,
  setQtyLimits,
} from '../../services/catalog';
import { getProductSales } from '../../services/stats';
import { formatOf, parseDataFile } from '../../services/dataFile';
import { Product, ProductDoc } from '../../models/Product';
import { AppError, safeError } from '../../utils/errors';
import { fmt, parseAmount } from '../../utils/money';
import { logger } from '../../utils/logger';

type Btn = ReturnType<typeof Markup.button.callback>;
const cb = Markup.button.callback;
const PAGE = 8;
const STATE_TTL_MS = 30 * 60_000;
const panelBack: Btn[] = [cb('⬅️ Admin panel', 'ap:home')];

interface PendingFile {
  fileId: string;
  fileName: string;
  fileSize: number;
}

/** the admin's conversation state if it has the given name and is not stale */
function freshState(ctx: BotContext, name: string): Record<string, any> | null {
  const st = ctx.dbUser.state;
  if (!st || st.name !== name || !st.at || Date.now() - new Date(st.at).getTime() > STATE_TTL_MS) return null;
  return (st.data ?? {}) as Record<string, any>;
}

const isId = (s: unknown): s is string => typeof s === 'string' && Types.ObjectId.isValid(s);

// =====================================================================
//  Product list + product card
// =====================================================================
export async function showProductList(ctx: BotContext, page = 0) {
  await clearState(ctx.dbUser._id);
  const [products, stockMap, settings] = await Promise.all([Product.find().sort({ name: 1 }).lean(), getStockMap(), getSettings()]);
  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const low = settings.lowStockAlert;
  const rows: Btn[][] = products.slice(cur * PAGE, (cur + 1) * PAGE).map((p) => {
    const left = stockMap.get(String(p._id))?.available ?? 0;
    const icon = !p.active ? '⚪' : left === 0 ? '🔴' : low > 0 && left <= low ? '⚠️' : '🟢';
    return [cb(trunc(`${icon} ${p.name} • ${fmt(p.price)} • ${left} left`, 60), `pr:v:${p._id}`)];
  });
  const nav: Btn[] = [];
  if (cur > 0) nav.push(cb('⬅️ Prev', `pr:l:${cur - 1}`));
  if (pages > 1) nav.push(cb(`${cur + 1} / ${pages}`, 'noop'));
  if (cur + 1 < pages) nav.push(cb('Next ➡️', `pr:l:${cur + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([cb('➕ New product', 'pr:new')]);
  rows.push(panelBack);
  const visible = products.filter((p) => p.active).length;
  await editOrReply(
    ctx,
    [
      `🗂 <b>Products</b> (${products.length}${products.length ? ` • ${visible} visible` : ''})`,
      LINE,
      products.length ? 'Tap a product to edit its 💵 price, description and limits, or to upload stock.' : 'No products yet. Create your first product 👇',
      '',
      '💡 <b>Add stock:</b> open a product → 📥 Upload file, <b>or</b> send an <b>.xlsx / .csv</b> file to this chat and pick the product afterwards.',
      '🟢 in stock • ⚠️ low • 🔴 sold out • ⚪ hidden',
    ].join('\n'),
    Markup.inlineKeyboard(rows),
  );
}

export async function showProductCard(ctx: BotContext, id: string, notice?: string) {
  const p = await getProduct(id);
  if (!p) return editOrReply(ctx, 'Product not found.', Markup.inlineKeyboard([[cb('⬅️ Products', 'pr:l:0')]]));
  await clearState(ctx.dbUser._id);
  const [stock, sales] = await Promise.all([getProductStock(p._id), getProductSales(p._id)]);
  const structure =
    p.columnCount > 0
      ? [
          `🧱 Structure: <b>${p.columnCount}</b> column(s) • header row: <b>${p.hasHeader ? 'yes' : 'no'}</b>`,
          p.hasHeader ? `Columns: ${esc(trunc(p.columns.join(' | '), 200))}` : '',
        ].filter(Boolean)
      : ['🧱 Structure: <i>not defined yet — upload a file and it will be set from that file</i>'];
  const limits = describeLimits(p);
  const rows: Btn[][] = [
    [cb('📥 Upload file', `pr:u:${p._id}`)],
    [cb('💵 Price', `pr:e:${p._id}:p`), cb('📏 Limits', `pr:e:${p._id}:l`)],
    [cb('✏️ Name', `pr:e:${p._id}:n`), cb('📝 Description', `pr:e:${p._id}:d`)],
    [cb(p.active ? '👁 Hide from shop' : '👁 Show in shop', `pr:t:${p._id}`), cb(`📄 Delivery: ${p.format.toUpperCase()} (switch)`, `pr:f:${p._id}`)],
    [cb('🧹 Clear unsold', `pr:cl:${p._id}`), cb('🗑 Delete', `pr:del:${p._id}`)],
    [cb('⬅️ Products', 'pr:l:0')],
  ];
  await editOrReply(
    ctx,
    [
      notice ?? '',
      `📦 <b>${esc(p.name)}</b> ${p.active ? '🟢 visible' : '⚪ hidden'}`,
      p.description ? `<i>${esc(p.description)}</i>` : '',
      LINE,
      `💵 Price: <b>${fmt(p.price)}</b> each`,
      `📏 Per order: ${limits ? `<b>${limits}</b>` : 'no limits (1 up to the stock)'}`,
      `📊 Stock: 🟢 <b>${stock.available}</b> available • 🔴 ${stock.sold} sold • ${stock.total} total`,
      `💰 Sales: <b>${fmt(sales.revenue)}</b> • ${sales.orders} orders • ${sales.items} items`,
      ...structure,
      `📄 Buyers receive: <b>${p.format.toUpperCase()}</b>`,
    ]
      .filter((l, i) => !(i === 0 && l === ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
    Markup.inlineKeyboard(rows),
  );
}

// =====================================================================
//  Create / edit
// =====================================================================
async function askName(ctx: BotContext, pending?: PendingFile) {
  await setState(ctx.dbUser._id, 'awaiting_product_name', pending ? { pending } : {});
  await editOrReply(
    ctx,
    `➕ <b>New product</b>\n\n✏️ Send the product name (2–${NAME_MAX} characters), e.g. <i>Gmail accounts</i>.\n/cancel to stop.`,
    Markup.inlineKeyboard([[cb('⬅️ Products', 'pr:l:0')]]),
  );
}

async function askPrice(ctx: BotContext, name: string, pending?: PendingFile) {
  await setState(ctx.dbUser._id, 'awaiting_product_price', { name, ...(pending ? { pending } : {}) });
  await ctx.reply(
    `💵 <b>Price</b> for <b>${esc(name)}</b>\nSend the price of <b>one item</b> (up to 2 decimals), e.g. <code>5</code> or <code>0.85</code>.\n<i>Each product has its own price — you can change it any time.</i>`,
    { ...HTML, ...Markup.inlineKeyboard([[cb('✖️ Cancel', 'pr:l:0')]]) },
  );
}

async function askDescription(ctx: BotContext, name: string, price: number, pending?: PendingFile) {
  await setState(ctx.dbUser._id, 'awaiting_product_desc', { name, price, ...(pending ? { pending } : {}) });
  await ctx.reply(
    `📝 Description for <b>${esc(name)}</b> (${fmt(price)} each)?\nBuyers see it under the product name. Send the text (max ${DESC_MAX} characters), or skip — you can add it later.`,
    { ...HTML, ...Markup.inlineKeyboard([[cb('⏭ Skip', 'pr:ds:skip')], [cb('✖️ Cancel', 'pr:l:0')]]) },
  );
}

async function finishCreate(ctx: BotContext, name: string, price: number, description: string | undefined, pending?: PendingFile) {
  const p = await createProduct(name, price, description);
  if (pending) {
    await ctx.reply(`✅ Product <b>${esc(p.name)}</b> created (${fmt(p.price)} each). Processing your file…`, HTML);
    return beginUpload(ctx, p, pending);
  }
  await showProductCard(ctx, String(p._id), '✅ Product created. Now 📥 upload a file with its data.');
}

async function askEdit(ctx: BotContext, id: string, field: 'n' | 'p' | 'd' | 'l') {
  const p = await getProduct(id);
  if (!p) return showProductList(ctx);
  await setState(ctx.dbUser._id, 'awaiting_product_edit', { productId: id, field });
  const prompt = {
    n: `✏️ <b>Rename</b> — current: <b>${esc(p.name)}</b>\n\nSend the new name.`,
    p: `💵 <b>Change price</b> — current: <b>${fmt(p.price)}</b> each\n\nSend the new price per item (e.g. <code>4.5</code>). Orders already placed keep their old price, and buyers who are on the confirm screen are asked to start again.`,
    l: `📏 <b>Order limits</b> — current: <b>${describeLimits(p) || 'none'}</b>\n\nSend the <b>minimum and maximum</b> quantity per order, e.g. <code>1 100</code> or <code>10 500</code>.\nUse <code>0</code> as the maximum for no cap (buyers can take everything in stock). Send <code>-</code> to remove all limits.`,
    d: `📝 <b>Description</b> — current: ${p.description ? `<i>${esc(p.description)}</i>` : '<i>none</i>'}\n\nSend the new description (shown to buyers), or <code>-</code> to remove it.`,
  }[field];
  await editOrReply(ctx, `${prompt}\n/cancel to stop.`, Markup.inlineKeyboard([[cb('⬅️ Back', `pr:v:${id}`)]]));
}

/** Text router entry for every product-related conversation state. */
export async function handleProductInput(ctx: BotContext, stateName: string, text: string) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Admin only.');
  const data = (ctx.dbUser.state?.data ?? {}) as Record<string, any>;
  const pending: PendingFile | undefined = data.pending;
  try {
    switch (stateName) {
      case 'awaiting_product_name': {
        const name = text.trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > NAME_MAX) return ctx.reply(`Name must be 2–${NAME_MAX} characters. Try again or /cancel.`);
        if (await Product.exists({ nameKey: name.toLowerCase() })) return ctx.reply('A product with this name already exists. Send a different name, or /cancel.');
        return askPrice(ctx, name, pending);
      }
      case 'awaiting_product_price': {
        const price = parseAmount(text);
        if (!price) return ctx.reply('Please send a valid price greater than 0, e.g. 5 or 0.85 (/cancel to stop)');
        return askDescription(ctx, String(data.name ?? ''), price, pending);
      }
      case 'awaiting_product_desc':
        return finishCreate(ctx, String(data.name ?? ''), Number(data.price), text, pending);
      case 'awaiting_product_edit': {
        const id = String(data.productId ?? '');
        const p = await getProduct(id);
        if (!p) return showProductList(ctx);
        if (data.field === 'n') {
          await renameProduct(p._id, text);
        } else if (data.field === 'p') {
          const price = parseAmount(text);
          if (!price) return ctx.reply('Please send a valid price greater than 0, e.g. 5 or 0.85 (/cancel to stop)');
          await setPrice(p._id, price);
        } else if (data.field === 'l') {
          const lim = parseLimits(text);
          if (typeof lim === 'string') return ctx.reply(`❌ ${lim}\n(/cancel to stop)`);
          await setQtyLimits(p._id, lim.min, lim.max);
        } else if (data.field === 'd') {
          await setDescription(p._id, text.trim() === '-' ? '' : text);
        }
        return showProductCard(ctx, id, '✅ Saved.');
      }
    }
  } catch (e) {
    if (e instanceof AppError) return ctx.reply(`❌ ${e.message}`);
    logger.error({ err: safeError(e) }, 'Product input failed');
    return ctx.reply('⚠️ Something went wrong. Please try again.');
  }
}

// =====================================================================
//  Upload (file first or product first)
// =====================================================================
async function download(ctx: BotContext, f: PendingFile): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const link = await ctx.telegram.getFileLink(f.fileId);
      const res = await axios.get<ArrayBuffer>(link.href, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 50 * 1024 * 1024,
      });
      return Buffer.from(res.data);
    } catch (e) {
      lastErr = e;
      logger.warn({ err: safeError(e), attempt }, 'Telegram file download failed');
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  logger.error({ err: safeError(lastErr) }, 'Telegram file download gave up');
  throw new AppError('Could not download the file from Telegram. Please try again in a moment.');
}

async function showUploadPrompt(ctx: BotContext, id: string) {
  const [p, s] = await Promise.all([getProduct(id), getSettings()]);
  if (!p) return showProductList(ctx);
  const locked = await isStructureLocked(p._id);
  await setState(ctx.dbUser._id, 'awaiting_product_file', { productId: id });
  await editOrReply(
    ctx,
    [
      `📥 <b>Upload data → ${esc(p.name)}</b>`,
      '',
      '👇 <b>Send an .xlsx or .csv file now</b> (as a file/document, max ' + s.maxUploadMb + ' MB).',
      '',
      locked
        ? `🧱 This product already has a structure: <b>${p.columnCount}</b> column(s), header row: <b>${p.hasHeader ? 'yes' : 'no'}</b>.\nYour file must have the <b>same columns</b>. One row = one sellable item.`
        : '🧱 This product has no structure yet. Your file defines it: every column is kept, and buyers get files with exactly this layout. One row = one sellable item.',
      '/cancel to stop.',
    ].join('\n'),
    Markup.inlineKeyboard([[cb('⬅️ Back', `pr:v:${id}`)]]),
  );
}

/** Admin sent a file. */
async function handleAdminDocument(ctx: BotContext) {
  if (!ctx.isAdmin) return ctx.reply('⛔ Only admins can upload files.');
  const doc = (ctx.message as any).document as { file_id: string; file_name?: string; file_size?: number };
  const name = doc.file_name ?? 'upload.xlsx';
  if (!formatOf(name)) {
    return ctx.reply(
      /\.xls$/i.test(name)
        ? '❌ Old .xls files are not supported. In Excel choose Save As → .xlsx (or .csv) and upload that.'
        : '❌ Please upload an .xlsx (Excel) or .csv file.',
    );
  }
  const { maxUploadMb } = await getSettings();
  if ((doc.file_size ?? 0) > maxUploadMb * 1024 * 1024) return ctx.reply(`❌ File too large (max ${maxUploadMb} MB).`);

  const pending: PendingFile = { fileId: doc.file_id, fileName: name, fileSize: doc.file_size ?? 0 };

  // product first: the admin opened a product and pressed "Upload file"
  const target = freshState(ctx, 'awaiting_product_file');
  if (target && isId(target.productId)) {
    const p = await getProduct(target.productId);
    if (p) return beginUpload(ctx, p, pending);
  }
  // file first: ask which product it belongs to
  await showPickProduct(ctx, pending, 0);
}

async function showPickProduct(ctx: BotContext, pending: PendingFile, page: number) {
  const products = await Product.find().sort({ name: 1 }).lean();
  await setState(ctx.dbUser._id, 'awaiting_product_pick', { pending });
  const pages = Math.max(1, Math.ceil(products.length / PAGE));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const rows: Btn[][] = products.slice(cur * PAGE, (cur + 1) * PAGE).map((p) => [cb(trunc(`📦 ${p.name} • ${fmt(p.price)}`, 60), `pu:pick:${p._id}`)]);
  const nav: Btn[] = [];
  if (cur > 0) nav.push(cb('⬅️ Prev', `pu:pl:${cur - 1}`));
  if (cur + 1 < pages) nav.push(cb('Next ➡️', `pu:pl:${cur + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([cb('➕ New product for this file', 'pu:newp')]);
  rows.push([cb('✖️ Cancel', 'pu:cancel')]);
  const text = `📄 <b>${esc(pending.fileName)}</b> received.\n\nWhich product is this file for?`;
  if (ctx.callbackQuery) await editOrReply(ctx, text, Markup.inlineKeyboard(rows));
  else await ctx.reply(text, { ...HTML, ...Markup.inlineKeyboard(rows) });
}

const previewRow = (cells: string[]) => esc(trunc(cells.slice(0, 6).map((c) => trunc(c, 22)).join(' | ') + (cells.length > 6 ? ' | …' : ''), 150));

/** Starts an import: ask about the header row when the structure is still open, import straight away when it is locked. */
async function beginUpload(ctx: BotContext, product: ProductDoc, pending: PendingFile) {
  try {
    if (await isStructureLocked(product._id)) return runImport(ctx, product._id, pending, product.hasHeader);

    const sheet = await parseDataFile(await download(ctx, pending), pending.fileName);
    await setState(ctx.dbUser._id, 'awaiting_header_choice', { productId: String(product._id), pending });
    const sample = sheet.rows.slice(0, 3).map((r, i) => `Row ${i + 1}: ${previewRow(r)}`);
    await ctx.reply(
      [
        `🧱 <b>Define structure for ${esc(product.name)}</b>`,
        `📄 ${esc(pending.fileName)} • ${sheet.rows.length} row(s) • <b>${sheet.width}</b> column(s)`,
        '',
        ...sample,
        '',
        '❓ Is <b>row 1</b> a header row (column titles)?',
        '<i>Yes → titles are kept and buyers get the same header. No → every row is a sellable item.</i>',
      ].join('\n'),
      { ...HTML, ...Markup.inlineKeyboard([[cb('✅ Yes, row 1 is a header', 'pu:h:1')], [cb('❌ No, all rows are data', 'pu:h:0')], [cb('✖️ Cancel', 'pu:cancel')]]) },
    );
  } catch (e) {
    await clearState(ctx.dbUser._id);
    if (e instanceof AppError) return ctx.reply(`❌ ${e.message}`);
    logger.error({ err: safeError(e) }, 'Upload preview failed');
    return ctx.reply(`❌ Could not read that file. Make sure it is a valid .xlsx or .csv.\n<code>${esc(String((e as Error)?.message ?? e).slice(0, 200))}</code>`, HTML);
  }
}

async function runImport(ctx: BotContext, productId: Types.ObjectId, pending: PendingFile, hasHeader: boolean) {
  const wait = await ctx.reply('⏳ Importing…');
  try {
    const sheet = await parseDataFile(await download(ctx, pending), pending.fileName);
    const r = await importIntoProduct(productId, sheet, hasHeader, pending.fileName, ctx.from!.id);
    const p = await getProduct(productId);
    const stock = await getProductStock(productId);
    await clearState(ctx.dbUser._id);
    await ctx.reply(
      [
        `✅ <b>Import finished</b> — ${esc(pending.fileName)}`,
        `📦 Product: <b>${esc(p?.name ?? '')}</b>`,
        r.structureDefined && p ? `🧱 Structure set: ${p.columnCount} column(s), header row: ${p.hasHeader ? 'yes' : 'no'}, delivered as ${p.format.toUpperCase()}` : '',
        '',
        `Rows read: ${r.totalRows}`,
        `➕ New items added: <b>${r.inserted}</b>`,
        `♻️ Already in this product (skipped): ${r.duplicatesInDb}`,
        `👯 Duplicates inside file: ${r.duplicatesInFile}`,
        `📊 Available now: <b>${stock.available}</b>`,
      ]
        .filter(Boolean)
        .join('\n'),
      { ...HTML, ...Markup.inlineKeyboard([[cb('📦 Open product', `pr:v:${productId}`), cb('🗂 Products', 'pr:l:0')]]) },
    );
  } catch (e) {
    await clearState(ctx.dbUser._id);
    if (e instanceof AppError) await ctx.reply(e.message.startsWith('❌') ? e.message : `❌ ${e.message}`);
    else {
      logger.error({ err: safeError(e) }, 'Import failed');
      await ctx.reply('❌ Import failed. Check the logs.');
    }
  } finally {
    await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
  }
}

// =====================================================================
//  Registration
// =====================================================================
export function registerProductHandlers(bot: Telegraf<BotContext>) {
  bot.on('document', handleAdminDocument);

  bot.command('products', adminOnly, (ctx) => showProductList(ctx, 0));
  bot.command('newproduct', adminOnly, (ctx) => askName(ctx));

  const act = (re: RegExp | string, fn: (ctx: any) => Promise<unknown>) =>
    bot.action(re, adminOnly, async (ctx: any) => {
      await ctx.answerCbQuery().catch(() => undefined);
      await fn(ctx);
    });

  act('pr:new', (ctx) => askName(ctx));
  act(/^pr:l:(\d+)$/, (ctx) => showProductList(ctx, parseInt(ctx.match[1], 10)));
  act(/^pr:v:([a-f0-9]{24})$/, (ctx) => showProductCard(ctx, ctx.match[1]));
  act(/^pr:e:([a-f0-9]{24}):(n|p|d|l)$/, (ctx) => askEdit(ctx, ctx.match[1], ctx.match[2]));
  act(/^pr:u:([a-f0-9]{24})$/, (ctx) => showUploadPrompt(ctx, ctx.match[1]));

  act('pr:ds:skip', async (ctx) => {
    const d = freshState(ctx, 'awaiting_product_desc');
    if (!d) return ctx.reply('Session expired. Use /newproduct to start again.');
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    try {
      await finishCreate(ctx, String(d.name ?? ''), Number(d.price), undefined, d.pending);
    } catch (e) {
      await ctx.reply(e instanceof AppError ? `❌ ${e.message}` : '⚠️ Something went wrong.');
    }
  });

  act(/^pr:t:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    await Product.updateOne({ _id: p._id }, { $set: { active: !p.active } });
    return showProductCard(ctx, String(p._id), p.active ? '⚪ Product hidden from the shop.' : '🟢 Product is now visible in the shop.');
  });
  act(/^pr:f:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    const next = p.format === 'xlsx' ? 'csv' : 'xlsx';
    await Product.updateOne({ _id: p._id }, { $set: { format: next } });
    return showProductCard(ctx, String(p._id), `📄 Buyers will now receive ${next.toUpperCase()} files.`);
  });

  act(/^pr:cl:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    const st = await getProductStock(p._id);
    await editOrReply(
      ctx,
      `🧹 Delete all <b>${st.available}</b> unsold item(s) of <b>${esc(p.name)}</b>?\nSold items and order history are kept. This cannot be undone.`,
      Markup.inlineKeyboard([[cb('✅ Yes, delete unsold', `pr:clok:${p._id}`), cb('✖️ No', `pr:v:${p._id}`)]]),
    );
  });
  act(/^pr:clok:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    const n = await clearUnsold(p._id);
    return showProductCard(ctx, String(p._id), `🧹 Removed ${n} unsold item(s).`);
  });

  act(/^pr:del:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    await editOrReply(
      ctx,
      `🗑 Delete product <b>${esc(p.name)}</b> and its unsold items?\nOnly possible when it has no sales — otherwise hide it instead.`,
      Markup.inlineKeyboard([[cb('✅ Yes, delete', `pr:delok:${p._id}`), cb('✖️ No', `pr:v:${p._id}`)]]),
    );
  });
  act(/^pr:delok:([a-f0-9]{24})$/, async (ctx) => {
    const p = await getProduct(ctx.match[1]);
    if (!p) return showProductList(ctx);
    try {
      await deleteProduct(p._id);
    } catch (e) {
      if (e instanceof AppError) return showProductCard(ctx, String(p._id), `❌ ${e.message}`);
      throw e;
    }
    await ctx.reply(`🗑 Product "${p.name}" deleted.`);
    return showProductList(ctx);
  });

  // ----- file first: pick the product for a file that was just uploaded -----
  act(/^pu:pl:(\d+)$/, async (ctx) => {
    const d = freshState(ctx, 'awaiting_product_pick');
    if (!d?.pending) return ctx.reply('Session expired. Please send the file again.');
    return showPickProduct(ctx, d.pending, parseInt(ctx.match[1], 10));
  });
  act(/^pu:pick:([a-f0-9]{24})$/, async (ctx) => {
    const d = freshState(ctx, 'awaiting_product_pick');
    if (!d?.pending) return ctx.reply('Session expired. Please send the file again.');
    const p = await getProduct(ctx.match[1]);
    if (!p) return ctx.reply('Product not found.');
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    return beginUpload(ctx, p, d.pending);
  });
  act('pu:newp', async (ctx) => {
    const d = freshState(ctx, 'awaiting_product_pick');
    if (!d?.pending) return ctx.reply('Session expired. Please send the file again.');
    return askName(ctx, d.pending);
  });
  act(/^pu:h:(0|1)$/, async (ctx) => {
    const d = freshState(ctx, 'awaiting_header_choice');
    if (!d?.pending || !isId(d.productId)) return ctx.reply('Session expired. Please send the file again.');
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
    return runImport(ctx, new Types.ObjectId(d.productId), d.pending, ctx.match[1] === '1');
  });
  act('pu:cancel', async (ctx) => {
    await clearState(ctx.dbUser._id);
    await ctx.editMessageText('Upload cancelled.').catch(() => undefined);
  });
}
