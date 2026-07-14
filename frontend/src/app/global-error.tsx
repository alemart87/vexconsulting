"use client";

/** Último recurso: error en el layout raíz. HTML mínimo autónomo. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#F6F7FB" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, maxWidth: 420, textAlign: "center", boxShadow: "0 8px 30px rgba(15,17,22,.12)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ margin: 0, color: "#0F1116", textTransform: "uppercase" }}>La aplicación falló</h2>
            <p style={{ color: "#5B6275", fontSize: 14, lineHeight: 1.6 }}>
              Recargá para seguir trabajando. Detalle: {error.message?.slice(0, 120) || "desconocido"}
            </p>
            <button
              onClick={() => (reset ? reset() : window.location.reload())}
              style={{ background: "#E6332A", color: "#fff", border: 0, borderRadius: 10, padding: "10px 22px", fontWeight: 700, cursor: "pointer", marginTop: 12 }}
            >
              ↻ Recargar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
