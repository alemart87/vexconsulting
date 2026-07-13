"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch, downloadFile, formatDate, getUser } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject();
  const me = getUser();
  const [doc, setDoc] = useState<any>(null);
  const [exporting, setExporting] = useState("");

  // ---- 📰 Crear Paper: publicación ligera de marca (LinkedIn, clientes) ----
  const [paperOpen, setPaperOpen] = useState(false);
  const [pNombre, setPNombre] = useState("");
  const [pTitulo, setPTitulo] = useState("");
  const [pSubtitulo, setPSubtitulo] = useState("");
  const [pAutor, setPAutor] = useState("");
  const [pCargo, setPCargo] = useState("");
  const [pFoto, setPFoto] = useState<{ name: string; preview: string } | null>(null);
  const [pLogoMode, setPLogoMode] = useState<"voicenter" | "custom">("voicenter");
  const [pLogo, setPLogo] = useState<{ name: string; preview: string } | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState("");
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<any>(`/api/v1/projects/${params.id}/document`).then(setDoc).catch(() => {});
  }, [params.id]);

  const openPaperDialog = () => {
    setPNombre((n) => n || project?.name || "paper");
    setPTitulo((t) => t || project?.name || "");
    setPAutor((a) => a || me?.full_name || "");
    setPaperOpen(true);
  };

  const uploadAsset = async (file: File, kind: "foto" | "logo") => {
    setUploadingAsset(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch<{ name: string }>(
        `/api/v1/projects/${params.id}/exports/paper-asset`,
        { method: "POST", body: form }
      );
      const preview = URL.createObjectURL(file);
      if (kind === "foto") setPFoto({ name: res.name, preview });
      else {
        setPLogo({ name: res.name, preview });
        setPLogoMode("custom");
      }
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploadingAsset("");
    }
  };

  const runExportJob = async (format: string, body: any, filename: string) => {
    setExporting(format);
    try {
      const job = await apiFetch<any>(`/api/v1/projects/${params.id}/exports`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await apiFetch<any>(`/api/v1/projects/${params.id}/exports/${job.id}`);
        if (st.status === "done") {
          await downloadFile(
            `/api/v1/projects/${params.id}/exports/${job.id}/download`,
            filename
          );
          return true;
        }
        if (st.status === "failed") {
          alert(st.last_error || "La exportación falló");
          return false;
        }
      }
      return false;
    } catch (e: any) {
      alert(e.message);
      return false;
    } finally {
      setExporting("");
    }
  };

  const exportDoc = (format: "docx" | "pdf") =>
    runExportJob(format, { format }, `${project?.name ?? "documento"}.${format}`);

  const createPaper = async () => {
    if (!pTitulo.trim()) return;
    const ok = await runExportJob(
      "paper",
      {
        format: "paper",
        options: {
          nombre: pNombre.trim() || pTitulo.trim(),
          titulo: pTitulo.trim(),
          subtitulo: pSubtitulo.trim(),
          autor: pAutor.trim(),
          cargo: pCargo.trim(),
          foto: pFoto?.name || "",
          logo: pLogoMode === "custom" && pLogo ? pLogo.name : "voicenter",
        },
      },
      `${pNombre.trim() || pTitulo.trim()}.pdf`
    );
    if (ok) setPaperOpen(false);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap print:hidden">
        <div className="text-xs text-brand-slate">
          Vista previa del documento maestro ·{" "}
          {(doc?.word_count ?? 0).toLocaleString("es-PY")} palabras · actualizado{" "}
          {formatDate(doc?.updated_at)}
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
            onClick={() => exportDoc("docx")}>
            {exporting === "docx" ? "Generando…" : "⬇ Word"}
          </button>
          <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
            onClick={() => exportDoc("pdf")}>
            {exporting === "pdf" ? "Generando…" : "⬇ PDF informe"}
          </button>
          <button
            className="btn !py-1.5 text-xs text-white bg-gradient-to-r from-brand-purple to-brand-cyan hover:opacity-90"
            disabled={!!exporting}
            onClick={openPaperDialog}
            title="Publicación ligera con diseño de marca: portada con logo, título y autor con foto — ideal para LinkedIn o compartir con clientes"
          >
            📰 Crear Paper
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => window.print()}>
            🖨 Imprimir / PDF del navegador
          </button>
        </div>
      </div>

      {/* ---- Diálogo Crear Paper ---- */}
      {paperOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 print:hidden animate-fade"
          onClick={(e) => e.target === e.currentTarget && setPaperOpen(false)}>
          <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto animate-pop">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display uppercase text-brand-ink text-lg">📰 Crear Paper</h3>
                <p className="text-xs text-brand-slate mt-0.5">
                  Publicación ligera del documento con diseño de marca — sin normas APA ni
                  índice. Ideal para LinkedIn o compartir con clientes.
                </p>
              </div>
              <button className="text-brand-slate hover:text-brand-primary text-lg leading-none"
                onClick={() => setPaperOpen(false)}>✕</button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label">Título del paper</label>
                <input className="input w-full font-semibold" maxLength={200}
                  value={pTitulo} onChange={(e) => setPTitulo(e.target.value)}
                  placeholder="Ej.: El futuro del contact center en Paraguay" />
              </div>
              <div>
                <label className="label">Subtítulo (opcional)</label>
                <input className="input w-full text-sm" maxLength={300}
                  value={pSubtitulo} onChange={(e) => setPSubtitulo(e.target.value)}
                  placeholder="Una línea que resume el hallazgo principal" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Autor</label>
                  <input className="input w-full text-sm" maxLength={120}
                    value={pAutor} onChange={(e) => setPAutor(e.target.value)} />
                </div>
                <div>
                  <label className="label">Cargo (opcional)</label>
                  <input className="input w-full text-sm" maxLength={120}
                    value={pCargo} onChange={(e) => setPCargo(e.target.value)}
                    placeholder="Ej.: Consultor senior · Voicenter" />
                </div>
              </div>

              {/* Foto del autor */}
              <div>
                <label className="label">Foto del autor (va abajo, en la portada)</label>
                <div className="flex items-center gap-3">
                  {pFoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pFoto.preview} alt="autor"
                      className="h-14 w-14 rounded-full object-cover border-2 border-brand-border" />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-brand-purple text-white flex items-center justify-center font-bold text-lg">
                      {(pAutor || "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button className="btn-ghost !py-1.5 text-xs" disabled={!!uploadingAsset}
                      onClick={() => fotoInputRef.current?.click()}>
                      {uploadingAsset === "foto" ? "Subiendo…" : pFoto ? "Cambiar foto" : "Subir foto"}
                    </button>
                    {pFoto && (
                      <button className="btn-ghost !py-1.5 text-xs" onClick={() => setPFoto(null)}>
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
                <input ref={fotoInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAsset(f, "foto");
                    e.currentTarget.value = "";
                  }} />
              </div>

              {/* Logo */}
              <div>
                <label className="label">Logo de la portada</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className={`text-xs px-3 py-2 rounded-md border font-semibold transition-colors flex items-center gap-2 ${
                      pLogoMode === "voicenter"
                        ? "border-brand-cyan bg-brand-cyan/10 text-brand-ink"
                        : "border-brand-border text-brand-slate hover:border-brand-cyan"
                    }`}
                    onClick={() => setPLogoMode("voicenter")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-voicenter-color.png" alt="Voicenter" className="h-5" />
                    Voicenter
                  </button>
                  <button
                    className={`text-xs px-3 py-2 rounded-md border font-semibold transition-colors flex items-center gap-2 ${
                      pLogoMode === "custom"
                        ? "border-brand-cyan bg-brand-cyan/10 text-brand-ink"
                        : "border-brand-border text-brand-slate hover:border-brand-cyan"
                    }`}
                    onClick={() => (pLogo ? setPLogoMode("custom") : logoInputRef.current?.click())}
                  >
                    {pLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pLogo.preview} alt="logo" className="h-5 max-w-[80px] object-contain" />
                    ) : (
                      <span>🖼</span>
                    )}
                    {uploadingAsset === "logo" ? "Subiendo…" : "Personalizado"}
                  </button>
                  {pLogoMode === "custom" && pLogo && (
                    <button className="btn-ghost !py-1.5 text-xs"
                      onClick={() => logoInputRef.current?.click()}>
                      Cambiar
                    </button>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAsset(f, "logo");
                    e.currentTarget.value = "";
                  }} />
              </div>

              <div>
                <label className="label">Nombre del archivo</label>
                <div className="flex items-center gap-1.5">
                  <input className="input flex-1 text-sm" maxLength={80}
                    value={pNombre} onChange={(e) => setPNombre(e.target.value)} />
                  <span className="text-xs text-brand-slate shrink-0">.pdf</span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost !py-2 text-xs" onClick={() => setPaperOpen(false)}>
                Cancelar
              </button>
              <button className="btn-primary !py-2 text-xs"
                disabled={!pTitulo.trim() || !!exporting || !!uploadingAsset}
                onClick={createPaper}>
                {exporting === "paper" ? "Generando el paper…" : "📰 Crear Paper"}
              </button>
            </div>
          </div>
        </div>
      )}

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
