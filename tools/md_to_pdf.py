import re
import sys
import html

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate,
    PageTemplate,
    Frame,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    ListFlowable,
    ListItem,
    HRFlowable,
    KeepTogether,
)

INK = colors.HexColor("#142B35")
PRIMARY = colors.HexColor("#247A6B")
ACCENT = colors.HexColor("#B34D2D")
MUTED = colors.HexColor("#52625F")
LINE = colors.HexColor("#DED8CC")
PAPER = colors.HexColor("#FAF7F0")

styles = getSampleStyleSheet()


def make_styles():
    s = {}
    s["title"] = ParagraphStyle("title", parent=styles["Title"], fontName="Helvetica-Bold",
                                fontSize=24, leading=28, textColor=INK, spaceAfter=6)
    s["subtitle"] = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=11,
                                    leading=15, textColor=MUTED, spaceAfter=18)
    s["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16, leading=20,
                             textColor=PRIMARY, spaceBefore=16, spaceAfter=8)
    s["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
                             textColor=INK, spaceBefore=12, spaceAfter=5)
    s["h3"] = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=11, leading=14,
                             textColor=ACCENT, spaceBefore=9, spaceAfter=3)
    s["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5,
                               textColor=INK, spaceAfter=5, alignment=4)
    s["li"] = ParagraphStyle("li", parent=s["body"], spaceAfter=2, alignment=0)
    s["cell"] = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, leading=11,
                               textColor=INK)
    s["cellhead"] = ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=8.5,
                                   leading=11, textColor=colors.white)
    return s


def inline(text):
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier" size="8.5">\1</font>', text)
    return text


def parse(md, S):
    flow = []
    lines = md.split("\n")
    i = 0
    first_h1_seen = False
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("# "):
            flow.append(Paragraph(inline(stripped[2:]), S["title"]))
            i += 1
            continue
        if stripped == "---":
            flow.append(Spacer(1, 3))
            flow.append(HRFlowable(width="100%", thickness=0.6, color=LINE,
                                   spaceBefore=2, spaceAfter=6))
            i += 1
            continue
        if stripped.startswith("## "):
            flow.append(Paragraph(inline(stripped[3:]), S["h1"]))
            i += 1
            continue
        if stripped.startswith("### "):
            flow.append(Paragraph(inline(stripped[4:]), S["h2"]))
            i += 1
            continue

        # table
        if stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip()
                if re.match(r"^\|[\s:|-]+\|$", raw):
                    i += 1
                    continue
                cells = [c.strip() for c in raw.strip("|").split("|")]
                rows.append(cells)
                i += 1
            flow.append(build_table(rows, S))
            flow.append(Spacer(1, 6))
            continue

        # bullet list
        if stripped.startswith("- "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(ListItem(Paragraph(inline(lines[i].strip()[2:]), S["li"]),
                                      leftIndent=6, value="•"))
                i += 1
            flow.append(ListFlowable(items, bulletType="bullet", start="•",
                                     leftIndent=12, bulletColor=PRIMARY))
            flow.append(Spacer(1, 4))
            continue

        # numbered list
        if re.match(r"^\d+\.\s", stripped):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                txt = re.sub(r"^\d+\.\s", "", lines[i].strip())
                items.append(ListItem(Paragraph(inline(txt), S["li"]), leftIndent=6))
                i += 1
            flow.append(ListFlowable(items, bulletType="1", leftIndent=14,
                                     bulletColor=PRIMARY))
            flow.append(Spacer(1, 4))
            continue

        flow.append(Paragraph(inline(stripped), S["body"]))
        i += 1
    return flow


def build_table(rows, S):
    header, body = rows[0], rows[1:]
    data = [[Paragraph(inline(c), S["cellhead"]) for c in header]]
    for r in body:
        data.append([Paragraph(inline(c), S["cell"]) for c in r])
    ncols = len(header)
    avail = 170 * mm
    if ncols == 2:
        widths = [avail * 0.32, avail * 0.68]
    else:
        widths = [avail / ncols] * ncols
    t = Table(data, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("LINEAFTER", (0, 0), (-2, -1), 0.4, LINE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
    ]
    for ridx in range(1, len(data)):
        if ridx % 2 == 0:
            style.append(("BACKGROUND", (0, ridx), (-1, ridx), PAPER))
    t.setStyle(TableStyle(style))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 12 * mm, "SMF Travel - Guida al collaudo manuale")
    canvas.drawRightString(190 * mm, 12 * mm, "Pagina %d" % doc.page)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.restoreState()


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        md = f.read()
    S = make_styles()
    # subtitle: turn the first paragraph after title into subtitle handled generically
    doc = BaseDocTemplate(dst, pagesize=A4,
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=18 * mm, bottomMargin=20 * mm,
                          title="SMF Travel - Guida al collaudo manuale")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
    flow = parse(md, S)
    doc.build(flow)
    print("PDF creato:", dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
