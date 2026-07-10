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

WIDTH, HEIGHT = 880, 440
MARGIN_L, MARGIN_R, MARGIN_T, MARGIN_B = 70, 30, 44, 88


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
    """spec = {type: 'bar'|'line', y_label?, series: [{name, points: [{label, value}]}]}"""
    chart_type = (spec.get("type") or "bar").lower()
    series = spec.get("series") or []
    series = [s for s in series if s.get("points")][:6]
    if not series:
        raise ValueError("El gráfico no tiene series con datos")

    labels: list[str] = []
    for s in series:
        for p in s["points"]:
            lbl = str(p.get("label", ""))[:24]
            if lbl not in labels:
                labels.append(lbl)
    labels = labels[:14]

    values: dict[tuple[int, str], float] = {}
    max_val = 0.0
    for i, s in enumerate(series):
        for p in s["points"]:
            lbl = str(p.get("label", ""))[:24]
            if lbl in labels:
                try:
                    v = float(p.get("value", 0) or 0)
                except (TypeError, ValueError):
                    v = 0.0
                values[(i, lbl)] = v
                max_val = max(max_val, v)

    y_max = _nice_max(max_val * 1.15)
    plot_w = WIDTH - MARGIN_L - MARGIN_R
    plot_h = HEIGHT - MARGIN_T - MARGIN_B

    def sx(idx: int) -> float:
        return MARGIN_L + plot_w * (idx + 0.5) / len(labels)

    def sy(val: float) -> float:
        return MARGIN_T + plot_h * (1 - val / y_max)

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" '
        f'font-family="Segoe UI, Arial, sans-serif" font-size="12">',
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="white"/>',
    ]

    # Grilla y eje Y
    for i in range(6):
        y_val = y_max * i / 5
        y = sy(y_val)
        parts.append(
            f'<line x1="{MARGIN_L}" y1="{y:.1f}" x2="{WIDTH - MARGIN_R}" y2="{y:.1f}" '
            f'stroke="#E5E7EB" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{MARGIN_L - 8}" y="{y + 4:.1f}" text-anchor="end" fill="#5B6275">{_fmt(y_val)}</text>'
        )

    # Etiquetas X (rotadas si son largas)
    rotate = any(len(l) > 8 for l in labels) or len(labels) > 8
    for idx, lbl in enumerate(labels):
        x = sx(idx)
        y = HEIGHT - MARGIN_B + 18
        if rotate:
            parts.append(
                f'<text x="{x:.1f}" y="{y}" text-anchor="end" fill="#2A2F3A" '
                f'transform="rotate(-35 {x:.1f} {y})">{_esc(lbl)}</text>'
            )
        else:
            parts.append(f'<text x="{x:.1f}" y="{y}" text-anchor="middle" fill="#2A2F3A">{_esc(lbl)}</text>')

    if chart_type == "line":
        for i, s in enumerate(series):
            color = BRAND_COLORS[i % len(BRAND_COLORS)]
            pts = []
            for idx, lbl in enumerate(labels):
                v = values.get((i, lbl))
                if v is not None:
                    pts.append((sx(idx), sy(v)))
            if len(pts) >= 2:
                path = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
                parts.append(
                    f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2.5"/>'
                )
            for x, y in pts:
                parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="{color}"/>')
    else:  # bar (agrupadas)
        group_w = plot_w / len(labels) * 0.72
        bar_w = group_w / len(series)
        for idx, lbl in enumerate(labels):
            x0 = sx(idx) - group_w / 2
            for i in range(len(series)):
                v = values.get((i, lbl))
                if v is None:
                    continue
                color = BRAND_COLORS[i % len(BRAND_COLORS)]
                x = x0 + i * bar_w
                y = sy(v)
                h = HEIGHT - MARGIN_B - y
                parts.append(
                    f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w * 0.9:.1f}" height="{max(h, 0):.1f}" '
                    f'fill="{color}" rx="2"/>'
                )
                if len(labels) * len(series) <= 16:
                    parts.append(
                        f'<text x="{x + bar_w * 0.45:.1f}" y="{y - 5:.1f}" text-anchor="middle" '
                        f'fill="#2A2F3A" font-weight="600" font-size="11">{_fmt(v)}</text>'
                    )

    # Leyenda
    if len(series) > 1:
        lx = MARGIN_L
        for i, s in enumerate(series):
            color = BRAND_COLORS[i % len(BRAND_COLORS)]
            name = _esc(s.get("name") or f"Serie {i + 1}")
            parts.append(f'<rect x="{lx}" y="14" width="12" height="12" fill="{color}" rx="2"/>')
            parts.append(f'<text x="{lx + 17}" y="24" fill="#2A2F3A">{name}</text>')
            lx += 17 + 8 * len(name) + 24

    # Etiqueta del eje Y
    if spec.get("y_label"):
        parts.append(
            f'<text x="14" y="{MARGIN_T + plot_h / 2:.0f}" text-anchor="middle" fill="#5B6275" '
            f'transform="rotate(-90 14 {MARGIN_T + plot_h / 2:.0f})">{_esc(spec["y_label"])}</text>'
        )

    parts.append(
        f'<text x="{WIDTH - MARGIN_R}" y="{HEIGHT - 8}" text-anchor="end" fill="#9CA3AF" '
        f'font-size="10">VEX Consulting · Voicenter S.A.</text>'
    )
    parts.append("</svg>")
    return "".join(parts)


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
