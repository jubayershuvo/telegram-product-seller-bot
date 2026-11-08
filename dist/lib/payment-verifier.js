"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPayment = verifyPayment;
const bkash_sms_data_extractor_1 = require("./bkash-sms-data-extractor");
const nagad_sms_data_extractor_1 = require("./nagad-sms-data-extractor");
const SMS_API_URL = "https://smssync-server.vercel.app/api/messages";
async function verifyPayment({ trxId, provider, }) {
    const transactionId = trxId.trim();
    if (!transactionId) {
        return {
            success: false,
            verified: false,
            trxId,
            error: "Transaction ID is required.",
        };
    }
    if (!["NAGAD", "bKash"].includes(provider)) {
        return {
            success: false,
            verified: false,
            trxId: transactionId,
            error: "Invalid payment provider.",
        };
    }
    const apiKey = process.env.SMSSYNC_API_KEY;
    if (!apiKey) {
        return {
            success: false,
            verified: false,
            trxId: transactionId,
            error: "SMSSYNC_API_KEY is missing.",
        };
    }
    try {
        const url = new URL(SMS_API_URL);
        url.searchParams.set("sender", provider);
        url.searchParams.set("type", "incoming");
        url.searchParams.set("body", transactionId);
        url.searchParams.set("limit", "50");
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            signal: AbortSignal.timeout(15000)
        });
        const result = (await response.json());
        if (!response.ok || !result.success) {
            return {
                success: false,
                verified: false,
                trxId: transactionId,
                error: result.error || `SMS API error: ${response.status}`,
            };
        }
        // Find SMS using exact, case-sensitive provider matching.
        const sms = result.data?.find((item) => item.sender.trim() === provider &&
            item.type === "incoming" &&
            item.body.includes(transactionId));
        if (!sms) {
            return {
                success: true,
                verified: false,
                trxId: transactionId,
                error: "Transaction ID not found.",
            };
        }
        // Pass SMS body to the provider-specific extractor.
        const extracted = provider === "bKash"
            ? (0, bkash_sms_data_extractor_1.extractBkashSMSData)(sms.body)
            : (0, nagad_sms_data_extractor_1.extractNagadSMSData)(sms.body);
        if (!extracted) {
            return {
                success: true,
                verified: false,
                trxId: transactionId,
                error: "Invalid SMS template or unsupported payment message.",
            };
        }
        if (extracted.trxId !== transactionId) {
            return {
                success: true,
                verified: false,
                trxId: transactionId,
                error: "Transaction ID does not match.",
            };
        }
        return {
            success: true,
            verified: true,
            trxId: transactionId,
            provider,
            amount: extracted.amount,
            sender: extracted.sender,
            receivedAt: extracted.receivedAt,
            message: sms,
        };
    }
    catch (error) {
        return {
            success: false,
            verified: false,
            trxId: transactionId,
            error: error instanceof Error
                ? error.message
                : "Payment verification failed.",
        };
    }
}
//# sourceMappingURL=payment-verifier.js.map