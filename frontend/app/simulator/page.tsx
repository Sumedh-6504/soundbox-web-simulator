"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  confirmPayment,
  createDynamicQr,
  getDeviceId,
  getStaticToken,
  initiatePayment,
  payUrl,
  wsBase,
  type Payment,
} from "@/lib/api";
import {
  announcePayment,
  hasVoiceFor,
  playChime,
  subscribeSpeaking,
  unlockAudio,
  type Lang,
} from "@/lib/announce";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

export default function SimulatorPage() {
  const [deviceId, setDeviceId] = useState("");
  const [lang, setLang] = useState<Lang>("hi");
  const [started, setStarted] = useState(false);
  const [online, setOnline] = useState(false);
  const [staticUrl, setStaticUrl] = useState("");
  const [dynamic, setDynamic] = useState<{ url: string; amount: number } | null>(null);
  const [entry, setEntry] = useState("");
  const [last, setLast] = useState<Payment | null>(null);
  const [history, setHistory] = useState<Payment[]>([]);
  const [error, setError] = useState("");
  const [voiceOk, setVoiceOk] = useState(true);
  const [adsOn, setAdsOn] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const langRef = useRef<Lang>(lang);
  const adsRef = useRef(adsOn);
  useEffect(() => {
    langRef.current = lang;
    adsRef.current = adsOn;
  }, [lang, adsOn]);

  // Subscribe to speech synthesis state for live visualizer
  useEffect(() => {
    return subscribeSpeaking(setIsSpeaking);
  }, []);

  // 1) device id + static QR
  useEffect(() => {
    const id = getDeviceId();
    setDeviceId(id);
    setStaticUrl(payUrl(`s_${id}`));
    getStaticToken(id)
      .then(({ token }) => setStaticUrl(payUrl(token)))
      .catch(() =>
        setError(
          "Backend not reachable. Start it with: uvicorn main:app --reload --host 0.0.0.0 --port 8000"
        )
      );
  }, []);

  // 2) incoming payments -> show + announce
  const handlePayment = useCallback((p: Payment) => {
    setLast(p);
    setHistory((h) => [p, ...h].slice(0, 12));
    announcePayment(p.amount, langRef.current, p.ad, adsRef.current);
  }, []);

  // 3) WebSocket with auto-reconnect and keep-alive
  useEffect(() => {
    if (!deviceId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      ws = new WebSocket(`${wsBase()}/ws/${deviceId}`);
      ws.onopen = () => {
        setOnline(true);
        setError("");
        getStaticToken(deviceId)
          .then(({ token }) => setStaticUrl(payUrl(token)))
          .catch(() => {});
        ping = setInterval(
          () => ws?.readyState === WebSocket.OPEN && ws.send("ping"),
          20000
        );
      };
      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "payment") handlePayment(msg as Payment);
        } catch {}
      };
      ws.onclose = () => {
        setOnline(false);
        clearInterval(ping);
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      ws?.close();
    };
  }, [deviceId, handlePayment]);

  // 4) is a matching voice installed?
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const check = () => setVoiceOk(hasVoiceFor(lang));
    check();
    window.speechSynthesis.addEventListener("voiceschanged", check);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", check);
  }, [lang]);

  const press = (k: string) => {
    setError("");
    setEntry((cur) => {
      if (k === "⌫") return cur.slice(0, -1);
      if (k === "." && (cur.includes(".") || cur === "")) return cur === "" ? "0." : cur;
      if (cur.length >= 8) return cur;
      if (cur.includes(".") && cur.split(".")[1].length >= 2) return cur;
      return cur + k;
    });
  };

  const confirmAmount = async () => {
    const amount = parseFloat(entry);
    if (!(amount > 0)) return setError("Enter an amount first");
    try {
      const { token } = await createDynamicQr(deviceId, amount);
      setDynamic({ url: payUrl(token), amount });
      setEntry("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create QR");
    }
  };

  const listen = () => last && announcePayment(last.amount, lang, last.ad, adsOn);

  const copyLink = (url: string, key: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  // Instant 1-click payment simulation for presentations
  const triggerDemoPay = async (amount: number) => {
    if (!deviceId || demoLoading) return;
    setDemoLoading(true);
    setError("");
    try {
      unlockAudio();
      setStarted(true);
      const staticToken = `s_${deviceId}`;
      const session = await initiatePayment(staticToken, amount);
      await confirmPayment(session.payment_id, "1234");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quick demo payment failed");
    } finally {
      setDemoLoading(false);
    }
  };

  const totalCollections = history.reduce((sum, item) => sum + item.amount, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      {/* Top Bar with Hardware Info */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all shadow-sm"
        >
          ← Home
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 border border-slate-700 font-mono">
            📶 4G VoLTE
          </span>
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-slate-300 border border-slate-700 font-mono">
            🔋 98%
          </span>
          <span
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold border ${
              online
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                online ? "bg-emerald-400 animate-pulse" : "bg-red-500"
              }`}
            />
            {online ? "Online" : "Connecting..."}
          </span>
          <Link
            href="/scan"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-semibold hover:border-slate-400 text-slate-200 transition-colors"
          >
            Open Scanner →
          </Link>
        </div>
      </div>

      {/* Main Header */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              PaySound Pro
            </h1>
            <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/30">
              UPI 2.0 Soundbox
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Device ID: <span className="text-slate-300">{deviceId || "generating…"}</span>
          </p>
        </div>

        {/* Audio Engine Status Badge */}
        <div>
          {started ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs font-semibold text-emerald-400">Audio Engine Active</span>
            </div>
          ) : (
            <button
              onClick={() => {
                unlockAudio();
                playChime();
                setStarted(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 text-xs font-bold shadow-lg shadow-emerald-500/25 active:scale-95 transition-all"
            >
              ▶ Enable Audio Engine
            </button>
          )}
        </div>
      </header>

      {/* Soundbox Standby Banner if not activated */}
      {!started && (
        <div className="mb-5 rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 p-4 text-center shadow-lg shadow-emerald-500/10">
          <p className="text-sm font-bold text-emerald-300">
            🔊 Soundbox Audio Engine Standby
          </p>
          <p className="text-xs text-slate-300 mt-1 mb-3 max-w-lg mx-auto">
            Click once to allow the browser to play the dual-tone chime and voice announcements during payments.
          </p>
          <button
            onClick={() => {
              unlockAudio();
              playChime();
              setStarted(true);
            }}
            className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-6 py-2.5 text-xs font-bold text-slate-900 shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
          >
            ▶ Activate Audio Engine &amp; Test Chime
          </button>
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Investor 1-Click Simulation Toolbar */}
      <section className="mb-6 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 text-xl border border-emerald-500/30">
              ⚡
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                Investor 1-Click Payment Demo
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Instant Chime &amp; Voice
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Trigger an authentic payment response without switching tabs or scanning:
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[10, 50, 100, 500].map((amt) => (
              <button
                key={amt}
                disabled={demoLoading || !online}
                onClick={() => triggerDemoPay(amt)}
                className="rounded-xl border border-emerald-500/40 bg-slate-800 px-3.5 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-500 hover:text-slate-900 transition-all disabled:opacity-40 active:scale-95 shadow-sm"
              >
                +₹{amt} Demo
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Soundbox Live Hardware & Metrics Strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/80 p-3.5">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Today Collections
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">₹{totalCollections}</p>
        </div>
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/80 p-3.5">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Transactions
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-100">{history.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/80 p-3.5">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Speaker Output
          </p>
          <div className="mt-1 flex items-center gap-2">
            {isSpeaking ? (
              <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-400">
                <span className="flex gap-0.5 items-end h-4">
                  <span className="w-1 bg-emerald-400 h-2 animate-bounce" />
                  <span className="w-1 bg-emerald-400 h-4 animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1 bg-emerald-400 h-3 animate-bounce [animation-delay:0.3s]" />
                </span>
                Speaking...
              </span>
            ) : (
              <span className="text-sm font-medium text-slate-400">Ready 🔊</span>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700/80 bg-slate-800/80 p-3.5">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Ad Campaign
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-300">
              {adsOn ? "5 In Rotation" : "Muted"}
            </span>
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={adsOn}
                onChange={(e) => setAdsOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Ads
            </label>
          </div>
        </div>
      </div>

      {/* Language toggle */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 bg-slate-800/60 p-3 rounded-2xl border border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Audio Language:
          </span>
          {(["hi", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-all ${
                lang === l
                  ? "border-emerald-400 bg-emerald-400 text-slate-900 shadow-md shadow-emerald-400/20"
                  : "border-slate-600 text-slate-300 hover:border-slate-400"
              }`}
            >
              {l === "hi" ? "हिन्दी" : "English"}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-400 font-mono">
          Audio Engine: Web Audio Chime + TTS
        </div>
      </div>

      {/* Main Hardware Cards Grid */}
      <div className="grid gap-5 md:grid-cols-3">
        {/* 1) Static QR Card */}
        <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-200">Static Merchant QR</h2>
              <span className="rounded bg-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                Any Amount
              </span>
            </div>
            <div className="rounded-2xl bg-white p-3 shadow-inner">
              {staticUrl ? (
                <QRCodeSVG value={staticUrl} className="h-auto w-full" />
              ) : (
                <div className="aspect-square animate-pulse rounded bg-slate-200" />
              )}
            </div>

            {/* Clickable Endpoint Link & Action Buttons */}
            <div className="mt-4 space-y-2.5">
              <a
                href={staticUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between rounded-xl bg-slate-900/90 border border-slate-700 px-3 py-2.5 hover:border-emerald-400 hover:bg-slate-900 transition-all text-left"
              >
                <div className="min-w-0 pr-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Payment Link (Click to open) ↗
                  </span>
                  <span className="block font-mono text-xs text-slate-300 truncate group-hover:text-emerald-300">
                    {staticUrl}
                  </span>
                </div>
                <span className="text-slate-400 group-hover:text-emerald-400 transition-colors text-sm shrink-0">
                  ↗
                </span>
              </a>

              <div className="flex gap-2">
                <a
                  href={staticUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-2.5 text-xs font-bold transition-all shadow-md shadow-emerald-500/20 active:scale-[0.98]"
                >
                  Open Pay Page ↗
                </a>
                <button
                  onClick={() => copyLink(staticUrl, "static")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-600 bg-slate-700/70 hover:border-slate-400 px-3.5 py-2.5 text-xs font-medium text-slate-200 transition-all active:scale-[0.98]"
                >
                  {copied === "static" ? "✓ Copied" : "📋 Copy"}
                </button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Customer scans or opens link to enter amount.
          </p>
        </section>

        {/* 2) Dynamic QR Front Panel */}
        <section className="rounded-3xl border-2 border-emerald-500/50 bg-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-200">Front · Dynamic QR</h2>
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                Amount Locked
              </span>
            </div>

            {dynamic ? (
              <>
                <p className="mb-2 text-center text-3xl font-extrabold text-emerald-400">
                  ₹{dynamic.amount}
                </p>
                <div className="rounded-2xl bg-white p-3 shadow-inner">
                  <QRCodeSVG value={dynamic.url} className="h-auto w-full" />
                </div>

                <div className="mt-4 space-y-2.5">
                  <a
                    href={dynamic.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between rounded-xl bg-slate-900/90 border border-slate-700 px-3 py-2.5 hover:border-emerald-400 hover:bg-slate-900 transition-all text-left"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        Dynamic Pay Link ↗
                      </span>
                      <span className="block font-mono text-xs text-slate-300 truncate group-hover:text-emerald-300">
                        {dynamic.url}
                      </span>
                    </div>
                    <span className="text-slate-400 group-hover:text-emerald-400 transition-colors text-sm shrink-0">
                      ↗
                    </span>
                  </a>

                  <div className="flex gap-2">
                    <a
                      href={dynamic.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-2.5 text-xs font-bold transition-all shadow-md shadow-emerald-500/20 active:scale-[0.98]"
                    >
                      Open Pay (₹{dynamic.amount}) ↗
                    </a>
                    <button
                      onClick={() => copyLink(dynamic.url, "dynamic")}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-600 bg-slate-700/70 hover:border-slate-400 px-3.5 py-2.5 text-xs font-medium text-slate-200 transition-all active:scale-[0.98]"
                    >
                      {copied === "dynamic" ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                  <button
                    onClick={() => setDynamic(null)}
                    className="w-full rounded-xl border border-slate-700 hover:border-slate-500 py-1.5 text-xs text-slate-400 transition-colors"
                  >
                    Clear Dynamic QR
                  </button>
                </div>
              </>
            ) : (
              <div className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600 p-4 text-center">
                <span className="text-2xl mb-1">🔢</span>
                <p className="text-sm font-medium text-slate-300">Enter amount on Keypad</p>
                <p className="text-xs text-slate-500 mt-1">Press OK to generate a locked QR code</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Amount is verified &amp; locked server-side.
          </p>
        </section>

        {/* 3) Back Panel Keypad */}
        <section className="rounded-3xl border border-slate-700 bg-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-200">Back · Keypad</h2>
              <span className="rounded bg-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                Merchant Panel
              </span>
            </div>
            <div className="mb-3 rounded-2xl bg-slate-900 border border-slate-700/80 px-4 py-3 text-right text-3xl font-mono text-emerald-400 font-bold shadow-inner">
              ₹{entry || "0"}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  className="rounded-xl bg-slate-700/80 hover:bg-slate-700 py-3 text-xl font-bold text-slate-100 active:bg-slate-600 transition-all active:scale-95 shadow-sm"
                >
                  {k}
                </button>
              ))}
              <button
                onClick={() => setEntry("")}
                className="rounded-xl bg-slate-700/80 hover:bg-slate-700 py-3 font-bold text-red-300 active:bg-slate-600 transition-all active:scale-95 shadow-sm"
              >
                C
              </button>
              <button
                onClick={confirmAmount}
                className="col-span-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-3 text-lg font-black text-slate-900 active:bg-emerald-300 transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
              >
                OK
              </button>
            </div>
            <button
              onClick={listen}
              disabled={!last}
              className="mt-3.5 w-full flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-700/60 hover:bg-slate-700 py-2.5 font-bold text-sm text-slate-200 disabled:opacity-40 transition-all active:scale-[0.98]"
            >
              🔊 Replay Last Announcement
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Replays dual-tone chime + voice + promo.
          </p>
        </section>
      </div>

      {!voiceOk && (
        <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          No {lang === "hi" ? "Hindi" : "English (India)"} voice found on this device. Install one in OS
          speech settings, or use Chrome on Android for native regional speech.
        </p>
      )}

      {/* Last Announcement Banner */}
      {last && (
        <section className="mt-5 rounded-3xl border border-emerald-500/50 bg-gradient-to-r from-emerald-950/40 via-slate-800 to-slate-800 p-5 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-emerald-400">
              Latest Live Broadcast
            </span>
            <span className="text-xs text-slate-400">
              {new Date(last.ts).toLocaleTimeString()}
            </span>
          </div>
          <p className="mt-1 text-3xl font-extrabold text-emerald-400">
            ₹{last.amount} Received Successfully
          </p>
          {adsOn && (
            <div className="mt-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2">
              <span className="text-xs font-semibold text-amber-300">📢 Store Promo Broadcast:</span>
              <p className="text-sm text-amber-100">{last.ad[lang]}</p>
            </div>
          )}
        </section>
      )}

      {/* Transaction History Feed */}
      <section className="mt-5 rounded-3xl border border-slate-700 bg-slate-800 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-200">Real-Time Payment Feed</h2>
          <span className="text-xs text-slate-400">
            {history.length} {history.length === 1 ? "transaction" : "transactions"}
          </span>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            No payments received yet. Click an <strong>Investor 1-Click Demo</strong> button above or scan the QR code to simulate!
          </p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {history.map((p) => (
              <li key={p.txn_id} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-lg font-bold text-emerald-400">₹{p.amount}</span>
                  <span className="ml-2 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                    Paid via UPI
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-slate-300">{p.txn_id}</p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(p.ts).toLocaleTimeString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
