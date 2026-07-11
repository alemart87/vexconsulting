"use client";

import { useCallback, useEffect, useState } from "react";

export interface TourStep {
  /** Selector CSS del elemento a destacar; sin target = tarjeta centrada. */
  target?: string;
  title: string;
  body: string;
}

/** Visita guiada con foco (spotlight): oscurece la pantalla y recorta el
 *  elemento destacado, con una tarjeta que explica qué apretar y por qué. */
export default function GuidedTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    if (!step?.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target) as HTMLElement | null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    if (!step) return;
    if (step.target) {
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (!el) {
        // El elemento no está en pantalla (p. ej. banner cerrado): saltar paso
        if (i < steps.length - 1) setI((v) => v + 1);
        else onClose();
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const timer = setTimeout(measure, 380);
      window.addEventListener("resize", measure);
      window.addEventListener("scroll", measure, true);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", measure, true);
      };
    }
    setRect(null);
  }, [i, step, steps.length, measure, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && i < steps.length - 1) setI(i + 1);
      if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, steps.length, onClose]);

  if (!step) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cardW = Math.min(360, vw - 24);

  // Posición de la tarjeta: debajo del foco si entra, si no encima; centrada sin foco
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 240 < vh;
    const left = Math.min(Math.max(rect.left, 12), vw - cardW - 12);
    cardStyle = below
      ? { top: rect.bottom + 14, left, width: cardW }
      : { bottom: vh - rect.top + 14, left, width: cardW };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: cardW };
  }

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true">
      {/* Fondo oscuro; el recorte del foco lo hace el box-shadow del spotlight */}
      {rect ? (
        <div
          className="absolute rounded-xl border-2 border-brand-primary transition-all duration-300 pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(15, 17, 22, 0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-brand-ink/75" />
      )}

      {/* Tarjeta del paso */}
      <div
        className="absolute card shadow-elevated p-5 animate-pop"
        style={cardStyle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider2 font-bold text-brand-primary">
            Visita guiada · {i + 1} de {steps.length}
          </span>
          <button
            className="text-brand-slate hover:text-brand-ink text-sm leading-none"
            onClick={onClose}
            aria-label="Cerrar guía"
          >
            ✕
          </button>
        </div>
        <div className="font-display text-lg uppercase text-brand-ink leading-tight">
          {step.title}
        </div>
        <p className="text-sm text-brand-graphite leading-relaxed mt-1.5">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          {/* Progreso */}
          <div className="flex gap-1">
            {steps.map((_, j) => (
              <span
                key={j}
                className={`h-1.5 rounded-full transition-all ${
                  j === i ? "w-5 bg-brand-primary" : "w-1.5 bg-brand-border"
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => setI(i - 1)}>
                ← Anterior
              </button>
            )}
            {i < steps.length - 1 ? (
              <button className="btn-primary !py-1.5 !px-4 text-xs" onClick={() => setI(i + 1)}>
                Siguiente →
              </button>
            ) : (
              <button className="btn-primary !py-1.5 !px-4 text-xs" onClick={onClose}>
                ✓ Entendido
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
