"use client";

import Link from "next/link";

export default function Brand({ logoHeight = 36 }: { logoHeight?: number }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-voicenter-color.png"
        alt="Voicenter"
        style={{ height: logoHeight }}
      />
      <span className="hidden sm:block border-l border-brand-border pl-3">
        <span className="block font-display text-lg leading-tight uppercase text-brand-ink">
          VEX Consulting
        </span>
        <span className="block text-[10px] uppercase tracking-wider2 text-brand-slate">
          Plataforma de investigación · Voicenter S.A.
        </span>
      </span>
    </Link>
  );
}
