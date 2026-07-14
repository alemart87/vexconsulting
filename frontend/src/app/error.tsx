"use client";

/** Barrera de errores: si una página crashea, la app NUNCA queda muerta —
 *  se muestra esta tarjeta con recuperación en un click. */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="font-display uppercase text-brand-ink text-xl">
          Algo falló en esta página
        </h2>
        <p className="text-sm text-brand-slate mt-2 leading-relaxed">
          El resto de la plataforma sigue funcionando. Probá recargar esta
          sección; si vuelve a pasar, avisá al administrador con este detalle:
        </p>
        <p className="text-[11px] text-brand-mist mt-2 font-mono break-all">
          {error.message?.slice(0, 160) || "error desconocido"}
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <button className="btn-primary !py-2 text-sm" onClick={reset}>
            ↻ Reintentar
          </button>
          <a href="/dashboard" className="btn-ghost !py-2 text-sm">
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
