"""Presentaciones del KnowHub (estilo «Claude Design» para slides).

La calidad es determinista: la IA produce SOLO el contenido estructurado
(deck JSON) y una plantilla HTML propia — marca Voicenter, navegación por
teclado, animaciones de entrada y CSS de impresión (una slide por página,
apaisado) — lo renderiza siempre perfecto. Exporta a HTML autocontenido y
a PDF vía el diálogo de impresión (botón PDF o abriendo la URL con #print).
"""
from __future__ import annotations

import html
import json
import re
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from .knowhub_service import _Usage, _chat, build_context

SLIDE_STYLES: dict[str, dict] = {
    "resumen": {
        "label": "Resumen ejecutivo",
        "accent": "#E6332A",
        "accent2": "#B81F18",
        "brief": (
            "Presentación EJECUTIVA de 8 a 10 slides para dirección: solo lo "
            "esencial — problema, 3-5 hallazgos con sus cifras, conclusiones y "
            "próximos pasos. Frases cortas, cero relleno."
        ),
    },
    "explicativa": {
        "label": "Explicativa",
        "accent": "#00B2BF",
        "accent2": "#00858F",
        "brief": (
            "Presentación DIDÁCTICA de 12 a 16 slides para alguien que no conoce "
            "el proyecto: contexto, definiciones breves de los términos clave, "
            "método, hallazgos explicados paso a paso con sus cifras, y qué "
            "significa cada resultado."
        ),
    },
    "corporativa": {
        "label": "Corporativa",
        "accent": "#E6332A",
        "accent2": "#662483",
        "brief": (
            "Presentación CORPORATIVA de 10 a 14 slides para presentar a un "
            "cliente o directorio: narrativa persuasiva pero sobria, cifras "
            "protagonistas, credenciales del método (fuentes verificables), "
            "recomendaciones accionables y cierre con próximos pasos."
        ),
    },
    "personalizada": {
        "label": "Personalizada",
        "accent": "#E6332A",
        "accent2": "#662483",
        "brief": "",  # la instrucción la escribe el consultor
    },
}

_DECK_SYSTEM = """Sos el diseñador de contenido de presentaciones de VEX \
Consulting (Voicenter). A partir del material del proyecto armás el CONTENIDO \
de una presentación profesional. No escribís HTML: solo la estructura.

Reglas de oro:
- SOLO datos del material provisto — nunca inventes cifras; cada cifra con su \
fuente breve («BCP», «ContactBabel 2024»).
- Una idea por slide. Títulos de máximo 8 palabras. Bullets de máximo 14 \
palabras, máximo 5 por slide.
- Usá slides de tipo "cifras" para los números importantes (2 a 4 KPI por \
slide, con etiqueta corta y fuente).
- Abrí con "portada", separá bloques con "seccion", cerrá con "cierre" \
(conclusiones + próximos pasos).
- Si hay una frase potente y respaldada, usá UNA slide "cita".

Respondé SOLO JSON:
{"titulo": "<título de la presentación>",
 "subtitulo": "<una línea>",
 "slides": [
   {"tipo": "portada"} |
   {"tipo": "seccion", "titulo": "<bloque>"} |
   {"tipo": "contenido", "titulo": "<...>", "puntos": ["<bullet>", ...], "nota": "<fuente/aclaración opcional>"} |
   {"tipo": "cifras", "titulo": "<...>", "cifras": [{"valor": "<p. ej. ₲6.087>", "etiqueta": "<qué es>", "fuente": "<corta>"}]} |
   {"tipo": "cita", "texto": "<frase>", "autor": "<fuente>"} |
   {"tipo": "cierre", "titulo": "<...>", "puntos": ["<conclusión o próximo paso>", ...]}
 ]}"""


def _esc(s) -> str:
    return html.escape(str(s or ""), quote=True)


def _slide_html(s: dict, idx: int, total: int, project: str) -> str:
    t = s.get("tipo") or "contenido"
    if t == "portada":
        return f"""<section class="slide portada">
  <div class="stagger">
    <div class="kicker">VEX Consulting · Investigación de mercado</div>
    <h1>__TITULO__</h1>
    <p class="sub">__SUBTITULO__</p>
    <div class="meta">{_esc(project)} · {date.today().strftime('%d/%m/%Y')} · Voicenter S.A.</div>
  </div>
</section>"""
    if t == "seccion":
        return f"""<section class="slide seccion">
  <div class="stagger">
    <div class="num">{idx:02d}</div>
    <h2>{_esc(s.get('titulo'))}</h2>
  </div>
</section>"""
    if t == "cifras":
        cards = "".join(
            f"""<div class="kpi"><div class="valor">{_esc(c.get('valor'))}</div>
<div class="etiqueta">{_esc(c.get('etiqueta'))}</div>
{f'<div class="fuente">{_esc(c.get("fuente"))}</div>' if c.get('fuente') else ''}</div>"""
            for c in (s.get("cifras") or [])[:4]
        )
        return f"""<section class="slide cifras">
  <div class="stagger">
    <h2>{_esc(s.get('titulo'))}</h2>
    <div class="kpis n{min(len((s.get('cifras') or [])[:4]), 4)}">{cards}</div>
  </div>
</section>"""
    if t == "cita":
        return f"""<section class="slide cita">
  <div class="stagger">
    <blockquote>“{_esc(s.get('texto'))}”</blockquote>
    <div class="autor">— {_esc(s.get('autor'))}</div>
  </div>
</section>"""
    if t == "cierre":
        pts = "".join(f"<li>{_esc(p)}</li>" for p in (s.get("puntos") or [])[:6])
        return f"""<section class="slide cierre">
  <div class="stagger">
    <h2>{_esc(s.get('titulo') or 'Conclusiones y próximos pasos')}</h2>
    <ul>{pts}</ul>
    <div class="meta">VEX Consulting · Voicenter S.A.</div>
  </div>
</section>"""
    pts = "".join(f"<li>{_esc(p)}</li>" for p in (s.get("puntos") or [])[:6])
    nota = f'<div class="nota">{_esc(s.get("nota"))}</div>' if s.get("nota") else ""
    return f"""<section class="slide contenido">
  <div class="stagger">
    <h2>{_esc(s.get('titulo'))}</h2>
    <ul>{pts}</ul>
    {nota}
  </div>
</section>"""


_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITULO__ — VEX Consulting</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
:root{--accent:__ACCENT__;--accent2:__ACCENT2__;--ink:#0F1116;--bg:#FFFFFF;--slate:#5B6275}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:var(--ink);font-family:"Manrope",system-ui,sans-serif;color:var(--ink)}
h1,h2,.num,.valor{font-family:"Barlow Condensed",Impact,sans-serif;text-transform:uppercase;line-height:.95}
.deck{position:fixed;inset:0;overflow:hidden}
.slide{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:6vmin 8vmin;
  background:var(--bg);opacity:0;transform:translateX(6%) scale(.98);transition:opacity .5s ease,transform .5s ease;
  pointer-events:none;visibility:hidden}
.slide.active{opacity:1;transform:none;pointer-events:auto;visibility:visible}
.slide.prev{transform:translateX(-6%) scale(.98)}
.stagger{width:min(1100px,100%)}
.slide .stagger>*{opacity:0;transform:translateY(18px);transition:opacity .55s ease,transform .55s ease}
.slide.active .stagger>*{opacity:1;transform:none}
.slide.active .stagger>*:nth-child(1){transition-delay:.05s}.slide.active .stagger>*:nth-child(2){transition-delay:.18s}
.slide.active .stagger>*:nth-child(3){transition-delay:.31s}.slide.active .stagger>*:nth-child(4){transition-delay:.44s}
.slide ul li{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}
.slide.active ul li{opacity:1;transform:none}
.slide.active ul li:nth-child(1){transition-delay:.25s}.slide.active ul li:nth-child(2){transition-delay:.37s}
.slide.active ul li:nth-child(3){transition-delay:.49s}.slide.active ul li:nth-child(4){transition-delay:.61s}
.slide.active ul li:nth-child(5){transition-delay:.73s}.slide.active ul li:nth-child(6){transition-delay:.85s}
/* Portada */
.portada{background:linear-gradient(135deg,var(--accent2) 0%,var(--accent) 55%,#F39200 130%);color:#fff}
.portada .kicker{font-size:14px;letter-spacing:.25em;text-transform:uppercase;opacity:.85;margin-bottom:2.2vmin}
.portada h1{font-size:9.5vmin;font-weight:800;max-width:22ch}
.portada .sub{font-size:2.6vmin;margin-top:2.4vmin;opacity:.92;max-width:60ch;line-height:1.5}
.portada .meta{margin-top:5vmin;font-size:1.9vmin;opacity:.75;border-top:1px solid rgba(255,255,255,.35);padding-top:1.6vmin;display:inline-block}
/* Sección */
.seccion{background:var(--ink);color:#fff}
.seccion .num{font-size:16vmin;color:var(--accent);font-weight:800;opacity:.9}
.seccion h2{font-size:7.5vmin;font-weight:700;max-width:24ch}
/* Contenido */
.contenido h2,.cifras h2,.cierre h2{font-size:5.6vmin;font-weight:700;margin-bottom:3.6vmin;position:relative;padding-bottom:1.6vmin}
.contenido h2::after,.cifras h2::after,.cierre h2::after{content:"";position:absolute;left:0;bottom:0;width:64px;height:5px;background:var(--accent);border-radius:99px}
.contenido ul,.cierre ul{list-style:none;font-size:2.9vmin;line-height:1.5}
.contenido li,.cierre li{padding:1.3vmin 0 1.3vmin 4.2vmin;position:relative;border-bottom:1px solid #eceef3}
.contenido li::before,.cierre li::before{content:"";position:absolute;left:.4vmin;top:2.1vmin;width:2.1vmin;height:2.1vmin;border-radius:6px;background:color-mix(in srgb,var(--accent) 14%,white);border:2px solid var(--accent)}
.contenido .nota{margin-top:2.6vmin;font-size:1.9vmin;color:var(--slate);font-style:italic}
/* Cifras */
.kpis{display:grid;gap:2.6vmin}
.kpis.n1{grid-template-columns:1fr}.kpis.n2{grid-template-columns:1fr 1fr}
.kpis.n3{grid-template-columns:repeat(3,1fr)}.kpis.n4{grid-template-columns:repeat(2,1fr)}
.kpi{background:#F6F7FB;border:1px solid #e5e7ee;border-top:6px solid var(--accent);border-radius:14px;padding:3.4vmin 3vmin}
.kpi .valor{font-size:7vmin;font-weight:800;color:var(--accent)}
.kpi .etiqueta{font-size:2.2vmin;font-weight:600;margin-top:1vmin;color:var(--ink)}
.kpi .fuente{font-size:1.7vmin;color:var(--slate);margin-top:.8vmin}
/* Cita */
.cita{background:var(--ink);color:#fff}
.cita blockquote{font-size:5vmin;font-weight:600;line-height:1.35;max-width:28ch;font-family:"Barlow Condensed",sans-serif}
.cita .autor{margin-top:3vmin;font-size:2.2vmin;color:var(--accent);font-weight:700}
/* Cierre */
.cierre .meta{margin-top:4vmin;font-size:1.9vmin;color:var(--slate)}
/* Cromo */
.progress{position:fixed;top:0;left:0;height:4px;background:var(--accent);z-index:50;transition:width .4s ease}
.hud{position:fixed;bottom:18px;right:22px;z-index:50;display:flex;gap:8px;align-items:center;
  font-size:12px;color:#fff;mix-blend-mode:difference;font-weight:700;letter-spacing:.08em}
.toolbar{position:fixed;bottom:14px;left:18px;z-index:50;display:flex;gap:6px;opacity:.25;transition:opacity .25s}
.toolbar:hover{opacity:1}
.toolbar button{border:1px solid rgba(120,120,130,.5);background:rgba(255,255,255,.85);backdrop-filter:blur(8px);
  color:#0F1116;border-radius:8px;padding:7px 12px;font:600 12px "Manrope",sans-serif;cursor:pointer}
.toolbar button:hover{border-color:var(--accent);color:var(--accent)}
/* ===== Impresión (Exportar PDF): A4 apaisado, una slide por página =====
   Claves: print-color-adjust conserva degradados y fondos; las medidas de
   pantalla usan vmin (colapsan al imprimir), así que acá TODO se redefine
   en milímetros sobre la página de 297×210 mm. */
@media print{
  @page{size:A4 landscape;margin:0}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  html,body{background:#fff;height:auto}
  .deck{position:static;overflow:visible}
  .slide{position:relative;inset:auto;opacity:1!important;transform:none!important;visibility:visible!important;
    pointer-events:auto;width:297mm;height:209mm;padding:16mm 22mm;page-break-after:always;
    break-inside:avoid;transition:none;overflow:hidden}
  .slide:last-child{page-break-after:auto}
  .slide .stagger>*,.slide ul li{opacity:1!important;transform:none!important;transition:none!important}
  .stagger{width:100%;max-width:none}
  .progress,.hud,.toolbar{display:none!important}
  /* Portada */
  .portada .kicker{font-size:4mm;margin-bottom:8mm}
  .portada h1{font-size:26mm}
  .portada .sub{font-size:7mm;margin-top:7mm}
  .portada .meta{margin-top:14mm;font-size:4.5mm;padding-top:4mm}
  /* Sección */
  .seccion .num{font-size:44mm}
  .seccion h2{font-size:20mm}
  /* Títulos y bullets */
  .contenido h2,.cifras h2,.cierre h2{font-size:14mm;margin-bottom:9mm;padding-bottom:4mm}
  .contenido h2::after,.cifras h2::after,.cierre h2::after{width:18mm;height:1.6mm}
  .contenido ul,.cierre ul{font-size:6.4mm;line-height:1.45}
  .contenido li,.cierre li{padding:3.4mm 0 3.4mm 11mm}
  .contenido li::before,.cierre li::before{left:1mm;top:5mm;width:5mm;height:5mm;border-width:.7mm;border-radius:1.6mm}
  .contenido .nota{margin-top:7mm;font-size:4.4mm}
  /* Cifras */
  .kpis{gap:7mm}
  .kpi{padding:9mm 8mm;border-radius:4mm;border-top-width:2mm}
  .kpi .valor{font-size:17mm}
  .kpi .etiqueta{font-size:5.4mm;margin-top:2.5mm}
  .kpi .fuente{font-size:4mm;margin-top:2mm}
  /* Cita */
  .cita blockquote{font-size:13mm}
  .cita .autor{margin-top:8mm;font-size:5.5mm}
  .cierre .meta{margin-top:10mm;font-size:4.5mm}
}
</style>
</head>
<body>
<div class="progress" id="bar"></div>
<div class="deck" id="deck">
__SLIDES__
</div>
<div class="toolbar">
  <button onclick="go(-1)">◀ Anterior</button>
  <button onclick="go(1)">Siguiente ▶</button>
  <button onclick="window.print()">Exportar PDF</button>
</div>
<div class="hud"><span id="counter">1 / __TOTAL__</span></div>
<script>
var slides=[].slice.call(document.querySelectorAll('.slide')),i=0;
function show(n){i=Math.max(0,Math.min(slides.length-1,n));
  slides.forEach(function(s,k){s.classList.toggle('active',k===i);s.classList.toggle('prev',k<i);});
  document.getElementById('bar').style.width=((i+1)/slides.length*100)+'%';
  document.getElementById('counter').textContent=(i+1)+' / '+slides.length;}
function go(d){show(i+d)}
document.addEventListener('keydown',function(e){
  if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')go(1);
  if(e.key==='ArrowLeft'||e.key==='PageUp')go(-1);
  if(e.key==='Home')show(0); if(e.key==='End')show(slides.length-1);});
document.addEventListener('click',function(e){
  if(e.target.closest('.toolbar'))return;
  go(e.clientX>window.innerWidth/2?1:-1);});
var tx=null;document.addEventListener('touchstart',function(e){tx=e.touches[0].clientX});
document.addEventListener('touchend',function(e){if(tx===null)return;
  var dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)go(dx<0?1:-1);tx=null;});
show(0);
if(location.hash==='#print'){setTimeout(function(){window.print()},600);}
</script>
</body>
</html>"""


def render_slides_html(deck: dict, style: str, project_name: str) -> str:
    theme = SLIDE_STYLES.get(style) or SLIDE_STYLES["corporativa"]
    slides = deck.get("slides") or []
    sections = "\n".join(
        _slide_html(s, idx + 1, len(slides), project_name) for idx, s in enumerate(slides)
    )
    out = (
        _TEMPLATE
        .replace("__SLIDES__", sections)
        .replace("__TOTAL__", str(len(slides)))
        .replace("__ACCENT2__", theme["accent2"])
        .replace("__ACCENT__", theme["accent"])
        .replace("__TITULO__", _esc(deck.get("titulo") or project_name))
        .replace("__SUBTITULO__", _esc(deck.get("subtitulo") or ""))
    )
    return out


def _deck_outline_md(deck: dict) -> str:
    """Esquema compacto para la tarjeta del KnowHub."""
    lines = [f"**{deck.get('titulo')}** — {deck.get('subtitulo') or ''}", ""]
    for idx, s in enumerate(deck.get("slides") or [], 1):
        label = s.get("titulo") or s.get("texto") or s.get("tipo")
        lines.append(f"{idx}. [{s.get('tipo')}] {str(label)[:80]}")
    return "\n".join(lines)


async def generate_slides(
    db: AsyncSession, project_id: str, project_name: str, description: str | None,
    style: str = "corporativa", instruction: str | None = None,
) -> dict:
    style = style if style in SLIDE_STYLES else "corporativa"
    theme = SLIDE_STYLES[style]
    brief = (instruction or "").strip() or theme["brief"] or SLIDE_STYLES["corporativa"]["brief"]

    context = await build_context(db, project_id, project_name, description)
    usage = _Usage()
    raw = await _chat(
        _DECK_SYSTEM,
        f"INSTRUCCIÓN DE LA PRESENTACIÓN ({theme['label']}): {brief}\n\n"
        f"MATERIAL DEL PROYECTO:\n{context}",
        usage, json_mode=True,
    )
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    deck = json.loads(match.group(0)) if match else {}
    slides = [s for s in deck.get("slides") or [] if isinstance(s, dict)]
    if len(slides) < 4:
        raise ValueError("La IA no devolvió una presentación válida")
    deck["slides"] = slides[:20]

    html_out = render_slides_html(deck, style, project_name)
    out_dir = settings.upload_path / project_id / "knowhub"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"slides-{uuid.uuid4().hex}.html"
    path.write_text(html_out, encoding="utf-8")
    # El deck se guarda aparte: el endpoint re-renderiza con la plantilla
    # VIGENTE al servir — las mejoras de diseño aplican retroactivamente.
    path.with_suffix(".json").write_text(
        json.dumps({"deck": deck, "style": style, "project": project_name},
                   ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "title": f"{deck.get('titulo') or project_name} · {theme['label']} · {len(deck['slides'])} slides",
        "content_md": _deck_outline_md(deck),
        "file_path": str(path),
        "cost_usd": round(usage.cost, 4),
    }
