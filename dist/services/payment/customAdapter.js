"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customVerify = void 0;
/**
 * OPTIONAL escape hatch.
 * If your validation API cannot be described with the payment* settings (/settings in the bot)
 * (signed requests, multi-step auth, odd response shapes...) implement it here and
 * return a function instead of null. It fully replaces the generic HTTP verifier.
 *
 * Example:
 *   export const customVerify = async (i: VerifyInput): Promise<VerifyResult> => {
 *     const res = await fetch(`https://my-api/verify?trx=${i.trxId}`, { headers: { 'X-Key': process.env.MY_KEY! } });
 *     const j: any = await res.json();
 *     return { ok: j.valid === true, amountMinor: Math.round(j.amount * 100), raw: j };
 *   };
 */
exports.customVerify = null;
//# sourceMappingURL=customAdapter.js.map