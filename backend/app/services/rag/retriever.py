"""Búsqueda híbrida sobre los chunks de fuentes de un proyecto.

Postgres + pgvector: RRF entre ranking vectorial (coseno) y full-text
('spanish'). Sin pgvector o sin embeddings: solo full-text. SQLite (dev):
LIKE por términos. El filtro por project_id vive EN el SQL (defensa en
profundidad para el agente del visualizador).
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.config import settings
from .embedder import embed_texts

RRF_K = 60


def _row_to_result(row: Any) -> dict:
    meta = row.meta
    if isinstance(meta, str):  # SQL crudo: SQLite/PG pueden devolver el JSON como texto
        import json

        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    return {
        "chunk_id": row.id,
        "source_id": row.source_id,
        "source_title": row.source_title,
        "content": row.content,
        "meta": meta or {},
        "score": float(row.score or 0),
    }


async def search_chunks(
    db: AsyncSession,
    project_id: str,
    query: str,
    k: int = 8,
    only_ready: bool = True,
) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return []

    backend = db.get_bind().dialect.name
    if backend == "postgresql":
        return await _search_postgres(db, project_id, query, k, only_ready)
    return await _search_sqlite(db, project_id, query, k, only_ready)


async def _search_postgres(
    db: AsyncSession, project_id: str, query: str, k: int, only_ready: bool
) -> list[dict]:
    ready_filter = "AND s.status = 'ready'" if only_ready else ""

    q_emb = None
    if settings.openai_api_key:
        try:
            vectors, _ = await embed_texts([query])
            if vectors:
                q_emb = str(vectors[0])
        except Exception:
            q_emb = None

    if q_emb:
        sql = text(f"""
            WITH v AS (
                SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> :q_emb) AS rnk
                FROM source_chunks c JOIN sources s ON s.id = c.source_id
                WHERE c.project_id = :pid AND c.embedding IS NOT NULL {ready_filter}
                ORDER BY c.embedding <=> :q_emb
                LIMIT 30
            ),
            t AS (
                SELECT c.id, row_number() OVER (
                    ORDER BY ts_rank(c.tsv, websearch_to_tsquery('spanish', :q)) DESC
                ) AS rnk
                FROM source_chunks c JOIN sources s ON s.id = c.source_id
                WHERE c.project_id = :pid AND c.tsv @@ websearch_to_tsquery('spanish', :q)
                {ready_filter}
                LIMIT 30
            ),
            fused AS (
                SELECT COALESCE(v.id, t.id) AS id,
                       COALESCE(1.0 / ({RRF_K} + v.rnk), 0) + COALESCE(1.0 / ({RRF_K} + t.rnk), 0) AS score
                FROM v FULL OUTER JOIN t ON v.id = t.id
            )
            SELECT c.id, c.source_id, c.content, c.meta, f.score, s.title AS source_title
            FROM fused f JOIN source_chunks c ON c.id = f.id
            JOIN sources s ON s.id = c.source_id
            ORDER BY f.score DESC
            LIMIT :k
        """)
        rows = await db.execute(sql, {"pid": project_id, "q": query, "q_emb": q_emb, "k": k})
    else:
        sql = text(f"""
            SELECT c.id, c.source_id, c.content, c.meta,
                   ts_rank(c.tsv, websearch_to_tsquery('spanish', :q)) AS score,
                   s.title AS source_title
            FROM source_chunks c JOIN sources s ON s.id = c.source_id
            WHERE c.project_id = :pid AND c.tsv @@ websearch_to_tsquery('spanish', :q)
            {ready_filter}
            ORDER BY score DESC
            LIMIT :k
        """)
        rows = await db.execute(sql, {"pid": project_id, "q": query, "k": k})

    return [_row_to_result(r) for r in rows]


async def _search_sqlite(
    db: AsyncSession, project_id: str, query: str, k: int, only_ready: bool
) -> list[dict]:
    """Dev sin Postgres: LIKE por términos, puntaje = términos que matchean."""
    terms = [t.lower() for t in query.split() if len(t) >= 3][:8] or [query.lower()]
    likes = " + ".join(
        f"(CASE WHEN lower(c.content) LIKE :t{i} THEN 1 ELSE 0 END)" for i in range(len(terms))
    )
    ready_filter = "AND s.status = 'ready'" if only_ready else ""
    sql = text(f"""
        SELECT c.id, c.source_id, c.content, c.meta, ({likes}) AS score, s.title AS source_title
        FROM source_chunks c JOIN sources s ON s.id = c.source_id
        WHERE c.project_id = :pid {ready_filter}
        ORDER BY score DESC
        LIMIT :k
    """)
    params: dict[str, Any] = {"pid": project_id, "k": k}
    for i, term in enumerate(terms):
        params[f"t{i}"] = f"%{term}%"
    rows = await db.execute(sql, params)
    return [r for r in (_row_to_result(row) for row in rows) if r["score"] > 0]


def format_citation(result: dict) -> str:
    meta = result.get("meta") or {}
    loc = ""
    if meta.get("page"):
        loc = f", pág. {meta['page']}"
    elif meta.get("sheet"):
        loc = f", hoja «{meta['sheet']}»" + (f" filas {meta['rows']}" if meta.get("rows") else "")
    elif meta.get("section"):
        loc = f", sección «{meta['section']}»"
    return f"[{result['source_title']}{loc}]"
