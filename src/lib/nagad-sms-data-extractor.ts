
export interface PaymentSMSData {
  trxId: string;
  amount: number;
  sender: string;
  receivedAt: string;
}

export function extractNagadSMSData(
  body: string,
): PaymentSMSData | null {
  const match = body.match(
    /^Money Received\.\nAmount: Tk (\d+\.\d{2})\nSender: (\d{11})\nRef: N\/A\nTxnID: ([A-Z0-9]+)\nBalance: Tk \d+\.\d{2}\n(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/,
  );

  if (!match) return null;

  return {
    amount: Number(match[1]),
    sender: match[2],
    trxId: match[3],
    receivedAt: match[4],
  };
}
