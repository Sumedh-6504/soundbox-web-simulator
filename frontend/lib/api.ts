// Shared API helpers. Everything here runs in the browser only.
import type { Ad } from "./announce";

export type Payment = {
  type: "payment";
  txn_id: string;
  amount: number;
  ts: number;
  ad: Ad;
  lang?: "hi" | "en";
};
export type QrInfo = {
  kind: "static" | "dynamic";
  amount: number | null;
  device_online: boolean;
  merchant: string;
};
export type PaymentSession = {
  payment_id: string;
  amount: number;
  merchant: string;
  bank: string;
  device_online: boolean;
};
export type PayResult = { status: string; announced: boolean; txn_id: string; amount: number; ts: number; ad: Ad };

// Empty NEXT_PUBLIC_API_URL -> same host as the page, port 8000 (so LAN testing just works).
export const apiBase = (): string =>
  process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:8000`;

export const wsBase = (): string => apiBase().replace(/^http/, "ws");

export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem("soundbox_device_id");
    if (saved) return saved;
    const id = "sb-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("soundbox_device_id", id);
    return id;
  } catch {
    return "sb-" + Math.random().toString(36).slice(2, 10);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = "Please check the amount";
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export const getStaticToken = (deviceId: string) =>
  request<{ token: string }>(`/api/qr/static/${deviceId}`);

export const createDynamicQr = (deviceId: string, amount: number) =>
  request<{ token: string; amount: number }>("/api/qr/dynamic", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, amount }),
  });

export const getQr = (token: string) => request<QrInfo>(`/api/qr/${encodeURIComponent(token)}`);

/** Dummy UPI step 1: start a payment for the scanned QR. */
export const initiatePayment = (token: string, amount?: number, lang?: string) =>
  request<PaymentSession>("/api/pay/initiate", {
    method: "POST",
    body: JSON.stringify({ token, amount, lang }),
  });

/** Dummy UPI step 2: confirm with a PIN. Throws with a readable message on a wrong PIN. */
export const confirmPayment = (paymentId: string, pin: string, lang?: string) =>
  request<PayResult>("/api/pay/confirm", {
    method: "POST",
    body: JSON.stringify({ payment_id: paymentId, pin, lang }),
  });

/** Pay-page URL that goes inside a QR. */
export const payUrl = (token: string, lang?: string) =>
  `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}/pay?token=${encodeURIComponent(
    token
  )}${lang ? `&lang=${lang}` : ""}`;
