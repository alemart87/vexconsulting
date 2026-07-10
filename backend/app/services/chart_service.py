"""Render de gráficos a SVG con identidad Voicenter (sin dependencias externas).

El analista (GPT) produce una especificación JSON; acá se dibuja: barras
agrupadas o líneas multi-serie, con ejes, grilla, leyenda y valores.
El SVG se guarda como imagen del proyecto → se inserta en el documento y
viaja a la vista previa y al export PDF.
"""
from __future__ import annotations

import html
from typing import Any

BRAND_COLORS = ["#E6332A", "#00B2BF", "#662483", "#F39200", "#2A9D5C", "#5B6275"]

WIDTH, HEIGHT = 960, 560
MARGIN_L, MARGIN_R = 82, 36
# El margen superior/inferior se calcula según título/subtítulo/leyenda/fuente


def _esc(text: Any) -> str:
    return html.escape(str(text))[:60]


def _nice_max(value: float) -> float:
    if value <= 0:
        return 1.0
    import math

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


def render_chart_svg(spec: dict) -> str:
    """spec = {type: 'bar'|'line', title?, subtitle?, source?, y_label?,
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

    y_max = _nice_max(max_val * 1.12)

    # Layout vertical dinámico: título / subtítulo / leyenda / plot / eje X / fuente
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
    if len(series) > 1:
        y_cursor += 14
        legend_y = y_cursor
        y_cursor += 6
    margin_t = y_cursor + 14

    rotate = any(len(l) > 9 for l in labels) or len(labels) > 8
    x_band = 78 if rotate else 34
    margin_b = x_band + (26 if source else 14)

    plot_w = WIDTH - MARGIN_L - MARGIN_R
    plot_h = HEIGHT - margin_t - margin_b

    def sx(idx: int) -> float:
        return MARGIN_L + plot_w * (idx + 0.5) / len(labels)

    def sy(val: float) -> float:
        return margin_t + plot_h * (1 - val / y_max)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'font-family="Segoe UI, Arial, sans-serif" font-size="12.5">',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="white"/>',
        # Banda de marca superior
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

    # Leyenda (chips)
    if len(series) > 1:
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

    # Grilla horizontal y valores del eje Y
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

    # Etiquetas X
    x_base = margin_t + plot_h
    for idx, lbl in enumerate(labels):
        x = sx(idx)
        parts.append(
            f'<line x1="{x:.1f}" y1="{x_base:.1f}" x2="{x:.1f}" y2="{x_base + 4:.1f}" '
            f'stroke="#D7DAE0" stroke-width="1"/>'
        )
        if rotate:
            parts.append(
                f'<text x="{x:.1f}" y="{x_base + 16}" text-anchor="end" fill="#2A2F3A" '
                f'font-size="11.5" transform="rotate(-38 {x:.1f} {x_base + 16})">{_esc(lbl)}</text>'
            )
        else:
            parts.append(
                f'<text x="{x:.1f}" y="{x_base + 20}" text-anchor="middle" '
                f'fill="#2A2F3A" font-size="11.5">{_esc(lbl)}</text>'
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
                # Área sutil bajo la línea (solo primera serie, para no ensuciar)
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
            for i in range(len(series)):
                v = values.get((i, lbl))
                if v is None:
                    continue
                color = BRAND_COLORS[i % len(BRAND_COLORS)]
                x = x0 + i * bar_w
                y = sy(v)
                h = x_base - y
                parts.append(
                    f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w * 0.88:.1f}" '
                    f'height="{max(h, 0):.1f}" fill="{color}" rx="3"/>'
                )
                if show_values:
                    parts.append(
                        f'<text x="{x + bar_w * 0.44:.1f}" y="{y - 6:.1f}" text-anchor="middle" '
                        f'fill="#2A2F3A" font-weight="700" font-size="11">{_fmt(v)}</text>'
                    )

    # Etiqueta del eje Y (unidad)
    if y_label:
        mid_y = margin_t + plot_h / 2
        parts.append(
            f'<text x="18" y="{mid_y:.0f}" text-anchor="middle" fill="#5B6275" font-size="12" '
            f'font-weight="600" transform="rotate(-90 18 {mid_y:.0f})">{_esc(y_label)}</text>'
        )

    # Fuente + marca
    footer_y = HEIGHT - 10
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


def _esc_long(text: Any, max_len: int) -> str:
    return html.escape(str(text))[:max_len]


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
