"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const [doc, setDoc] = useState<any>(null);
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    apiFetch<any>(`/api/v1/projects/${params.id}/document`).then(setDoc).catch(() => {});
  }, [params.id]);

  const exportDoc = async (format: "docx" | "pdf") => {
    setExporting(format);
    try {
      const job = await apiFetch<any>(`/api/v1/projects/${params.id}/exports`, {
        method: "POST",
        body: JSON.stringify({ format }),
      });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await apiFetch<any>(`/api/v1/projects/${params.id}/exports/${job.id}`);
        if (st.status === "done") {
          window.location.href = `/api/v1/projects/${params.id}/exports/${job.id}/download`;
          break;
        }
        if (st.status === "failed") {
          alert(st.last_error || "La exportación falló");
          break;
        }
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div className="text-xs text-brand-slate">
          Vista previa del documento maestro ·{" "}
          {(doc?.word_count ?? 0).toLocaleString("es-PY")} palabras · actualizado{" "}
          {formatDate(doc?.updated_at)}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
            onClick={() => exportDoc("docx")}>
            {exporting === "docx" ? "Generando…" : "⬇ Word"}
          </button>
          <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
            onClick={() => exportDoc("pdf")}>
            {exporting === "pdf" ? "Generando…" : "⬇ PDF"}
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => window.print()}>
            🖨 Imprimir / PDF del navegador
          </button>
        </div>
      </div>

      <article className="card p-8 md:p-12 prose-vex print:shadow-none print:border-0 print:p-0">
        {/* Membrete de impresión */}
        <div className="hidden print:flex items-center justify-between border-b-4 border-brand-primary pb-3 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-voicenter-color.png" alt="Voicenter" style={{ height: 32 }} />
          <div className="text-right text-xs text-brand-slate">
            <div className="font-semibold">{project?.name}</div>
            <div>VEX Consulting · Voicenter S.A.</div>
          </div>
        </div>
        {doc ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content_md || "*Documento vacío.*"}</ReactMarkdown>
        ) : (
          <p className="text-brand-slate">Cargando…</p>
        )}
      </article>
    </div>
  );
}
