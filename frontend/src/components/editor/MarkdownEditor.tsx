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
}

export interface EditorHandle {
  getMarkdown: () => string;
}

function ToolbarButton({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded text-sm font-semibold transition-colors ${
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
  editorRef,
}: Props & { editorRef?: React.MutableRefObject<EditorHandle | null> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
    onUpdate: () => onDirty?.(true),
  });

  useEffect(() => {
    if (editorRef) {
      editorRef.current = {
        getMarkdown: () => (editor?.storage as any)?.markdown?.getMarkdown() ?? "",
      };
    }
  }, [editor, editorRef]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

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

  if (!editor) return <div className="card p-10 text-center text-brand-slate">Cargando editor…</div>;

  return (
    <div className="card overflow-hidden">
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-brand-border bg-brand-bg-soft px-2 py-1.5 sticky top-16 z-30">
          <ToolbarButton title="Título 1" active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
          <ToolbarButton title="Título 2" active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
          <ToolbarButton title="Título 3" active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Negrita" active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolbarButton>
          <ToolbarButton title="Cursiva" active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
          <ToolbarButton title="Código" active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Lista" active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
          <ToolbarButton title="Lista numerada" active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
          <ToolbarButton title="Cita" active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</ToolbarButton>
          <span className="w-px h-5 bg-brand-border mx-1" />
          <ToolbarButton title="Tabla"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞</ToolbarButton>
          <ToolbarButton title="Insertar imagen" onClick={() => fileInput.current?.click()}>
            {uploading ? "…" : "🖼"}
          </ToolbarButton>
          <ToolbarButton title="Enlace" active={editor.isActive("link")}
            onClick={() => {
              const url = window.prompt("URL del enlace:");
              if (url) editor.chain().focus().setLink({ href: url }).run();
              else editor.chain().focus().unsetLink().run();
            }}>🔗</ToolbarButton>
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
        </div>
      )}
      <EditorContent editor={editor} className="prose-vex tiptap px-6 py-5 min-h-[60vh]" />
    </div>
  );
}
