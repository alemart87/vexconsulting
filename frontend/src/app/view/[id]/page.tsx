"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Brand from "@/components/Brand";
import AgentChat from "@/components/agent/AgentChat";
import { apiFetch, clearSession, downloadFile, formatDate, getToken } from "@/lib/api";

export default function ViewerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [exporting, setExporting] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    apiFetch<any>(`/api/v1/projects/${params.id}`).then(setProject).catch((e) => setError(e.message));
    apiFetch<any>(`/api/v1/projects/${params.id}/document/published`)
      .then(setDoc)
      .catch((e) => setError(e.message));
  }, [params.id, router]);

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
            `${project?.name ?? "informe"}.${format}`
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

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white border-b border-brand-border shadow-soft">
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-3">
          <Brand />
          <div className="flex items-center gap-2">
            <a href="/metodo" className="btn-ghost !py-1.5 text-xs">
              Método y fuentes
            </a>
            <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
              onClick={() => exportDoc("docx")}>
              {exporting === "docx" ? "Generando…" : "⬇ Word"}
            </button>
            <button className="btn-secondary !py-1.5 text-xs" disabled={!!exporting}
              onClick={() => exportDoc("pdf")}>
              {exporting === "pdf" ? "Generando…" : "⬇ PDF"}
            </button>
            <button className="btn-primary !py-1.5 text-xs" onClick={() => setChatOpen((v) => !v)}>
              {chatOpen ? "Cerrar asistente" : "💬 Asistente IA"}
            </button>
            <button className="btn-ghost text-xs" onClick={() => { clearSession(); router.push("/login"); }}>
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className={`mx-auto max-w-6xl px-4 py-8 grid gap-6 ${chatOpen ? "lg:grid-cols-2" : ""}`}>
        <article>
          {error && <div className="card p-6 text-brand-primary-dark">{error}</div>}
          {doc && (
            <>
              <div className="mb-4 text-xs text-brand-slate">
                {project?.name} · versión {doc.version_number} · publicado{" "}
                {formatDate(project?.published_at)}
              </div>
              <div className="card p-8 prose-vex">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content_md}</ReactMarkdown>
              </div>
            </>
          )}
        </article>
        {chatOpen && (
          <aside className="lg:sticky lg:top-20 h-fit">
            <AgentChat projectId={params.id} viewerMode />
          </aside>
        )}
      </main>
    </div>
  );
}
