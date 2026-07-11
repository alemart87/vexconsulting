"""Render de gráficos a SVG con identidad Voicenter (sin dependencias externas).

El agente produce una especificación JSON; acá se dibuja:
- bar   : barras agrupadas (multi-serie)
- line  : líneas multi-serie con área sutil
- barh  : barras horizontales (rankings / comparación entre países o empresas)
- donut : participación / composición (una serie)

Elementos analíticos: `destacar` (resalta una categoría en rojo y agrisa el
resto — ideal para «Paraguay vs. el mundo»), `linea_referencia`
({valor, etiqueta} — meta o benchmark) y `promedio` (línea punteada con el
promedio de la primera serie).

El SVG se guarda como imagen del proyecto → se inserta en el documento y
viaja a la vista previa y al export PDF.
"""
from __future__ import annotations

import html
import math
from typing import Any

BRAND_COLORS = ["#E6332A", "#00B2BF", "#662483", "#F39200", "#2A9D5C", "#5B6275"]
MUTED = "#C6CAD3"
HIGHLIGHT = "#E6332A"

WIDTH, HEIGHT = 960, 560
MARGIN_L, MARGIN_R = 82, 36


def _esc(text: Any) -> str:
    return html.escape(str(text))[:60]


def _esc_long(text: Any, max_len: int) -> str:
    return html.escape(str(text))[:max_len]


def _nice_max(value: float) -> float:
    if value <= 0:
        return 1.0
    exp = math.floor(math.log10(value))
    frac = value / (10 ** exp)
    nice = 1 if frac <= 1 else 2 if frac <= 2 else 5 if frac <= 5 else 10
    return nice * (10 ** exp)


def _fmt(v: float) -> str:
    if abs(v) >= 1000:
        return f"{v:,.0f}".replace(",", ".")
    if v == int(v):
        return str(int(v))
    return f"{v:.1f}".replace(".", ",")


def _is_highlighted(label: str, destacar: str) -> bool:
    return bool(destacar) and destacar.lower() in label.lower()


def render_chart_svg(spec: dict) -> str:
    """spec = {type: 'bar'|'line'|'barh'|'donut', title?, subtitle?, source?,
    y_label?, destacar?, linea_referencia?: {valor, etiqueta}, promedio?: bool,
    series: [{name, points: [{label, value}]}]}"""
    chart_type = (spec.get("type") or "bar").lower()
    series = spec.get("series") or []
    series = [s for s in series if s.get("points")][:6]
    if not series:
        raise ValueError("El gráfico no tiene series con datos")

    title = str(spec.get("title") or "").strip()
    subtitle = str(spec.get("subtitle") or "").strip()
    source = str(spec.get("source") or "").strip()
    y_label = str(spec.get("y_label") or "").strip()
    destacar = str(spec.get("destacar") or spec.get("highlight") or "").strip()
    promedio = bool(spec.get("promedio"))
    ref = spec.get("linea_referencia") or spec.get("ref_line") or None
    ref_val, ref_label = None, ""
    if isinstance(ref, dict):
        try:
            ref_val = float(ref.get("valor") if ref.get("valor") is not None else ref.get("value"))
            ref_label = str(ref.get("etiqueta") or ref.get("label") or "").strip()
        except (TypeError, ValueError):
            ref_val = None

    labels: list[str] = []
    for s in series:
        for p in s["points"]:
            lbl = str(p.get("label", ""))[:26]
            if lbl not in labels:
                labels.append(lbl)
    labels = labels[:16]

    values: dict[tuple[int, str], float] = {}
    max_val = 0.0
    for i, s in enumerate(series):
        for p in s["points"]:
            lbl = str(p.get("label", ""))[:26]
            if lbl in labels:
                try:
                    v = float(p.get("value", 0) or 0)
                except (TypeError, ValueError):
                    v = 0.0
                values[(i, lbl)] = v
                max_val = max(max_val, v)
    if ref_val:
        max_val = max(max_val, ref_val)

    y_max = _nice_max(max_val * 1.12)

    # ----- Layout vertical: título / subtítulo / leyenda / plot / fuente -----
    y_cursor = 16
    title_y = subtitle_y = legend_y = 0
    if title:
        y_cursor += 14
        title_y = y_cursor
        y_cursor += 10
    if subtitle:
        y_cursor += 8
        subtitle_y = y_cursor
        y_cursor += 6
    show_legend = len(series) > 1 and chart_type != "donut"
    if show_legend:
        y_cursor += 14
        legend_y = y_cursor
        y_cursor += 6
    margin_t = y_cursor + 14

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'font-family="Segoe UI, Arial, sans-serif" font-size="12.5">',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="white"/>',
        f'<rect x="0" y="0" width="{WIDTH}" height="4" fill="#E6332A"/>',
    ]
    if title:
        parts.append(
            f'<text x="{MARGIN_L}" y="{title_y}" font-size="17" font-weight="700" '
            f'fill="#0F1116">{_esc_long(title, 88)}</text>'
        )
    if subtitle:
        parts.append(
            f'<text x="{MARGIN_L}" y="{subtitle_y}" font-size="12" fill="#5B6275">'
            f'{_esc_long(subtitle, 110)}</text>'
        )
    if show_legend:
        lx = MARGIN_L
        for i, s in enumerate(series):
            color = BRAND_COLORS[i % len(BRAND_COLORS)]
            name = _esc(s.get("name") or f"Serie {i + 1}")
            parts.append(
                f'<rect x="{lx}" y="{legend_y - 10}" width="11" height="11" fill="{color}" rx="2.5"/>'
            )
            parts.append(
                f'<text x="{lx + 16}" y="{legend_y}" fill="#2A2F3A" font-size="12">{name}</text>'
            )
            lx += 16 + int(6.8 * len(name)) + 26

    footer_y = HEIGHT - 10

    if chart_type == "donut":
        _draw_donut(parts, series[0], labels, values, margin_t, footer_y, destacar)
    elif chart_type == "barh":
        _draw_barh(parts, series[0], labels, values, margin_t, footer_y, source,
                   destacar, y_max, ref_val, ref_label, y_label)
    else:
        _draw_xy(parts, chart_type, series, labels, values, margin_t, source,
                 destacar, y_max, ref_val, ref_label, promedio, y_label)

    if source:
        parts.append(
            f'<text x="{MARGIN_L}" y="{footer_y}" fill="#9CA3AF" font-size="10.5">'
            f'Fuente: {_esc_long(source, 100)}</text>'
        )
    parts.append(
        f'<text x="{WIDTH - MARGIN_R}" y="{footer_y}" text-anchor="end" fill="#9CA3AF" '
        f'font-size="10">VEX Consulting · Voicenter S.A.</text>'
    )
    parts.append("</svg>")
    return "".join(parts)


# ---------------------------------------------------------------------------
# Barras verticales agrupadas y líneas (con referencia, promedio y destacado)
# ---------------------------------------------------------------------------

def _draw_xy(parts: list[str], chart_type: str, series: list, labels: list[str],
             values: dict, margin_t: int, source: str, destacar: str,
             y_max: float, ref_val: float | None, ref_label: str,
             promedio: bool, y_label: str) -> None:
    rotate = any(len(l) > 9 for l in labels) or len(labels) > 8
    x_band = 78 if rotate else 34
    margin_b = x_band + (26 if source else 14)
    plot_w = WIDTH - MARGIN_L - MARGIN_R
    plot_h = HEIGHT - margin_t - margin_b

    def sx(idx: int) -> float:
        return MARGIN_L + plot_w * (idx + 0.5) / len(labels)

    def sy(val: float) -> float:
        return margin_t + plot_h * (1 - val / y_max)

    x_base = margin_t + plot_h

    for i in range(6):
        y_val = y_max * i / 5
        y = sy(y_val)
        parts.append(
            f'<line x1="{MARGIN_L}" y1="{y:.1f}" x2="{WIDTH - MARGIN_R}" y2="{y:.1f}" '
            f'stroke="{"#D7DAE0" if i == 0 else "#EDEFF3"}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{MARGIN_L - 10}" y="{y + 4:.1f}" text-anchor="end" '
            f'fill="#5B6275" font-size="11.5">{_fmt(y_val)}</text>'
        )

    for idx, lbl in enumerate(labels):
        x = sx(idx)
        hl = _is_highlighted(lbl, destacar)
        parts.append(
            f'<line x1="{x:.1f}" y1="{x_base:.1f}" x2="{x:.1f}" y2="{x_base + 4:.1f}" '
            f'stroke="#D7DAE0" stroke-width="1"/>'
        )
        weight = ' font-weight="700"' if hl else ""
        fill = HIGHLIGHT if hl else "#2A2F3A"
        if rotate:
            parts.append(
                f'<text x="{x:.1f}" y="{x_base + 16}" text-anchor="end" fill="{fill}"{weight} '
                f'font-size="11.5" transform="rotate(-38 {x:.1f} {x_base + 16})">{_esc(lbl)}</text>'
            )
        else:
            parts.append(
                f'<text x="{x:.1f}" y="{x_base + 20}" text-anchor="middle" '
                f'fill="{fill}"{weight} font-size="11.5">{_esc(lbl)}</text>'
            )

    if chart_type == "line":
        for i, s in enumerate(series):
            color = BRAND_COLORS[i % len(BRAND_COLORS)]
            pts = []
            for idx, lbl in enumerate(labels):
                v = values.get((i, lbl))
                if v is not None:
                    pts.append((sx(idx), sy(v), v))
            if len(pts) >= 2:
                if i == 0:
                    area = (
                        f"M {pts[0][0]:.1f},{x_base:.1f} "
                        + " ".join(f"L {x:.1f},{y:.1f}" for x, y, _ in pts)
                        + f" L {pts[-1][0]:.1f},{x_base:.1f} Z"
                    )
                    parts.append(f'<path d="{area}" fill="{color}" opacity="0.07"/>')
                path = " ".join(f"{x:.1f},{y:.1f}" for x, y, _ in pts)
                parts.append(
                    f'<polyline points="{path}" fill="none" stroke="{color}" '
                    f'stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>'
                )
            show_values = len(pts) <= 10
            for j, (x, y, v) in enumerate(pts):
                parts.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="white" '
                    f'stroke="{color}" stroke-width="2.5"/>'
                )
                if show_values or j in (0, len(pts) - 1):
                    parts.append(
                        f'<text x="{x:.1f}" y="{y - 10:.1f}" text-anchor="middle" '
                        f'fill="{color}" font-weight="700" font-size="11">{_fmt(v)}</text>'
                    )
    else:  # barras agrupadas
        group_w = plot_w / len(labels) * 0.7
        bar_w = group_w / len(series)
        show_values = len(labels) * len(series) <= 24
        for idx, lbl in enumerate(labels):
            x0 = sx(idx) - group_w / 2
            hl = _is_highlighted(lbl, destacar)
            for i in range(len(series)):
                v = values.get((i, lbl))
                if v is None:
                    continue
                if destacar and len(series) == 1:
                    color = HIGHLIGHT if hl else MUTED
                else:
                    color = BRAND_COLORS[i % len(BRAND_COLORS)]
                x = x0 + i * bar_w
                y = sy(v)
                h = x_base - y
                parts.append(
                    f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w * 0.88:.1f}" '
                    f'height="{max(h, 0):.1f}" fill="{color}" rx="3"/>'
                )
                if show_values:
                    vfill = HIGHLIGHT if (hl and len(series) == 1 and destacar) else "#2A2F3A"
                    parts.append(
                        f'<text x="{x + bar_w * 0.44:.1f}" y="{y - 6:.1f}" text-anchor="middle" '
                        f'fill="{vfill}" font-weight="700" font-size="11">{_fmt(v)}</text>'
                    )

    # Línea de promedio (primera serie)
    if promedio:
        vals = [values[(0, l)] for l in labels if (0, l) in values]
        if vals:
            avg = sum(vals) / len(vals)
            y = sy(avg)
            parts.append(
                f'<line x1="{MARGIN_L}" y1="{y:.1f}" x2="{WIDTH - MARGIN_R}" y2="{y:.1f}" '
                f'stroke="#5B6275" stroke-width="1.6" stroke-dasharray="6 4"/>'
            )
            parts.append(
                f'<text x="{WIDTH - MARGIN_R - 4}" y="{y - 6:.1f}" text-anchor="end" '
                f'fill="#5B6275" font-size="10.5" font-weight="600">Promedio: {_fmt(avg)}</text>'
            )

    # Línea de referencia / meta / benchmark
    if ref_val:
        y = sy(ref_val)
        parts.append(
            f'<line x1="{MARGIN_L}" y1="{y:.1f}" x2="{WIDTH - MARGIN_R}" y2="{y:.1f}" '
            f'stroke="#662483" stroke-width="1.8" stroke-dasharray="8 5"/>'
        )
        label = f"{ref_label}: {_fmt(ref_val)}" if ref_label else _fmt(ref_val)
        parts.append(
            f'<text x="{MARGIN_L + 4}" y="{y - 6:.1f}" fill="#662483" font-size="10.5" '
            f'font-weight="700">{_esc_long(label, 60)}</text>'
        )

    if y_label:
        mid_y = margin_t + plot_h / 2
        parts.append(
            f'<text x="18" y="{mid_y:.0f}" text-anchor="middle" fill="#5B6275" font-size="12" '
            f'font-weight="600" transform="rotate(-90 18 {mid_y:.0f})">{_esc(y_label)}</text>'
        )


# ---------------------------------------------------------------------------
# Barras horizontales (rankings)
# ---------------------------------------------------------------------------

def _draw_barh(parts: list[str], serie: dict, labels: list[str], values: dict,
               margin_t: int, footer_y: int, source: str, destacar: str,
               y_max: float, ref_val: float | None, ref_label: str,
               y_label: str) -> None:
    label_w = 190
    left = MARGIN_L + label_w - 60
    plot_w = WIDTH - left - MARGIN_R - 60  # espacio para el valor al final
    margin_b = 26 if source else 14
    plot_h = HEIGHT - margin_t - margin_b - 18

    rows = [(l, values.get((0, l))) for l in labels if values.get((0, l)) is not None]
    if not rows:
        raise ValueError("El gráfico no tiene datos")
    n = len(rows)
    row_h = min(44.0, plot_h / n)
    bar_h = row_h * 0.62

    def sx(val: float) -> float:
        return left + plot_w * (val / y_max)

    # Grilla vertical
    for i in range(6):
        v = y_max * i / 5
        x = sx(v)
        parts.append(
            f'<line x1="{x:.1f}" y1="{margin_t}" x2="{x:.1f}" y2="{margin_t + n * row_h:.1f}" '
            f'stroke="{"#D7DAE0" if i == 0 else "#EDEFF3"}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{x:.1f}" y="{margin_t + n * row_h + 16:.1f}" text-anchor="middle" '
            f'fill="#5B6275" font-size="11">{_fmt(v)}</text>'
        )

    for i, (lbl, v) in enumerate(rows):
        y = margin_t + i * row_h + (row_h - bar_h) / 2
        hl = _is_highlighted(lbl, destacar)
        color = (HIGHLIGHT if hl else MUTED) if destacar else BRAND_COLORS[0]
        parts.append(
            f'<text x="{left - 10}" y="{y + bar_h / 2 + 4:.1f}" text-anchor="end" '
            f'fill="{HIGHLIGHT if hl else "#2A2F3A"}" font-size="12"'
            f'{" font-weight=\"700\"" if hl else ""}>{_esc(lbl)}</text>'
        )
        parts.append(
            f'<rect x="{left}" y="{y:.1f}" width="{max(sx(v) - left, 1):.1f}" '
            f'height="{bar_h:.1f}" fill="{color}" rx="3"/>'
        )
        parts.append(
            f'<text x="{sx(v) + 8:.1f}" y="{y + bar_h / 2 + 4:.1f}" '
            f'fill="{HIGHLIGHT if hl else "#2A2F3A"}" font-weight="700" '
            f'font-size="11.5">{_fmt(v)}</text>'
        )

    if ref_val:
        x = sx(ref_val)
        parts.append(
            f'<line x1="{x:.1f}" y1="{margin_t - 4}" x2="{x:.1f}" '
            f'y2="{margin_t + n * row_h + 4:.1f}" stroke="#662483" stroke-width="1.8" '
            f'stroke-dasharray="8 5"/>'
        )
        label = f"{ref_label}: {_fmt(ref_val)}" if ref_label else _fmt(ref_val)
        parts.append(
            f'<text x="{x:.1f}" y="{margin_t - 8}" text-anchor="middle" fill="#662483" '
            f'font-size="10.5" font-weight="700">{_esc_long(label, 60)}</text>'
        )

    if y_label:
        parts.append(
            f'<text x="{left + plot_w / 2:.0f}" y="{margin_t + n * row_h + 32:.1f}" '
            f'text-anchor="middle" fill="#5B6275" font-size="11.5" font-weight="600">'
            f'{_esc(y_label)}</text>'
        )


# ---------------------------------------------------------------------------
# Donut (participación / composición)
# ---------------------------------------------------------------------------

def _draw_donut(parts: list[str], serie: dict, labels: list[str], values: dict,
                margin_t: int, footer_y: int, destacar: str) -> None:
    rows = [(l, values.get((0, l))) for l in labels if (values.get((0, l)) or 0) > 0][:8]
    total = sum(v for _, v in rows)
    if total <= 0:
        raise ValueError("El gráfico no tiene datos positivos")

    avail_h = footer_y - margin_t - 24
    cx = MARGIN_L + 210
    cy = margin_t + avail_h / 2 + 6
    r_out = min(avail_h / 2 - 6, 165.0)
    r_in = r_out * 0.62

    angle = -math.pi / 2  # arranca arriba
    for i, (lbl, v) in enumerate(rows):
        frac = v / total
        a0, a1 = angle, angle + frac * 2 * math.pi
        angle = a1
        hl = _is_highlighted(lbl, destacar)
        color = BRAND_COLORS[i % len(BRAND_COLORS)]
        if destacar:
            color = HIGHLIGHT if hl else MUTED if not hl else color
        # Sector como path anular
        large = 1 if (a1 - a0) > math.pi else 0
        x0o, y0o = cx + r_out * math.cos(a0), cy + r_out * math.sin(a0)
        x1o, y1o = cx + r_out * math.cos(a1), cy + r_out * math.sin(a1)
        x0i, y0i = cx + r_in * math.cos(a1), cy + r_in * math.sin(a1)
        x1i, y1i = cx + r_in * math.cos(a0), cy + r_in * math.sin(a0)
        parts.append(
            f'<path d="M {x0o:.1f},{y0o:.1f} A {r_out:.1f},{r_out:.1f} 0 {large} 1 '
            f'{x1o:.1f},{y1o:.1f} L {x0i:.1f},{y0i:.1f} A {r_in:.1f},{r_in:.1f} 0 {large} 0 '
            f'{x1i:.1f},{y1i:.1f} Z" fill="{color}" stroke="white" stroke-width="2"/>'
        )
        # Porcentaje sobre el sector (si es legible)
        if frac >= 0.06:
            mid = (a0 + a1) / 2
            rx = cx + (r_out + r_in) / 2 * math.cos(mid)
            ry = cy + (r_out + r_in) / 2 * math.sin(mid)
            parts.append(
                f'<text x="{rx:.1f}" y="{ry + 4:.1f}" text-anchor="middle" fill="white" '
                f'font-weight="700" font-size="12">{frac * 100:.0f}%</text>'
            )

    # Total al centro
    parts.append(
        f'<text x="{cx:.1f}" y="{cy - 2:.1f}" text-anchor="middle" fill="#0F1116" '
        f'font-display="true" font-weight="700" font-size="22">{_fmt(total)}</text>'
    )
    parts.append(
        f'<text x="{cx:.1f}" y="{cy + 16:.1f}" text-anchor="middle" fill="#5B6275" '
        f'font-size="10.5">total</text>'
    )

    # Leyenda a la derecha con valores
    lx = cx + r_out + 56
    ly = cy - (len(rows) * 26) / 2 + 8
    for i, (lbl, v) in enumerate(rows):
        hl = _is_highlighted(lbl, destacar)
        color = BRAND_COLORS[i % len(BRAND_COLORS)]
        if destacar:
            color = HIGHLIGHT if hl else MUTED
        y = ly + i * 26
        parts.append(f'<rect x="{lx}" y="{y - 11}" width="12" height="12" fill="{color}" rx="3"/>')
        parts.append(
            f'<text x="{lx + 18}" y="{y}" fill="{HIGHLIGHT if hl else "#2A2F3A"}" '
            f'font-size="12.5"{" font-weight=\"700\"" if hl else ""}>{_esc(lbl)}'
            f' — {_fmt(v)} ({v / total * 100:.0f}%)</text>'
        )


def spec_to_markdown_table(spec: dict) -> str:
    """Tabla Markdown con los datos del gráfico (respaldo para Word y lectura)."""
    series = [s for s in (spec.get("series") or []) if s.get("points")][:6]
    if not series:
        return ""
    labels: list[str] = []
    for s in series:
        for p in s["points"]:
            lbl = str(p.get("label", ""))[:24]
            if lbl not in labels:
                labels.append(lbl)
    header = "| " + " | ".join(["Categoría"] + [str(s.get("name") or f"Serie {i+1}") for i, s in enumerate(series)]) + " |"
    sep = "|" + "---|" * (len(series) + 1)
    rows = []
    for lbl in labels[:14]:
        cells = [lbl]
        for s in series:
            v = next((p.get("value") for p in s["points"] if str(p.get("label", ""))[:24] == lbl), "")
            cells.append(_fmt(float(v)) if v not in ("", None) else "")
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join([header, sep, *rows])
