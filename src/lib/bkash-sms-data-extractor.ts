
export interface PaymentSMSData {
  trxId: string;
  amount: number;
  sender: string;
  receivedAt: string;
}

export function extractBkashSMSData(
  body: string,
): PaymentSMSData | null {
  const match = body.match(
    /^You have received Tk (\d+\.\d{2}) from (\d{11})\. Fee Tk \d+\.\d{2}\. Balance Tk \d+\.\d{2}\. TrxID ([A-Z0-9]+) at (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})$/,
  );

  if (!match) return null;

  return {
    amount: Number(match[1]),
    sender: match[2],
    trxId: match[3],
    receivedAt: match[4],
  };
}
