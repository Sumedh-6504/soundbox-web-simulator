// Voice announcements via the browser's built-in speech synthesis.

export type Lang = "hi" | "en";
export type Ad = { id: string; en: string; hi: string };

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** "50 rupees", "50 rupees and 25 paise" in the chosen language. */
function spokenAmount(amount: number, lang: Lang): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (lang === "hi") return paise ? `${rupees} रुपये ${paise} पैसे` : `${rupees} रुपये`;
  return paise ? `${rupees} rupees and ${paise} paise` : `${rupees} rupees`;
}

/** Soundbox line: "Received 50 rupees". */
export function buildMessage(amount: number, lang: Lang): string {
  return lang === "hi" ? `${spokenAmount(amount, lang)} प्राप्त हुए` : `Received ${spokenAmount(amount, lang)}`;
}

/** Customer-side line: "Payment of 50 rupees successful". */
export function buildSuccessMessage(amount: number, lang: Lang): string {
  return lang === "hi"
    ? `${spokenAmount(amount, lang)} का भुगतान सफल रहा`
    : `Payment of ${spokenAmount(amount, lang)} successful`;
}

function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const target = locale.toLowerCase().replace("_", "-");
  const prefix = target.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase().replace("_", "-") === target) ??
    voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix))
  );
}

type SpeakingListener = (speaking: boolean) => void;
const speakingListeners = new Set<SpeakingListener>();

export function subscribeSpeaking(listener: SpeakingListener): () => void {
  speakingListeners.add(listener);
  return () => speakingListeners.delete(listener);
}

function notifySpeaking(isSpeaking: boolean) {
  speakingListeners.forEach((fn) => {
    try {
      fn(isSpeaking);
    } catch {}
  });
}

/** Melodic dual-tone UPI Soundbox chime synthesized via Web Audio API. */
export function playChime(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return resolve();
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") ctx.resume();

      const now = ctx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(659.25, now);
      osc1.frequency.exponentialRampToValueAtTime(830.61, now + 0.12);
      gain1.gain.setValueAtTime(0.28, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.32);

      // Note 2: B5 (987.77 Hz) to E6 (1318.5 Hz) cheerful ring
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(987.77, now + 0.14);
      osc2.frequency.exponentialRampToValueAtTime(1318.5, now + 0.26);
      gain2.gain.setValueAtTime(0.32, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.55);

      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
        resolve();
      }, 550);
    } catch {
      resolve();
    }
  });
}

// Module-level array holding active utterances to prevent Chrome garbage-collection bug
let activeUtterances: SpeechSynthesisUtterance[] = [];

function utterance(text: string, lang: Lang): SpeechSynthesisUtterance {
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale;
  const voice = pickVoice(locale);
  if (voice) u.voice = voice;
  return u;
}

/** Speaks the lines sequentially one after another with natural pacing. */
export function speakInOrder(lines: string[], lang: Lang): boolean {
  if (!supported() || lines.length === 0) return false;
  window.speechSynthesis.cancel();
  notifySpeaking(true);
  activeUtterances = [];

  const speakNext = (index: number) => {
    if (index >= lines.length) {
      activeUtterances = [];
      notifySpeaking(false);
      return;
    }

    const text = lines[index];
    const u = utterance(text, lang);
    activeUtterances.push(u);

    u.onend = () => {
      // Natural 350ms pause between payment confirmation and ad announcement
      setTimeout(() => speakNext(index + 1), 350);
    };
    u.onerror = () => {
      speakNext(index + 1);
    };

    window.speechSynthesis.speak(u);
  };

  // Small delay to ensure previous cancel completed cleanly
  setTimeout(() => speakNext(0), 60);
  return true;
}

/** Soundbox: payment chime -> voice announcement -> advertisement. Also used by Listen. */
export async function announcePayment(
  amount: number,
  lang: Lang,
  ad?: Ad | null,
  withAd = true
): Promise<boolean> {
  if (!supported()) return false;
  notifySpeaking(true);
  await playChime();
  const lines = [buildMessage(amount, lang)];
  if (withAd && ad && ad[lang]) lines.push(ad[lang]);
  return speakInOrder(lines, lang);
}

/** Customer phone: chime -> "Payment of X rupees successful" -> store advertisement. */
export async function announceSuccess(
  amount: number,
  lang: Lang,
  ad?: Ad | null,
  withAd = true
): Promise<boolean> {
  if (!supported()) return false;
  await playChime();
  const lines = [buildSuccessMessage(amount, lang)];
  if (withAd && ad && ad[lang]) lines.push(ad[lang]);
  return speakInOrder(lines, lang);
}

/** Browsers block audio until a user gesture: call this from a click handler once. */
export function unlockAudio() {
  if (!supported()) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function hasVoiceFor(lang: Lang): boolean {
  if (!supported()) return false;
  return !!pickVoice(lang === "hi" ? "hi-IN" : "en-IN");
}
