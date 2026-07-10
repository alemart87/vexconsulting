"""Chunking estructura-aware: ~900 tokens por chunk, overlap de 120,
respetando párrafos y heredando metadatos citables de la sección."""
from __future__ import annotations

from typing import Any

TARGET_TOKENS = 900
OVERLAP_TOKENS = 120

_encoder = None


def _encode(text: str) -> list[int]:
    global _encoder
    if _encoder is None:
        try:
            import tiktoken

            _encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            _encoder = False
    if _encoder:
        return _encoder.encode(text)
    # Fallback burdo: ~4 chars por token
    return list(range(max(1, len(text) // 4)))


def token_len(text: str) -> int:
    return len(_encode(text))


def chunk_sections(sections: list[dict[str, Any]], max_chunks: int) -> list[dict[str, Any]]:
    """Devuelve [{content, meta, token_count}] a partir de las secciones extraídas."""
    chunks: list[dict[str, Any]] = []

    for section in sections:
        text = (section.get("text") or "").strip()
        meta = section.get("meta") or {}
        if not text:
            continue

        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text]

        current: list[str] = []
        current_tokens = 0

        def flush() -> None:
            nonlocal current, current_tokens
            if not current:
                return
            content = "\n\n".join(current).strip()
            if content:
                chunks.append({
                    "content": content,
                    "meta": dict(meta),
                    "token_count": current_tokens,
                })
            # Overlap: arrastrar el último párrafo si es corto
            if current and token_len(current[-1]) <= OVERLAP_TOKENS:
                carried = current[-1]
                current = [carried]
                current_tokens = token_len(carried)
            else:
                current = []
                current_tokens = 0

        for para in paragraphs:
            p_tokens = token_len(para)
            # Párrafo gigante (tabla larga): partirlo por líneas
            if p_tokens > TARGET_TOKENS:
                flush()
                lines = para.split("\n")
                buf: list[str] = []
                buf_tokens = 0
                for line in lines:
                    lt = token_len(line)
                    if buf_tokens + lt > TARGET_TOKENS and buf:
                        chunks.append({
                            "content": "\n".join(buf),
                            "meta": dict(meta),
                            "token_count": buf_tokens,
                        })
                        buf, buf_tokens = [], 0
                    buf.append(line)
                    buf_tokens += lt
                if buf:
                    chunks.append({
                        "content": "\n".join(buf),
                        "meta": dict(meta),
                        "token_count": buf_tokens,
                    })
                continue

            if current_tokens + p_tokens > TARGET_TOKENS and current:
                flush()
            current.append(para)
            current_tokens += p_tokens

        flush()
        if len(chunks) >= max_chunks:
            break

    return chunks[:max_chunks]
