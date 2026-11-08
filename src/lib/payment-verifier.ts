
import { extractBkashSMSData } from "./bkash-sms-data-extractor";
import { extractNagadSMSData } from "./nagad-sms-data-extractor";

const SMS_API_URL = "https://smssync-server.vercel.app/api/messages";

export type PaymentProvider = "NAGAD" | "bKash";

export interface SMSMessage {
  _id: string;
  sender: string;
  body: string;
  receivedAt: string;
  deviceId?: string;
  messageId?: string;
  type: string;
}

interface SMSApiResponse {
  success: boolean;
  data?: SMSMessage[];
  error?: string;
}

interface VerifyPaymentOptions {
  trxId: string;
  provider: PaymentProvider;
}

export interface PaymentVerifyResult {
  success: boolean;
  verified: boolean;
  trxId: string;
  provider?: PaymentProvider;
  amount?: number;
  sender?: string;
  receivedAt?: string;
  message?: SMSMessage;
  error?: string;
}

export async function verifyPayment({
  trxId,
  provider,
}: VerifyPaymentOptions): Promise<PaymentVerifyResult> {
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

    const result = (await response.json()) as SMSApiResponse;

    if (!response.ok || !result.success) {
      return {
        success: false,
        verified: false,
        trxId: transactionId,
        error: result.error || `SMS API error: ${response.status}`,
      };
    }

    // Find SMS using exact, case-sensitive provider matching.
    const sms = result.data?.find(
      (item) =>
        item.sender.trim() === provider &&
        item.type === "incoming" &&
        item.body.includes(transactionId),
    );

    if (!sms) {
      return {
        success: true,
        verified: false,
        trxId: transactionId,
        error: "Transaction ID not found.",
      };
    }

    // Pass SMS body to the provider-specific extractor.
   
const extracted =
  provider === "bKash"
    ? extractBkashSMSData(sms.body)
    : extractNagadSMSData(sms.body);

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

  } catch (error) {
    return {
      success: false,
      verified: false,
      trxId: transactionId,
      error:
        error instanceof Error
          ? error.message
          : "Payment verification failed.",
    };
  }
}
