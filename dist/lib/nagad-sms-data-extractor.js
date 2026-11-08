"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNagadSMSData = extractNagadSMSData;
function extractNagadSMSData(body) {
    const match = body.match(/^Money Received\.\nAmount: Tk (\d+\.\d{2})\nSender: (\d{11})\nRef: N\/A\nTxnID: ([A-Z0-9]+)\nBalance: Tk \d+\.\d{2}\n(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/);
    if (!match)
        return null;
    return {
        amount: Number(match[1]),
        sender: match[2],
        trxId: match[3],
        receivedAt: match[4],
    };
}
//# sourceMappingURL=nagad-sms-data-extractor.js.map