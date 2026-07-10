"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, downloadFile, formatDate } from "@/lib/api";
import { useProject } from "@/components/ProjectContext";

export default function ProjectOverview() {
  const params = useParams<{ id: string }>();
  const { project, reload } = useProject();
  const [versions, setVersions] = useState<any[]>([]);
  const [doc, setDoc] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState("");

  const exportDoc = async (format: "docx" | "pdf") => {
    setExporting(format);
    try {
      const job = await apiFetch<any>(`/api/v1/projects/${params.id}/exports`, {
        method: "POST",
        body: JSON.stringify({ format }),
      });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await apiFetch<any>(`/api/v1/projects/${params.id}/exports/${job.id}`);
        if (st.status === "done") {
          await downloadFile(
            `/api/v1/projects/${params.id}/exports/${job.id}/download`,
            `${project?.name ?? "documento"}.${format}`
          );
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

  useEffect(() => {
    apiFetch<any[]>(`/api/v1/projects/${params.id}/versions`).then(setVersions).catch(() => {});
    apiFetch<any>(`/api/v1/projects/${params.id}/document`).then(setDoc).catch(() => {});
  }, [params.id]);

  const isAdmin = project?.my_permission === "admin";

  const togglePublish = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const action = project.status === "publicado" ? "unpublish" : "publish";
      await apiFetch(`/api/v1/projects/${params.id}/${action}`, { method: "POST" });
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-6">
          <h2 className="label mb-3">Documento maestro</h2>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="font-display text-4xl text-brand-ink">
                {(doc?.word_count ?? 0).toLocaleString("es-PY")}
              </div>
              <div className="text-xs text-brand-slate">palabras · {versions.length} versiones</div>
            </div>
            <Link href={`/projects/${params.id}/document`} className="btn-primary">
              Abrir editor
            </Link>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="label mb-3">Últimas versiones</h2>
          {versions.length === 0 ? (
            <p className="text-sm text-brand-slate">Sin versiones guardadas todavía.</p>
          ) : (
            <ul className="divide-y divide-brand-border">
              {versions.slice(0, 5).map((v) => (
                <li key={v.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold text-brand-ink">v{v.version_number}</span>
                    <span className="text-brand-slate"> · {v.author_name}</span>
                    {v.summary && <span className="text-brand-slate"> · “{v.summary}”</span>}
                  </div>
                  <span className="text-xs text-brand-mist">{formatDate(v.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {isAdmin && (
          <div className="card p-6">
            <h2 className="label mb-3">Publicación</h2>
            <p className="text-xs text-brand-slate mb-4">
              {project?.status === "publicado"
                ? "El proyecto está publicado: los visualizadores ven la versión congelada."
                : "En borrador: los visualizadores no tienen acceso."}
            </p>
            <button
              onClick={togglePublish}
              disabled={busy}
              className={project?.status === "publicado" ? "btn-secondary w-full" : "btn-primary w-full"}
            >
              {project?.status === "publicado" ? "Volver a borrador" : "Publicar proyecto"}
            </button>
          </div>
        )}
        <div className="card p-6">
          <h2 className="label mb-3">Exportar documento</h2>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" disabled={!!exporting}
              onClick={() => exportDoc("docx")}>
              {exporting === "docx" ? "Generando…" : "⬇ Word"}
            </button>
            <button className="btn-secondary flex-1" disabled={!!exporting}
              onClick={() => exportDoc("pdf")}>
              {exporting === "pdf" ? "Generando…" : "⬇ PDF"}
            </button>
          </div>
        </div>
        <div className="card p-6">
          <h2 className="label mb-3">Accesos rápidos</h2>
          <div className="flex flex-col gap-2">
            <Link href={`/projects/${params.id}/sources`} className="btn-secondary">
              Fuentes de investigación
            </Link>
            <Link href={`/projects/${params.id}/agent`} className="btn-secondary">
              Agente IA
            </Link>
            <Link href={`/projects/${params.id}/document/versions`} className="btn-secondary">
              Historial de versiones
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
