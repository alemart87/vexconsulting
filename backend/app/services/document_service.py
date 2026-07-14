"""Lógica del documento maestro: guardado con versionado, diff y lock blando."""
from __future__ import annotations

import difflib
import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser
from ..models.document import Document
from ..models.document_version import DocumentVersion

LOCK_TTL_SECONDS = 90

_WORD_RE = re.compile(r"\S+")


def strip_markdown(md: str) -> str:
    """Texto LEGIBLE del markdown: lo que un lector realmente lee.

    Sin esto, `## Título`, las barras de las tablas y las URLs de los enlaces
    contaban como «palabras» y el Resumen mostraba un número distinto al del
    editor (que cuenta sobre el texto renderizado)."""
    text = md or ""
    text = re.sub(r"```[^\n]*", " ", text)                     # marcas de código (el código queda)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)          # imágenes: no son texto
    text = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1", text)     # enlaces → solo el texto visible
    text = re.sub(r"<[^>\n]+>", " ", text)                     # tags html sueltos
    text = re.sub(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", " ", text, flags=re.M)  # separadores de tabla
    text = text.replace("|", " ")                              # barras de celdas
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.M)  # marcas de título
    text = re.sub(r"^\s*(?:[-*+]|\d+\.)\s+", "", text, flags=re.M)  # viñetas y numeración
    text = re.sub(r"^\s*>\s?", "", text, flags=re.M)           # citas en bloque
    text = re.sub(r"^\s*([-*_]\s?){3,}$", " ", text, flags=re.M)  # separadores ---
    text = re.sub(r"[*_~`]+", "", text)                        # énfasis
    return text


def count_words(text: str) -> int:
    """Palabras LEGIBLES (misma vara que el contador en vivo del editor)."""
    return len(_WORD_RE.findall(strip_markdown(text)))


def make_diff(old: str, new: str) -> str:
    lines = difflib.unified_diff(
        (old or "").splitlines(),
        (new or "").splitlines(),
        fromfile="anterior",
        tofile="nueva",
        lineterm="",
        n=2,
    )
    return "\n".join(lines)


def word_delta(old: str, new: str) -> tuple[int, int]:
    """Palabras agregadas/quitadas estimadas a partir del diff por líneas."""
    added = removed = 0
    for line in difflib.ndiff((old or "").splitlines(), (new or "").splitlines()):
        if line.startswith("+ "):
            added += count_words(line[2:])
        elif line.startswith("- "):
            removed += count_words(line[2:])
    return added, removed


def _now() -> datetime:
    return datetime.now(timezone.utc)


_BOLD_TITLE_RE = re.compile(r"^\*\*[^*]+\*\*[:.]?$")
_LIST_ITEM_RE = re.compile(r"^\s*([-*+]|\d+\.)\s")
# Entrada APA: «Autor, A. (2024).» — el año aparece temprano en la línea
_APA_START_RE = re.compile(r"^[^()\n]{0,120}\(\d{4}[a-z]?\)")
_LINKISH_RE = re.compile(r"(\]\()|(https?://)")


def _line_is_reference(s: str) -> bool:
    """¿Esta línea es una ENTRADA de referencia (se queda en Referencias) o
    contenido mal ubicado (se muda al cuerpo)?

    - ítems de lista = referencia (así se listan las fuentes)
    - «Autor (2024).» al inicio = referencia estilo APA
    - línea CORTA con enlace/URL = referencia
    - prosa larga —aunque traiga citas con link adentro—, tablas, imágenes,
      citas en bloque y títulos en negrita = contenido mal ubicado"""
    if s.startswith("|") or s.startswith(">") or s.startswith("!["):
        return False
    if _BOLD_TITLE_RE.fullmatch(s):
        return False
    if _LIST_ITEM_RE.match(s):
        return True
    if _APA_START_RE.match(s):
        return True
    return bool(_LINKISH_RE.search(s)) and len(s) <= 240


def _block_is_reference(block: list[str]) -> bool:
    """Un bloque es de referencias solo si TODAS sus líneas lo son."""
    nonempty = [l.strip() for l in block if l.strip()]
    if not nonempty:
        return True
    return all(_line_is_reference(line) for line in nonempty)


def _block_label(block: list[str]) -> str:
    """Etiqueta corta del bloque para informar qué se movió."""
    for line in block:
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^#{1,4}\s+(.*)$", s)
        if m:
            return m.group(1).strip()[:80]
        if s.startswith("|"):
            return "tabla"
        s = re.sub(r"[*_>#|]", "", s).strip()
        return (s[:60] + "…") if len(s) > 60 else s
    return "bloque"


def repair_structure(md: str) -> tuple[str, list[str]]:
    """Repara el ORDEN del documento de forma determinista (sin IA, sin tocar
    una letra del contenido): todo CONTENIDO que haya quedado dentro o después
    de las secciones terminales (Referencias, Anexos, Bibliografía…) se muda
    al final del CUERPO, justo antes de la primera terminal.

    Detecta tanto secciones con título (## / ###) como contenido suelto
    (párrafos, títulos en negrita, tablas, citas, imágenes) — que es como
    suele quedar cuando una integración salió mal. Las entradas de referencia
    reales (ítems con enlaces, párrafos APA con año) no se tocan.

    Devuelve (markdown_reparado, etiquetas_movidas)."""
    from .agent.integrator import _is_terminal_title

    lines = md.splitlines()

    def heading(line: str) -> re.Match | None:
        return re.match(r"^(#{1,4})\s+(.*)$", line.strip())

    # Primera sección terminal: ahí termina el cuerpo
    term_idx = None
    for i, line in enumerate(lines):
        m = heading(line)
        if m and _is_terminal_title(m.group(2)):
            term_idx = i
            break
    if term_idx is None:
        return md, []

    # Recorrer la región terminal por unidades: secciones con título completo,
    # o bloques separados por líneas en blanco, clasificados uno a uno.
    blocks: list[tuple[int, int, str]] = []  # (start, end, etiqueta)
    i = term_idx + 1
    while i < len(lines):
        if not lines[i].strip():
            i += 1
            continue
        m = heading(lines[i])
        if m:
            if _is_terminal_title(m.group(2)):
                i += 1
                continue
            # Sección con título no terminal: mal ubicada entera (hasta el
            # próximo encabezado del nivel que sea)
            j = i + 1
            while j < len(lines) and not heading(lines[j]):
                j += 1
            blocks.append((i, j, m.group(2).strip()[:80]))
            i = j
            continue
        # Bloque sin título: hasta la próxima línea en blanco o encabezado
        j = i
        while j < len(lines) and lines[j].strip() and not heading(lines[j]):
            j += 1
        block = lines[i:j]
        if not _block_is_reference(block):
            blocks.append((i, j, _block_label(block)))
        i = j

    if not blocks:
        return md, []

    moved_titles = [b[2] for b in blocks]
    extracted: list[list[str]] = []
    for start, end, _title in reversed(blocks):
        extracted.insert(0, lines[start:end])
        del lines[start:end]

    flat: list[str] = []
    for b in extracted:
        flat += ["", *b]
    flat.append("")
    lines[term_idx:term_idx] = flat

    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).rstrip() + "\n"
    return out, moved_titles


def _lock_active(doc: Document) -> bool:
    if not doc.lock_user_id or not doc.lock_expires_at:
        return False
    expires = doc.lock_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires > _now()


async def get_or_create_document(db: AsyncSession, project_id: str) -> Document:
    result = await db.execute(select(Document).where(Document.project_id == project_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        doc = Document(project_id=project_id, content_md="")
        db.add(doc)
        await db.commit()
        await db.refresh(doc)
    return doc


async def acquire_lock(db: AsyncSession, doc: Document, user: CurrentUser) -> Document:
    if _lock_active(doc) and doc.lock_user_id != user.id:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"El documento está siendo editado por {doc.lock_user_name or 'otro usuario'}",
        )
    doc.lock_user_id = user.id
    doc.lock_user_name = user.full_name
    doc.lock_expires_at = _now() + timedelta(seconds=LOCK_TTL_SECONDS)
    await db.commit()
    await db.refresh(doc)
    return doc


async def release_lock(db: AsyncSession, doc: Document, user: CurrentUser) -> None:
    if doc.lock_user_id == user.id or user.is_superadmin:
        doc.lock_user_id = None
        doc.lock_user_name = None
        doc.lock_expires_at = None
        await db.commit()


async def save_document(
    db: AsyncSession,
    doc: Document,
    user: CurrentUser,
    *,
    content_md: str,
    base_version_id: str | None,
    summary: str | None,
    force: bool,
) -> DocumentVersion:
    """Guarda el contenido creando SIEMPRE una versión nueva.

    Conflicto: si base_version_id no coincide con current_version_id y no es
    force, devuelve 409 — el cliente decide (ver diff / forzar).
    """
    if _lock_active(doc) and doc.lock_user_id != user.id:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"El documento está bloqueado por {doc.lock_user_name or 'otro usuario'}",
        )

    if (
        not force
        and doc.current_version_id
        and base_version_id != doc.current_version_id
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "El documento cambió desde que empezaste a editar. "
            "Revisá el historial o guardá forzando una versión nueva.",
        )

    old_content = doc.content_md or ""
    result = await db.execute(
        select(func.coalesce(func.max(DocumentVersion.version_number), 0)).where(
            DocumentVersion.document_id == doc.id
        )
    )
    last_number = int(result.scalar_one() or 0)

    added, removed = word_delta(old_content, content_md)
    version = DocumentVersion(
        document_id=doc.id,
        project_id=doc.project_id,
        version_number=last_number + 1,
        content_md=content_md,
        diff_md=make_diff(old_content, content_md) or None,
        summary=(summary or "").strip()[:500] or None,
        author_id=user.id,
        author_name=user.full_name,
        word_count=count_words(content_md),
        words_added=added,
        words_removed=removed,
    )
    db.add(version)
    await db.flush()

    doc.content_md = content_md
    doc.word_count = version.word_count
    doc.current_version_id = version.id
    await db.commit()
    await db.refresh(version)
    return version
