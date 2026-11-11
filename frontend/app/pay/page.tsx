"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  confirmPayment,
  getQr,
  initiatePayment,
  type PayResult,
  type PaymentSession,
  type QrInfo,
} from "@/lib/api";
import { announceSuccess, playChime, unlockAudio, type Lang } from "@/lib/announce";

type Step = "amount" | "pin" | "processing" | "success";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function PayInner({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const urlLang = searchParams.get("lang");

  useEffect(() => {
    if (urlLang === "en" || urlLang === "hi") {
      setLang(urlLang as Lang);
    }
  }, [urlLang, setLang]);

  const [info, setInfo] = useState<QrInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<Step>("amount");
  const [amountInput, setAmountInput] = useState("");
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayResult | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!token) return setLoadError("No QR token in this link.");
    getQr(token)
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load QR"));
  }, [token]);

  const fixed = info?.amount != null;
  const amount = fixed ? info!.amount! : parseFloat(amountInput);

  // Step 1 -> 2: create the pending payment, then ask for the PIN
  const proceed = async () => {
    if (!token || !(amount > 0) || busy) return;
    setBusy(true);
    setError("");
    try {
      setSession(await initiatePayment(token, fixed ? undefined : amount, lang));
      setPin("");
      setStep("pin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment");
    } finally {
      setBusy(false);
    }
  };

  const pressPin = (k: string) => {
    if (busy || !k) return;
    setError("");
    setPin((cur) => (k === "⌫" ? cur.slice(0, -1) : cur.length < 6 ? cur + k : cur));
  };

  // Step 2 -> 3: verify the PIN
  const submitPin = async () => {
    if (!session || pin.length < 4 || busy) return;
    unlockAudio(); // we're inside a click, so the browser allows speech from now on
    setBusy(true);
    setError("");
    setStep("processing");
    const started = Date.now();
    try {
      const res = await confirmPayment(session.payment_id, pin, lang);
      await sleep(Math.max(0, 1300 - (Date.now() - started))); // let the "processing" state be seen
      setResult(res);
      setStep("success");
      if (res.announced) {
        // Soundbox simulator (/simulator) is online and announcing via WebSocket.
        // Play local chime on customer screen, letting the Soundbox speak without two tabs colliding!
        playChime();
      } else {
        // Soundbox is offline; speak directly from the customer screen
        announceSuccess(res.amount, lang, res.ad);
      }
    } catch (e) {
      await sleep(Math.max(0, 900 - (Date.now() - started)));
      const msg = e instanceof Error ? e.message : "Payment failed";
      setError(msg);
      setPin("");
      if (/cancelled|failed|not found/i.test(msg)) setCancelled(true);
      setStep("pin");
    } finally {
      setBusy(false);
    }
  };

  // ---------- views ----------
  if (loadError) {
    return (
      <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-red-200">{loadError}</p>
    );
  }
  if (!info) return <p className="text-slate-400">Loading…</p>;

  if (step === "success" && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-emerald-500/50 bg-slate-800 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-slate-900">
            ✓
          </div>
          <h2 className="text-2xl font-bold">{lang === "hi" ? "भुगतान सफल" : "Payment successful"}</h2>
          <p className="mt-2 text-4xl font-bold text-emerald-400">₹{result.amount}</p>
          <p className="mt-1 text-sm text-slate-300">
            {lang === "hi" ? "प्राप्तकर्ता" : "Paid to"} {info.merchant}
          </p>
          <p className="mt-2 text-xs text-slate-400">{result.txn_id}</p>
          <p className="mt-4 text-sm text-slate-300">
            {result.announced
              ? lang === "hi"
                ? "साउंडबॉक्स ने घोषणा कर दी है।"
                : "The soundbox has announced it."
              : lang === "hi"
                ? "साउंडबॉक्स ऑफ़लाइन है, घोषणा नहीं हुई।"
                : "Soundbox is offline, so nothing was announced."}
          </p>
        </div>

        {/* Ad shown on the customer screen too; the soundbox speaks it aloud */}
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
            {lang === "hi" ? "विज्ञापन" : "From the store"}
          </p>
          <p className="text-lg">{result.ad[lang]}</p>
        </div>

        <div className="space-y-3">
          <Link
            href="/simulator"
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3.5 text-center font-bold text-slate-900 text-base hover:bg-emerald-400 active:scale-[0.99] shadow-lg shadow-emerald-500/25 transition-all"
          >
            ← Return to Soundbox Simulator
          </Link>
          <div className="flex gap-2.5">
            <button
              onClick={() => announceSuccess(result.amount, lang, result.ad)}
              className="flex-1 rounded-xl border border-slate-600 bg-slate-800/80 py-2.5 text-center font-semibold text-sm hover:border-slate-400 transition-colors"
            >
              🔊 {lang === "hi" ? "फिर सुनें" : "Replay Audio"}
            </button>
            <Link
              href="/scan"
              className="flex-1 rounded-xl border border-slate-600 bg-slate-800/80 py-2.5 text-center font-semibold text-sm hover:border-slate-400 transition-colors"
            >
              {lang === "hi" ? "दूसरा स्कैन करें" : "Scan another"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (step === "processing") {
    return (
      <div className="rounded-3xl border border-slate-700 bg-slate-800 p-10 text-center">
        <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-slate-600 border-t-emerald-400" />
        <p className="text-lg font-semibold">{lang === "hi" ? "भुगतान हो रहा है…" : "Processing payment…"}</p>
        <p className="mt-1 text-sm text-slate-400">{lang === "hi" ? "कृपया प्रतीक्षा करें" : "Please don't close this page"}</p>
      </div>
    );
  }

  if (step === "pin" && session) {
    return (
      <div className="rounded-3xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400">{lang === "hi" ? "भुगतान" : "Paying"}</p>
            <p className="font-semibold">{session.merchant}</p>
            <p className="text-xs text-slate-400">{session.bank}</p>
          </div>
          <p className="text-3xl font-bold">₹{session.amount}</p>
        </div>

        <p className="mb-3 text-center text-sm text-slate-300">
          {lang === "hi" ? "अपना UPI PIN दर्ज करें" : "Enter your UPI PIN"}
        </p>

        {/* masked PIN: 6 slots, first 4 are required */}
        <div className="mb-3 flex justify-center gap-3" aria-label="PIN entered">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`flex h-10 w-8 items-center justify-center rounded-lg border text-2xl ${
                i < pin.length ? "border-emerald-400 text-emerald-300" : i < 4 ? "border-slate-500" : "border-slate-700"
              }`}
            >
              {i < pin.length ? "•" : ""}
            </span>
          ))}
        </div>

        {error && <p className="mb-3 text-center text-sm text-red-300">{error}</p>}

        {cancelled ? (
          <Link
            href="/scan"
            className="mt-2 block rounded-2xl bg-emerald-500 py-4 text-center text-lg font-bold text-slate-900"
          >
            {lang === "hi" ? "दोबारा स्कैन करें" : "Scan again"}
          </Link>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {PIN_KEYS.map((k, i) =>
                k ? (
                  <button
                    key={i}
                    onClick={() => pressPin(k)}
                    className="rounded-xl bg-slate-700 py-3 text-xl font-semibold active:bg-slate-600"
                  >
                    {k}
                  </button>
                ) : (
                  <span key={i} />
                )
              )}
            </div>
            <button
              onClick={submitPin}
              disabled={pin.length < 4 || busy}
              className="mt-4 w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-slate-900 disabled:opacity-40"
            >
              {lang === "hi" ? `₹${session.amount} भुगतान करें` : `Pay ₹${session.amount}`}
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              {lang === "hi"
                ? "डेमो: कोई भी 4–6 अंकों का PIN चलेगा (0000 = गलत PIN)"
                : "Demo: any 4–6 digit PIN works (0000 = wrong PIN)"}
            </p>
          </>
        )}
      </div>
    );
  }

  // step === "amount"
  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-800 p-6">
      <p className="text-sm text-slate-400">{lang === "hi" ? "भुगतान प्राप्तकर्ता" : "Paying"}</p>
      <p className="text-lg font-semibold">{info.merchant}</p>
      {!info.device_online && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {lang === "hi"
            ? "साउंडबॉक्स ऑफ़लाइन लगता है। भुगतान होगा, पर घोषणा नहीं होगी।"
            : "Soundbox looks offline. The payment will go through but won't be announced."}
        </p>
      )}

      {fixed ? (
        <p className="my-6 text-center text-5xl font-bold">₹{info.amount}</p>
      ) : (
        <div className="my-6">
          <label className="mb-1 block text-sm text-slate-400">{lang === "hi" ? "राशि दर्ज करें" : "Enter amount"}</label>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3 focus-within:border-emerald-400">
            <span className="text-3xl">₹</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amountInput}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d{0,6}(\.\d{0,2})?$/.test(v)) setAmountInput(v);
              }}
              placeholder="0"
              className="w-full bg-transparent text-3xl outline-none"
            />
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      <button
        onClick={proceed}
        disabled={!(amount > 0) || busy}
        className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-slate-900 disabled:opacity-40"
      >
        {amount > 0
          ? lang === "hi"
            ? `₹${amount} के लिए आगे बढ़ें`
            : `Proceed to pay ₹${amount}`
          : lang === "hi"
            ? "आगे बढ़ें"
            : "Proceed"}
      </button>
    </div>
  );
}

export default function PayPage() {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("soundbox_pay_lang");
      if (saved === "hi" || saved === "en") setLang(saved);
    } catch {}
  }, []);

  const choose = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem("soundbox_pay_lang", l);
    } catch {}
  };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/simulator"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-emerald-400 hover:text-white transition-all shadow-sm"
        >
          ← Back to Soundbox
        </Link>
        <div className="flex gap-1.5">
          {(["en", "hi"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => choose(l)}
              className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-all ${
                lang === l ? "border-emerald-400 bg-emerald-400 text-slate-900 shadow-sm" : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {l === "hi" ? "हिन्दी" : "English"}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{lang === "hi" ? "UPI भुगतान" : "UPI Payment"}</h1>
          <p className="text-xs text-slate-400">NPCI Unified Payments Interface</p>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Verified Merchant
        </div>
      </div>
      <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
        <PayInner lang={lang} setLang={choose} />
      </Suspense>
    </main>
  );
}
