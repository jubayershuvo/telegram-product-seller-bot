"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractBkashSMSData = extractBkashSMSData;
function extractBkashSMSData(body) {
    const match = body.match(/^You have received Tk (\d+\.\d{2}) from (\d{11})\. Fee Tk \d+\.\d{2}\. Balance Tk \d+\.\d{2}\. TrxID ([A-Z0-9]+) at (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/);
    if (!match)
        return null;
    return {
        amount: Number(match[1]),
        sender: match[2],
        trxId: match[3],
        receivedAt: match[4],
    };
}
//# sourceMappingURL=bkash-sms-data-extractor.js.map