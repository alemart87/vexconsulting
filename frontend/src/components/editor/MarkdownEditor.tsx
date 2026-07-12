"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import LinkExt from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { apiFetch } from "@/lib/api";

interface Props {
  projectId: string;
  initialMarkdown: string;
  editable: boolean;
  onDirty?: (dirty: boolean) => void;
  onRequestAi?: (contextText: string, insert: (text: string) => void) => void;
  /** Conteo de palabras en vivo (debounced) — para la barra de estado. */
  onStats?: (stats: { words: number; chars: number }) => void;
  /** Modo enfoque: tipografía más grande y cómoda para escribir largo. */
  zen?: boolean;
}

export interface EditorHandle {
  getMarkdown: () => string;
  /** Reemplaza TODO el contenido (recuperación de borradores). Marca dirty. */
  setMarkdown: (md: string) => void;
  /** Selección actual o texto anterior al cursor (contexto para la IA) + ancla de inserción. */
  getContextInfo: () => { context: string; anchor: number };
  /** Inserta Markdown en la última posición del cursor (con salto de párrafo). */
  insertAtCursor: (text: string) => void;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded text-sm font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? "bg-brand-primary text-white" : "text-brand-slate hover:bg-brand-bg"
      }`}
    >
      {children}
    </button>
  );
}

export default function MarkdownEditor({
  projectId,
  initialMarkdown,
  editable,
  onDirty,
  onRequestAi,
  onStats,
  zen,
  editorRef,
}: Props & { editorRef?: React.MutableRefObject<EditorHandle | null> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Foco real del editor: los estados activos (H1, lista, enlace…) solo se
  // muestran con el cursor adentro — si no, quedan «prendidos» tras el blur.
  const [focused, setFocused] = useState(false);

  // Preferencias de lectura/escritura (Aa): fuente, tamaño e interlineado.
  // Solo afectan la vista del editor — el export mantiene el estilo de marca.
  interface Prefs {
    font: "sans" | "serif" | "mono";
    size: number;
    leading: number;
  }
  const DEFAULT_PREFS: Prefs = { font: "sans", size: 15, leading: 1.65 };
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vex_editor_prefs");
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const updatePrefs = (patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem("vex_editor_prefs", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const FONT_FAMILIES: Record<Prefs["font"], string> = {
    sans: '"Manrope", system-ui, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Cascadia Code", Consolas, monospace',
  };
  const prefsCustom =
    prefs.font !== DEFAULT_PREFS.font ||
    prefs.size !== DEFAULT_PREFS.size ||
    prefs.leading !== DEFAULT_PREFS.leading;

  const emitStats = useCallback(
    (ed: any) => {
      if (!onStats) return;
      if (statsTimer.current) clearTimeout(statsTimer.current);
      statsTimer.current = setTimeout(() => {
        const text: string = ed?.state?.doc?.textContent ?? "";
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        onStats({ words, chars: text.length });
      }, 400);
    },
    [onStats]
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: {} }),
      Image.configure({ inline: false }),
      LinkExt.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Escribí el documento maestro…" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: initialMarkdown,
    onCreate: ({ editor: ed }) => emitStats(ed),
    onUpdate: ({ editor: ed }) => {
      onDirty?.(true);
      emitStats(ed);
    },
  });

  useEffect(() => () => {
    if (statsTimer.current) clearTimeout(statsTimer.current);
  }, []);

  useEffect(() => {
    if (editorRef) {
      editorRef.current = {
        getMarkdown: () => (editor?.storage as any)?.markdown?.getMarkdown() ?? "",
        setMarkdown: (md: string) => {
          editor?.commands.setContent(md);
          onDirty?.(true);
        },
        getContextInfo: () => {
          if (!editor) return { context: "", anchor: 0 };
          const { from, to } = editor.state.selection;
          const selected = editor.state.doc.textBetween(from, to, "\n");
          const before = editor.state.doc.textBetween(0, from, "\n");
          const md = (editor.storage as any)?.markdown?.getMarkdown() ?? "";
          return {
            context: selected || before.slice(-2500) || md.slice(0, 2500),
            anchor: to,
          };
        },
        insertAtCursor: (text: string) => {
          if (!editor) return;
          const pos = Math.min(editor.state.selection.to, editor.state.doc.content.size);
          editor.chain().focus().insertContentAt(pos, `\n\n${text}`).run();
        },
      };
    }
  }, [editor, editorRef]);

  useEffect(() => {
    // emitUpdate=false: cambiar la editabilidad NO es un cambio de contenido
    // (si no, marca «cambios sin guardar» apenas carga el documento).
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  const uploadImage = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await apiFetch<{ url: string }>(
          `/api/v1/projects/${projectId}/images`,
          { method: "POST", body: form }
        );
        editor?.chain().focus().setImage({ src: res.url, alt: file.name }).run();
      } catch (e: any) {
        alert(`No se pudo subir la imagen: ${e.message}`);
      } finally {
        setUploading(false);
      }
    },
    [editor, projectId]
  );

  const openLink = () => {
    if (!editor) return;
    setLinkUrl(editor.getAttributes("link").href || "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (url) {
      editor.chain().focus().setLink({ href: url.startsWith("http") ? url : `https://${url}` }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkOpen(false);
    setLinkUrl("");
  };

  if (!editor) return <div className="card p-10 text-center text-brand-slate">Cargando editor…</div>;

  return (
    // overflow-clip (NO overflow-hidden): hidden convierte la tarjeta en
    // contenedor de scroll y la barra sticky queda empujada 64px, tapando el título.
    <div className="card overflow-clip">
      {editable && (
        <div className="relative flex flex-wrap items-center gap-0.5 border-b border-brand-border bg-brand-bg-soft px-2 py-1.5 sticky top-[120px] z-20">
          <ToolbarButton title="Deshacer (Ctrl+Z)" disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
          <ToolbarButton title="Rehacer (Ctrl+Y)" disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Título 1 (Ctrl+Alt+1)" active={focused && editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
          <ToolbarButton title="Título 2 (Ctrl+Alt+2)" active={focused && editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
          <ToolbarButton title="Título 3 (Ctrl+Alt+3)" active={focused && editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Negrita (Ctrl+B)" active={focused && editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
          <ToolbarButton title="Cursiva (Ctrl+I)" active={focused && editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
          <ToolbarButton title="Tachado (Ctrl+Shift+S)" active={focused && editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
          <ToolbarButton title="Código (Ctrl+E)" active={focused && editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Lista (Ctrl+Shift+8)" active={focused && editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
          <ToolbarButton title="Lista numerada (Ctrl+Shift+7)" active={focused && editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
          <ToolbarButton title="Cita (Ctrl+Shift+B)" active={focused && editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolbarButton>
          <ToolbarButton title="Separador horizontal"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Tabla 3×3"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞</ToolbarButton>
          <ToolbarButton title="Insertar imagen" onClick={() => fileInput.current?.click()}>
            {uploading ? "…" : "🖼"}
          </ToolbarButton>
          <ToolbarButton title="Enlace (Ctrl+K)" active={focused && editor.isActive("link")} onClick={openLink}>
            🔗
          </ToolbarButton>
          <ToolbarButton title="Limpiar formato"
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>⌫</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton
            title="Tipografía: fuente, tamaño e interlineado (solo cambia tu vista del editor)"
            active={prefsOpen || prefsCustom}
            onClick={() => setPrefsOpen((v) => !v)}
          >
            Aa
          </ToolbarButton>
          {onRequestAi && (
            <>
              <span className="w-px h-5 bg-brand-border mx-1" />
              <ToolbarButton
                title="Asistente de IA: continuar, mejorar o expandir donde está el cursor"
                onClick={() => {
                  const md = (editor.storage as any).markdown.getMarkdown() as string;
                  const { from, to } = editor.state.selection;
                  const selected = editor.state.doc.textBetween(from, to, "\n");
                  // Contexto: la selección, o el texto ANTERIOR al cursor (no el final del doc)
                  const before = editor.state.doc.textBetween(0, from, "\n");
                  const context = selected || before.slice(-2500) || md.slice(0, 2500);
                  const anchor = to; // posición capturada AHORA: ahí se inserta
                  onRequestAi(context, (text) => {
                    const pos = Math.min(anchor, editor.state.doc.content.size);
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(pos, `\n\n${text}`)
                      .run();
                  });
                }}
              >
                ✨ IA
              </ToolbarButton>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
              e.currentTarget.value = "";
            }}
          />
          {/* Popover de tipografía (Aa): preferencias de vista, sin ocupar la barra */}
          {prefsOpen && (
            <div className="absolute top-full right-2 mt-1 w-72 glass rounded-xl p-3 z-30 animate-pop space-y-2.5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate mb-1">
                  Fuente
                </div>
                <div className="flex rounded-md border border-brand-border overflow-hidden bg-white/60">
                  {([
                    ["sans", "Manrope"],
                    ["serif", "Serif"],
                    ["mono", "Mono"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-colors ${
                        prefs.font === v ? "bg-brand-ink text-white" : "text-brand-graphite hover:bg-white"
                      }`}
                      style={{ fontFamily: FONT_FAMILIES[v] }}
                      onClick={() => updatePrefs({ font: v })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate mb-1">
                  Tamaño de letra
                </div>
                <div className="flex rounded-md border border-brand-border overflow-hidden bg-white/60">
                  {[13, 15, 17, 19].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`flex-1 px-2 py-1.5 text-xs font-semibold transition-colors ${
                        prefs.size === s ? "bg-brand-ink text-white" : "text-brand-graphite hover:bg-white"
                      }`}
                      onClick={() => updatePrefs({ size: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider2 text-brand-slate mb-1">
                  Interlineado
                </div>
                <div className="flex rounded-md border border-brand-border overflow-hidden bg-white/60">
                  {([
                    [1.45, "Compacto"],
                    [1.65, "Normal"],
                    [1.9, "Amplio"],
                    [2.2, "Doble"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={`flex-1 px-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        prefs.leading === v ? "bg-brand-ink text-white" : "text-brand-graphite hover:bg-white"
                      }`}
                      onClick={() => updatePrefs({ leading: v })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-brand-mist">
                  Solo cambia tu vista — el export mantiene el estilo corporativo.
                </span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-brand-primary hover:underline shrink-0 ml-2"
                  onClick={() => updatePrefs(DEFAULT_PREFS)}
                >
                  Restablecer
                </button>
              </div>
            </div>
          )}

          {/* Popover de enlace (reemplaza el prompt nativo) */}
          {linkOpen && (
            <div className="absolute top-full left-2 right-2 sm:left-auto sm:right-auto sm:w-80 mt-1 glass rounded-xl p-2 z-30 animate-pop flex gap-1.5">
              <input
                autoFocus
                className="input !py-1.5 text-xs flex-1"
                placeholder="https://…  (vacío = quitar enlace)"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  }
                  if (e.key === "Escape") setLinkOpen(false);
                }}
              />
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={applyLink}>OK</button>
              <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setLinkOpen(false)}>✕</button>
            </div>
          )}
        </div>
      )}
      <EditorContent
        editor={editor}
        className={`prose-vex tiptap min-h-[60vh] ${
          zen ? "px-8 sm:px-12 py-8 prose-zen" : "px-6 py-5"
        }`}
        style={
          prefsCustom
            ? {
                fontFamily: FONT_FAMILIES[prefs.font],
                fontSize: `${prefs.size}px`,
                lineHeight: prefs.leading,
              }
            : undefined
        }
      />
    </div>
  );
}
