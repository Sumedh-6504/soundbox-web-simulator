"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

function extractToken(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("s_") || trimmed.startsWith("d_")) {
    return trimmed;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
    const url = new URL(trimmed, base);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

export default function ScanPage() {
  const router = useRouter();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scannedUrl, setScannedUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [insecure, setInsecure] = useState(false);

  useEffect(() => {
    setInsecure(!window.isSecureContext);
    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []);

  const stopScanner = async () => {
    try {
      await scannerRef.current?.stop();
      scannerRef.current?.clear();
    } catch {}
    scannerRef.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    setError("");
    setScannedUrl("");
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          setScannedUrl(text);
          stopScanner();
        },
        () => {}
      );
      setScanning(true);
    } catch {
      scannerRef.current = null;
      setError("Camera not available. Allow camera access, or paste the QR link below.");
    }
  };

  const goPay = (url: string) => {
    const token = extractToken(url);
    if (!token) return setError("That is not a soundbox QR link.");
    router.push(`/pay?token=${encodeURIComponent(token)}`);
  };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <Link
        href="/"
        onClick={() => {
          scannerRef.current?.stop().catch(() => {});
        }}
        className="mb-4 inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:border-slate-400"
      >
        ← Back
      </Link>
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scan QR</h1>
        <Link href="/simulator" className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm">
          Soundbox →
        </Link>
      </header>

      {insecure && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Phones only allow the camera on HTTPS pages (or localhost). On plain HTTP, scan the soundbox QR with your
          phone&apos;s normal camera app instead, or paste the link below.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {/* Scan box */}
      <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-800">
        <div id="qr-reader" className="w-full" />
        {!scanning && (
          <div className="p-6 text-center">
            <button
              onClick={startScanner}
              className="rounded-2xl bg-emerald-500 px-6 py-3 text-lg font-bold text-slate-900"
            >
              {scannedUrl ? "Scan again" : "Start camera"}
            </button>
          </div>
        )}
        {scanning && (
          <div className="p-3 text-center">
            <button onClick={stopScanner} className="text-sm text-slate-400 underline">
              Stop camera
            </button>
          </div>
        )}
      </div>

      {/* URL shown after scanning */}
      {scannedUrl && (
        <section className="mt-5 rounded-3xl border border-emerald-500/50 bg-slate-800 p-5">
          <p className="mb-1 text-sm text-slate-400">Scanned link</p>
          <p className="mb-4 break-all font-mono text-sm">{scannedUrl}</p>
          <button
            onClick={() => goPay(scannedUrl)}
            className="w-full rounded-2xl bg-emerald-500 py-3 text-lg font-bold text-slate-900"
          >
            Continue to pay →
          </button>
        </section>
      )}

      {/* Paste fallback */}
      <section className="mt-5 rounded-3xl border border-slate-700 bg-slate-800 p-5">
        <p className="mb-2 text-sm text-slate-400">No camera? Paste the QR link</p>
        <input
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="http://…/pay?token=…"
          className="mb-3 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-400"
        />
        <button
          onClick={() => {
            setError("");
            setScannedUrl(pasted.trim());
          }}
          disabled={!pasted.trim()}
          className="w-full rounded-xl border border-slate-500 py-2 font-semibold disabled:opacity-40"
        >
          Use this link
        </button>
      </section>
    </main>
  );
}
