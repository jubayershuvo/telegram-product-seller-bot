"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.showProductList = showProductList;
exports.showProductCard = showProductCard;
exports.handleProductInput = handleProductInput;
exports.registerProductHandlers = registerProductHandlers;
const axios_1 = __importDefault(require("axios"));
const telegraf_1 = require("telegraf");
const mongoose_1 = require("mongoose");
const ui_1 = require("../ui");
const auth_1 = require("../middlewares/auth");
const settings_1 = require("../../services/settings");
const catalog_1 = require("../../services/catalog");
const stats_1 = require("../../services/stats");
const dataFile_1 = require("../../services/dataFile");
const Product_1 = require("../../models/Product");
const errors_1 = require("../../utils/errors");
const money_1 = require("../../utils/money");
const logger_1 = require("../../utils/logger");
const cb = telegraf_1.Markup.button.callback;
const PAGE = 8;
const STATE_TTL_MS = 30 * 60_000;
const panelBack = [cb('⬅️ Admin panel', 'ap:home')];
/** the admin's conversation state if it has the given name and is not stale */
function freshState(ctx, name) {
    const st = ctx.dbUser.state;
    if (!st || st.name !== name || !st.at || Date.now() - new Date(st.at).getTime() > STATE_TTL_MS)
        return null;
    return (st.data ?? {});
}
const isId = (s) => typeof s === 'string' && mongoose_1.Types.ObjectId.isValid(s);
// =====================================================================
//  Product list + product card
// =====================================================================
async function showProductList(ctx, page = 0) {
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [products, stockMap, settings] = await Promise.all([Product_1.Product.find().sort({ name: 1 }).lean(), (0, catalog_1.getStockMap)(), (0, settings_1.getSettings)()]);
    const pages = Math.max(1, Math.ceil(products.length / PAGE));
    const cur = Math.min(Math.max(0, page), pages - 1);
    const low = settings.lowStockAlert;
    const rows = products.slice(cur * PAGE, (cur + 1) * PAGE).map((p) => {
        const left = stockMap.get(String(p._id))?.available ?? 0;
        const icon = !p.active ? '⚪' : left === 0 ? '🔴' : low > 0 && left <= low ? '⚠️' : '🟢';
        return [cb((0, ui_1.trunc)(`${icon} ${p.name} • ${(0, money_1.fmt)(p.price)} • ${left} left`, 60), `pr:v:${p._id}`)];
    });
    const nav = [];
    if (cur > 0)
        nav.push(cb('⬅️ Prev', `pr:l:${cur - 1}`));
    if (pages > 1)
        nav.push(cb(`${cur + 1} / ${pages}`, 'noop'));
    if (cur + 1 < pages)
        nav.push(cb('Next ➡️', `pr:l:${cur + 1}`));
    if (nav.length)
        rows.push(nav);
    rows.push([cb('➕ New product', 'pr:new')]);
    rows.push(panelBack);
    const visible = products.filter((p) => p.active).length;
    await (0, ui_1.editOrReply)(ctx, [
        `🗂 <b>Products</b> (${products.length}${products.length ? ` • ${visible} visible` : ''})`,
        ui_1.LINE,
        products.length ? 'Tap a product to edit its 💵 price, description and limits, or to upload stock.' : 'No products yet. Create your first product 👇',
        '',
        '💡 <b>Add stock:</b> open a product → 📥 Upload file, <b>or</b> send an <b>.xlsx / .csv</b> file to this chat and pick the product afterwards.',
        '🟢 in stock • ⚠️ low • 🔴 sold out • ⚪ hidden',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
async function showProductCard(ctx, id, notice) {
    const p = await (0, catalog_1.getProduct)(id);
    if (!p)
        return (0, ui_1.editOrReply)(ctx, 'Product not found.', telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Products', 'pr:l:0')]]));
    await (0, ui_1.clearState)(ctx.dbUser._id);
    const [stock, sales] = await Promise.all([(0, catalog_1.getProductStock)(p._id), (0, stats_1.getProductSales)(p._id)]);
    const structure = p.columnCount > 0
        ? [
            `🧱 Structure: <b>${p.columnCount}</b> column(s) • header row: <b>${p.hasHeader ? 'yes' : 'no'}</b>`,
            p.hasHeader ? `Columns: ${(0, ui_1.esc)((0, ui_1.trunc)(p.columns.join(' | '), 200))}` : '',
        ].filter(Boolean)
        : ['🧱 Structure: <i>not defined yet — upload a file and it will be set from that file</i>'];
    const limits = (0, catalog_1.describeLimits)(p);
    const rows = [
        [cb('📥 Upload file', `pr:u:${p._id}`)],
        [cb('💵 Price', `pr:e:${p._id}:p`), cb('📏 Limits', `pr:e:${p._id}:l`)],
        [cb('✏️ Name', `pr:e:${p._id}:n`), cb('📝 Description', `pr:e:${p._id}:d`)],
        [cb(p.active ? '👁 Hide from shop' : '👁 Show in shop', `pr:t:${p._id}`), cb(`📄 Delivery: ${p.format.toUpperCase()} (switch)`, `pr:f:${p._id}`)],
        [cb('🧹 Clear unsold', `pr:cl:${p._id}`), cb('🗑 Delete', `pr:del:${p._id}`)],
        [cb('⬅️ Products', 'pr:l:0')],
    ];
    await (0, ui_1.editOrReply)(ctx, [
        notice ?? '',
        `📦 <b>${(0, ui_1.esc)(p.name)}</b> ${p.active ? '🟢 visible' : '⚪ hidden'}`,
        p.description ? `<i>${(0, ui_1.esc)(p.description)}</i>` : '',
        ui_1.LINE,
        `💵 Price: <b>${(0, money_1.fmt)(p.price)}</b> each`,
        `📏 Per order: ${limits ? `<b>${limits}</b>` : 'no limits (1 up to the stock)'}`,
        `📊 Stock: 🟢 <b>${stock.available}</b> available • 🔴 ${stock.sold} sold • ${stock.total} total`,
        `💰 Sales: <b>${(0, money_1.fmt)(sales.revenue)}</b> • ${sales.orders} orders • ${sales.items} items`,
        ...structure,
        `📄 Buyers receive: <b>${p.format.toUpperCase()}</b>`,
    ]
        .filter((l, i) => !(i === 0 && l === ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n'), telegraf_1.Markup.inlineKeyboard(rows));
}
// =====================================================================
//  Create / edit
// =====================================================================
async function askName(ctx, pending) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_name', pending ? { pending } : {});
    await (0, ui_1.editOrReply)(ctx, `➕ <b>New product</b>\n\n✏️ Send the product name (2–${catalog_1.NAME_MAX} characters), e.g. <i>Gmail accounts</i>.\n/cancel to stop.`, telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Products', 'pr:l:0')]]));
}
async function askPrice(ctx, name, pending) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_price', { name, ...(pending ? { pending } : {}) });
    await ctx.reply(`💵 <b>Price</b> for <b>${(0, ui_1.esc)(name)}</b>\nSend the price of <b>one item</b> (up to 2 decimals), e.g. <code>5</code> or <code>0.85</code>.\n<i>Each product has its own price — you can change it any time.</i>`, { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb('✖️ Cancel', 'pr:l:0')]]) });
}
async function askDescription(ctx, name, price, pending) {
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_desc', { name, price, ...(pending ? { pending } : {}) });
    await ctx.reply(`📝 Description for <b>${(0, ui_1.esc)(name)}</b> (${(0, money_1.fmt)(price)} each)?\nBuyers see it under the product name. Send the text (max ${catalog_1.DESC_MAX} characters), or skip — you can add it later.`, { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb('⏭ Skip', 'pr:ds:skip')], [cb('✖️ Cancel', 'pr:l:0')]]) });
}
async function finishCreate(ctx, name, price, description, pending) {
    const p = await (0, catalog_1.createProduct)(name, price, description);
    if (pending) {
        await ctx.reply(`✅ Product <b>${(0, ui_1.esc)(p.name)}</b> created (${(0, money_1.fmt)(p.price)} each). Processing your file…`, ui_1.HTML);
        return beginUpload(ctx, p, pending);
    }
    await showProductCard(ctx, String(p._id), '✅ Product created. Now 📥 upload a file with its data.');
}
async function askEdit(ctx, id, field) {
    const p = await (0, catalog_1.getProduct)(id);
    if (!p)
        return showProductList(ctx);
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_edit', { productId: id, field });
    const prompt = {
        n: `✏️ <b>Rename</b> — current: <b>${(0, ui_1.esc)(p.name)}</b>\n\nSend the new name.`,
        p: `💵 <b>Change price</b> — current: <b>${(0, money_1.fmt)(p.price)}</b> each\n\nSend the new price per item (e.g. <code>4.5</code>). Orders already placed keep their old price, and buyers who are on the confirm screen are asked to start again.`,
        l: `📏 <b>Order limits</b> — current: <b>${(0, catalog_1.describeLimits)(p) || 'none'}</b>\n\nSend the <b>minimum and maximum</b> quantity per order, e.g. <code>1 100</code> or <code>10 500</code>.\nUse <code>0</code> as the maximum for no cap (buyers can take everything in stock). Send <code>-</code> to remove all limits.`,
        d: `📝 <b>Description</b> — current: ${p.description ? `<i>${(0, ui_1.esc)(p.description)}</i>` : '<i>none</i>'}\n\nSend the new description (shown to buyers), or <code>-</code> to remove it.`,
    }[field];
    await (0, ui_1.editOrReply)(ctx, `${prompt}\n/cancel to stop.`, telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', `pr:v:${id}`)]]));
}
/** Text router entry for every product-related conversation state. */
async function handleProductInput(ctx, stateName, text) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Admin only.');
    const data = (ctx.dbUser.state?.data ?? {});
    const pending = data.pending;
    try {
        switch (stateName) {
            case 'awaiting_product_name': {
                const name = text.trim().replace(/\s+/g, ' ');
                if (name.length < 2 || name.length > catalog_1.NAME_MAX)
                    return ctx.reply(`Name must be 2–${catalog_1.NAME_MAX} characters. Try again or /cancel.`);
                if (await Product_1.Product.exists({ nameKey: name.toLowerCase() }))
                    return ctx.reply('A product with this name already exists. Send a different name, or /cancel.');
                return askPrice(ctx, name, pending);
            }
            case 'awaiting_product_price': {
                const price = (0, money_1.parseAmount)(text);
                if (!price)
                    return ctx.reply('Please send a valid price greater than 0, e.g. 5 or 0.85 (/cancel to stop)');
                return askDescription(ctx, String(data.name ?? ''), price, pending);
            }
            case 'awaiting_product_desc':
                return finishCreate(ctx, String(data.name ?? ''), Number(data.price), text, pending);
            case 'awaiting_product_edit': {
                const id = String(data.productId ?? '');
                const p = await (0, catalog_1.getProduct)(id);
                if (!p)
                    return showProductList(ctx);
                if (data.field === 'n') {
                    await (0, catalog_1.renameProduct)(p._id, text);
                }
                else if (data.field === 'p') {
                    const price = (0, money_1.parseAmount)(text);
                    if (!price)
                        return ctx.reply('Please send a valid price greater than 0, e.g. 5 or 0.85 (/cancel to stop)');
                    await (0, catalog_1.setPrice)(p._id, price);
                }
                else if (data.field === 'l') {
                    const lim = (0, catalog_1.parseLimits)(text);
                    if (typeof lim === 'string')
                        return ctx.reply(`❌ ${lim}\n(/cancel to stop)`);
                    await (0, catalog_1.setQtyLimits)(p._id, lim.min, lim.max);
                }
                else if (data.field === 'd') {
                    await (0, catalog_1.setDescription)(p._id, text.trim() === '-' ? '' : text);
                }
                return showProductCard(ctx, id, '✅ Saved.');
            }
        }
    }
    catch (e) {
        if (e instanceof errors_1.AppError)
            return ctx.reply(`❌ ${e.message}`);
        logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Product input failed');
        return ctx.reply('⚠️ Something went wrong. Please try again.');
    }
}
// =====================================================================
//  Upload (file first or product first)
// =====================================================================
async function download(ctx, f) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const link = await ctx.telegram.getFileLink(f.fileId);
            const res = await axios_1.default.get(link.href, {
                responseType: 'arraybuffer',
                timeout: 30_000,
                maxContentLength: 50 * 1024 * 1024,
            });
            return Buffer.from(res.data);
        }
        catch (e) {
            lastErr = e;
            logger_1.logger.warn({ err: (0, errors_1.safeError)(e), attempt }, 'Telegram file download failed');
            await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
    }
    logger_1.logger.error({ err: (0, errors_1.safeError)(lastErr) }, 'Telegram file download gave up');
    throw new errors_1.AppError('Could not download the file from Telegram. Please try again in a moment.');
}
async function showUploadPrompt(ctx, id) {
    const [p, s] = await Promise.all([(0, catalog_1.getProduct)(id), (0, settings_1.getSettings)()]);
    if (!p)
        return showProductList(ctx);
    const locked = await (0, catalog_1.isStructureLocked)(p._id);
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_file', { productId: id });
    await (0, ui_1.editOrReply)(ctx, [
        `📥 <b>Upload data → ${(0, ui_1.esc)(p.name)}</b>`,
        '',
        '👇 <b>Send an .xlsx or .csv file now</b> (as a file/document, max ' + s.maxUploadMb + ' MB).',
        '',
        locked
            ? `🧱 This product already has a structure: <b>${p.columnCount}</b> column(s), header row: <b>${p.hasHeader ? 'yes' : 'no'}</b>.\nYour file must have the <b>same columns</b>. One row = one sellable item.`
            : '🧱 This product has no structure yet. Your file defines it: every column is kept, and buyers get files with exactly this layout. One row = one sellable item.',
        '/cancel to stop.',
    ].join('\n'), telegraf_1.Markup.inlineKeyboard([[cb('⬅️ Back', `pr:v:${id}`)]]));
}
/** Admin sent a file. */
async function handleAdminDocument(ctx) {
    if (!ctx.isAdmin)
        return ctx.reply('⛔ Only admins can upload files.');
    const doc = ctx.message.document;
    const name = doc.file_name ?? 'upload.xlsx';
    if (!(0, dataFile_1.formatOf)(name)) {
        return ctx.reply(/\.xls$/i.test(name)
            ? '❌ Old .xls files are not supported. In Excel choose Save As → .xlsx (or .csv) and upload that.'
            : '❌ Please upload an .xlsx (Excel) or .csv file.');
    }
    const { maxUploadMb } = await (0, settings_1.getSettings)();
    if ((doc.file_size ?? 0) > maxUploadMb * 1024 * 1024)
        return ctx.reply(`❌ File too large (max ${maxUploadMb} MB).`);
    const pending = { fileId: doc.file_id, fileName: name, fileSize: doc.file_size ?? 0 };
    // product first: the admin opened a product and pressed "Upload file"
    const target = freshState(ctx, 'awaiting_product_file');
    if (target && isId(target.productId)) {
        const p = await (0, catalog_1.getProduct)(target.productId);
        if (p)
            return beginUpload(ctx, p, pending);
    }
    // file first: ask which product it belongs to
    await showPickProduct(ctx, pending, 0);
}
async function showPickProduct(ctx, pending, page) {
    const products = await Product_1.Product.find().sort({ name: 1 }).lean();
    await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_product_pick', { pending });
    const pages = Math.max(1, Math.ceil(products.length / PAGE));
    const cur = Math.min(Math.max(0, page), pages - 1);
    const rows = products.slice(cur * PAGE, (cur + 1) * PAGE).map((p) => [cb((0, ui_1.trunc)(`📦 ${p.name} • ${(0, money_1.fmt)(p.price)}`, 60), `pu:pick:${p._id}`)]);
    const nav = [];
    if (cur > 0)
        nav.push(cb('⬅️ Prev', `pu:pl:${cur - 1}`));
    if (cur + 1 < pages)
        nav.push(cb('Next ➡️', `pu:pl:${cur + 1}`));
    if (nav.length)
        rows.push(nav);
    rows.push([cb('➕ New product for this file', 'pu:newp')]);
    rows.push([cb('✖️ Cancel', 'pu:cancel')]);
    const text = `📄 <b>${(0, ui_1.esc)(pending.fileName)}</b> received.\n\nWhich product is this file for?`;
    if (ctx.callbackQuery)
        await (0, ui_1.editOrReply)(ctx, text, telegraf_1.Markup.inlineKeyboard(rows));
    else
        await ctx.reply(text, { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard(rows) });
}
const previewRow = (cells) => (0, ui_1.esc)((0, ui_1.trunc)(cells.slice(0, 6).map((c) => (0, ui_1.trunc)(c, 22)).join(' | ') + (cells.length > 6 ? ' | …' : ''), 150));
/** Starts an import: ask about the header row when the structure is still open, import straight away when it is locked. */
async function beginUpload(ctx, product, pending) {
    try {
        if (await (0, catalog_1.isStructureLocked)(product._id))
            return runImport(ctx, product._id, pending, product.hasHeader);
        const sheet = await (0, dataFile_1.parseDataFile)(await download(ctx, pending), pending.fileName);
        await (0, ui_1.setState)(ctx.dbUser._id, 'awaiting_header_choice', { productId: String(product._id), pending });
        const sample = sheet.rows.slice(0, 3).map((r, i) => `Row ${i + 1}: ${previewRow(r)}`);
        await ctx.reply([
            `🧱 <b>Define structure for ${(0, ui_1.esc)(product.name)}</b>`,
            `📄 ${(0, ui_1.esc)(pending.fileName)} • ${sheet.rows.length} row(s) • <b>${sheet.width}</b> column(s)`,
            '',
            ...sample,
            '',
            '❓ Is <b>row 1</b> a header row (column titles)?',
            '<i>Yes → titles are kept and buyers get the same header. No → every row is a sellable item.</i>',
        ].join('\n'), { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb('✅ Yes, row 1 is a header', 'pu:h:1')], [cb('❌ No, all rows are data', 'pu:h:0')], [cb('✖️ Cancel', 'pu:cancel')]]) });
    }
    catch (e) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        if (e instanceof errors_1.AppError)
            return ctx.reply(`❌ ${e.message}`);
        logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Upload preview failed');
        return ctx.reply(`❌ Could not read that file. Make sure it is a valid .xlsx or .csv.\n<code>${(0, ui_1.esc)(String(e?.message ?? e).slice(0, 200))}</code>`, ui_1.HTML);
    }
}
async function runImport(ctx, productId, pending, hasHeader) {
    const wait = await ctx.reply('⏳ Importing…');
    try {
        const sheet = await (0, dataFile_1.parseDataFile)(await download(ctx, pending), pending.fileName);
        const r = await (0, catalog_1.importIntoProduct)(productId, sheet, hasHeader, pending.fileName, ctx.from.id);
        const p = await (0, catalog_1.getProduct)(productId);
        const stock = await (0, catalog_1.getProductStock)(productId);
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.reply([
            `✅ <b>Import finished</b> — ${(0, ui_1.esc)(pending.fileName)}`,
            `📦 Product: <b>${(0, ui_1.esc)(p?.name ?? '')}</b>`,
            r.structureDefined && p ? `🧱 Structure set: ${p.columnCount} column(s), header row: ${p.hasHeader ? 'yes' : 'no'}, delivered as ${p.format.toUpperCase()}` : '',
            '',
            `Rows read: ${r.totalRows}`,
            `➕ New items added: <b>${r.inserted}</b>`,
            `♻️ Already in this product (skipped): ${r.duplicatesInDb}`,
            `👯 Duplicates inside file: ${r.duplicatesInFile}`,
            `📊 Available now: <b>${stock.available}</b>`,
        ]
            .filter(Boolean)
            .join('\n'), { ...ui_1.HTML, ...telegraf_1.Markup.inlineKeyboard([[cb('📦 Open product', `pr:v:${productId}`), cb('🗂 Products', 'pr:l:0')]]) });
    }
    catch (e) {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        if (e instanceof errors_1.AppError)
            await ctx.reply(e.message.startsWith('❌') ? e.message : `❌ ${e.message}`);
        else {
            logger_1.logger.error({ err: (0, errors_1.safeError)(e) }, 'Import failed');
            await ctx.reply('❌ Import failed. Check the logs.');
        }
    }
    finally {
        await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => undefined);
    }
}
// =====================================================================
//  Registration
// =====================================================================
function registerProductHandlers(bot) {
    bot.on('document', handleAdminDocument);
    bot.command('products', auth_1.adminOnly, (ctx) => showProductList(ctx, 0));
    bot.command('newproduct', auth_1.adminOnly, (ctx) => askName(ctx));
    const act = (re, fn) => bot.action(re, auth_1.adminOnly, async (ctx) => {
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
        if (!d)
            return ctx.reply('Session expired. Use /newproduct to start again.');
        await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
        try {
            await finishCreate(ctx, String(d.name ?? ''), Number(d.price), undefined, d.pending);
        }
        catch (e) {
            await ctx.reply(e instanceof errors_1.AppError ? `❌ ${e.message}` : '⚠️ Something went wrong.');
        }
    });
    act(/^pr:t:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        await Product_1.Product.updateOne({ _id: p._id }, { $set: { active: !p.active } });
        return showProductCard(ctx, String(p._id), p.active ? '⚪ Product hidden from the shop.' : '🟢 Product is now visible in the shop.');
    });
    act(/^pr:f:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        const next = p.format === 'xlsx' ? 'csv' : 'xlsx';
        await Product_1.Product.updateOne({ _id: p._id }, { $set: { format: next } });
        return showProductCard(ctx, String(p._id), `📄 Buyers will now receive ${next.toUpperCase()} files.`);
    });
    act(/^pr:cl:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        const st = await (0, catalog_1.getProductStock)(p._id);
        await (0, ui_1.editOrReply)(ctx, `🧹 Delete all <b>${st.available}</b> unsold item(s) of <b>${(0, ui_1.esc)(p.name)}</b>?\nSold items and order history are kept. This cannot be undone.`, telegraf_1.Markup.inlineKeyboard([[cb('✅ Yes, delete unsold', `pr:clok:${p._id}`), cb('✖️ No', `pr:v:${p._id}`)]]));
    });
    act(/^pr:clok:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        const n = await (0, catalog_1.clearUnsold)(p._id);
        return showProductCard(ctx, String(p._id), `🧹 Removed ${n} unsold item(s).`);
    });
    act(/^pr:del:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        await (0, ui_1.editOrReply)(ctx, `🗑 Delete product <b>${(0, ui_1.esc)(p.name)}</b> and its unsold items?\nOnly possible when it has no sales — otherwise hide it instead.`, telegraf_1.Markup.inlineKeyboard([[cb('✅ Yes, delete', `pr:delok:${p._id}`), cb('✖️ No', `pr:v:${p._id}`)]]));
    });
    act(/^pr:delok:([a-f0-9]{24})$/, async (ctx) => {
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return showProductList(ctx);
        try {
            await (0, catalog_1.deleteProduct)(p._id);
        }
        catch (e) {
            if (e instanceof errors_1.AppError)
                return showProductCard(ctx, String(p._id), `❌ ${e.message}`);
            throw e;
        }
        await ctx.reply(`🗑 Product "${p.name}" deleted.`);
        return showProductList(ctx);
    });
    // ----- file first: pick the product for a file that was just uploaded -----
    act(/^pu:pl:(\d+)$/, async (ctx) => {
        const d = freshState(ctx, 'awaiting_product_pick');
        if (!d?.pending)
            return ctx.reply('Session expired. Please send the file again.');
        return showPickProduct(ctx, d.pending, parseInt(ctx.match[1], 10));
    });
    act(/^pu:pick:([a-f0-9]{24})$/, async (ctx) => {
        const d = freshState(ctx, 'awaiting_product_pick');
        if (!d?.pending)
            return ctx.reply('Session expired. Please send the file again.');
        const p = await (0, catalog_1.getProduct)(ctx.match[1]);
        if (!p)
            return ctx.reply('Product not found.');
        await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
        return beginUpload(ctx, p, d.pending);
    });
    act('pu:newp', async (ctx) => {
        const d = freshState(ctx, 'awaiting_product_pick');
        if (!d?.pending)
            return ctx.reply('Session expired. Please send the file again.');
        return askName(ctx, d.pending);
    });
    act(/^pu:h:(0|1)$/, async (ctx) => {
        const d = freshState(ctx, 'awaiting_header_choice');
        if (!d?.pending || !isId(d.productId))
            return ctx.reply('Session expired. Please send the file again.');
        await ctx.editMessageReplyMarkup(undefined).catch(() => undefined); // block double taps
        return runImport(ctx, new mongoose_1.Types.ObjectId(d.productId), d.pending, ctx.match[1] === '1');
    });
    act('pu:cancel', async (ctx) => {
        await (0, ui_1.clearState)(ctx.dbUser._id);
        await ctx.editMessageText('Upload cancelled.').catch(() => undefined);
    });
}
//# sourceMappingURL=products.js.map