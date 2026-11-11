import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-5">
      <h1 className="text-3xl font-bold">Soundbox Simulator</h1>
      <p className="text-slate-400">
        Open the soundbox on one screen, then scan or pay from another device.
      </p>
      <Link
        href="/simulator"
        className="rounded-2xl bg-emerald-500 px-5 py-4 text-lg font-semibold text-slate-900 active:scale-[0.99]"
      >
        Soundbox (merchant) →
      </Link>
      <Link
        href="/scan"
        className="rounded-2xl border border-slate-600 px-5 py-4 text-lg font-semibold active:scale-[0.99]"
      >
        QR scanner (customer) →
      </Link>
    </main>
  );
}
