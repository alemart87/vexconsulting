"use client";

import { useState } from "react";
import Link from "next/link";
import { CATEGORY_LABEL, STATUS_LABEL, gs, gsCompact } from "@/lib/finanzas";

/** Botón circular de descarga (rojo corporativo, con halo animado) para las
 *  esquinas de las tarjetas: llama la atención sin tapar el contenido. */
export function DownloadButton({
  onClick,
  title = "Descargar Excel",
  // Posición: «relative» en flujo, o «absolute top-3 right-3» en una esquina.
  // (No se fija acá para que la clase pasada no compita con ella en el CSS.)
  className = "relative",
  label,
}: {
  onClick: () => Promise<void> | void;
  title?: string;
  className?: string;
  /** Con etiqueta se vuelve una píldora («⬇ Descargar IPS») en vez del círculo. */
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  if (label) {
    return (
      <button
        type="button"
        title={title}
        disabled={busy}
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          try {
            await onClick();
          } finally {
            setBusy(false);
          }
        }}
        className={`group h-8 pl-2.5 pr-3 rounded-full bg-brand-primary text-white text-xs font-semibold shadow-elevated ring-2 ring-brand-primary/25 inline-flex items-center gap-1.5 whitespace-nowrap transition-transform hover:scale-105 hover:bg-brand-primary-dark disabled:opacity-60 ${className}`}
      >
        {busy ? (
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
        )}
        <span className="relative">{busy ? "Generando…" : label}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      className={`group h-8 w-8 rounded-full bg-brand-primary text-white shadow-soft flex items-center justify-center transition-transform hover:scale-110 hover:bg-brand-primary-dark disabled:opacity-60 ${className}`}
    >
      {/* Halo que respira para atraer la mirada; se apaga al pasar el mouse */}
      <span className="absolute inset-0 rounded-full ring-2 ring-brand-primary/40 animate-ping group-hover:hidden" aria-hidden style={{ animationDuration: "2.4s" }} />
      {busy ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M4 19h16" />
        </svg>
      )}
    </button>
  );
}

/** Tarjeta de indicador: número grande + etiqueta + pista opcional. */
export function StatTile({
  label,
  value,
  hint,
  accent,
  full,
  onDownload,
  downloadTitle,
  downloadLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  /** Mostrar el valor completo en el title (para montos compactados). */
  full?: string;
  /** Botón de descarga en la esquina superior derecha. */
  onDownload?: () => Promise<void> | void;
  downloadTitle?: string;
  /** Con etiqueta, el botón es una píldora con texto (p. ej. «Descargar IPS»). */
  downloadLabel?: string;
}) {
  return (
    <div className="card p-4 min-w-0 relative">
      {onDownload && (
        <DownloadButton onClick={onDownload} title={downloadTitle} label={downloadLabel} className="absolute top-3 right-3" />
      )}
      <div className={`text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold leading-snug ${onDownload ? (downloadLabel ? "pr-36" : "pr-9") : ""}`}>
        {label}
      </div>
      <div
        className="font-display text-2xl xl:text-3xl text-brand-ink leading-tight mt-1 whitespace-nowrap"
        style={accent ? { borderLeft: `4px solid ${accent}`, paddingLeft: 10 } : undefined}
        title={full}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-brand-slate mt-1 leading-snug">{hint}</div>}
    </div>
  );
}

export function Money({ n, compact = false }: { n: number | null | undefined; compact?: boolean }) {
  return (
    <span className="tabular-nums whitespace-nowrap" title={compact ? gs(n) : undefined}>
      {compact ? gsCompact(n) : gs(n)}
    </span>
  );
}

export function CategoryBadge({ category, egreso }: { category: string; egreso?: boolean }) {
  const cls =
    category === "mensualero"
      ? "bg-[#E0F4F6] text-[#005F68]"
      : category === "jornalero"
        ? "bg-[#EFE5F5] text-[#4E2565]"
        : "bg-brand-bg text-brand-slate";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`badge ${cls}`}>{CATEGORY_LABEL[category] ?? category}</span>
      {egreso && <span className="badge bg-brand-primary-light text-brand-primary-dark">Egreso</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "done"
      ? "badge-success"
      : status === "failed"
        ? "badge-primary"
        : status === "running" || status === "queued"
          ? "badge-cyan"
          : "badge-neutral";
  return <span className={cls}>{STATUS_LABEL[status] ?? status}</span>;
}

export function AccountTypeBadge({ type }: { type: string }) {
  const map: Record<string, [string, string]> = {
    gasto: ["Gasto", "bg-brand-primary-light text-brand-primary-dark"],
    pasivo: ["Pasivo", "bg-[#E0F4F6] text-[#005F68]"],
    activo: ["Descuento", "bg-brand-orange/15 text-[#8A5200]"],
    otro: ["Otro", "bg-brand-bg text-brand-slate"],
  };
  const [label, cls] = map[type] ?? map.otro;
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** Fila de filtros compactos sobre una tabla. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2 mb-3">{children}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-display text-xl uppercase text-brand-ink">{title}</p>
      {body && <p className="text-sm text-brand-slate mt-2 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-xs text-brand-slate hover:text-brand-primary inline-flex items-center gap-1 mb-3">
      ← {label}
    </Link>
  );
}

/** Barra de proporción (para “participación” en tablas): ancho = share. */
export function ShareBar({ share, color = "#0093A0" }: { share: number; color?: string }) {
  return (
    <div className="h-1.5 w-full bg-brand-bg rounded overflow-hidden" aria-hidden>
      <div className="h-full rounded" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
    </div>
  );
}

/** Contenedor de tabla con cabecera pegajosa y scroll horizontal en móvil. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm min-w-[640px]">{children}</table>
    </div>
  );
}

export const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider2 text-brand-slate bg-brand-bg-soft sticky top-0";
export const thNum = `${th} text-right`;
export const td = "px-3 py-2 border-t border-brand-border align-top";
export const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;
