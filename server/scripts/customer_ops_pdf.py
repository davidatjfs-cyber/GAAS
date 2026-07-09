#!/usr/bin/env python3
"""
餐厅经营诊断报告 PDF 生成器
目标读者：餐厅老板（非技术决策者）
风格：专业顾问报告，有 AI 叙述段落
"""
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)

W, H = A4

# ─── 颜色 ───────────────────────────────────────────────────────────
C_NAVY  = colors.HexColor("#0f172a")   # 深蓝
C_TEAL  = colors.HexColor("#0d9488")   # 品牌绿
C_AMBER = colors.HexColor("#d97706")   # 警告橙
C_RED   = colors.HexColor("#dc2626")   # 危险红
C_SLATE = colors.HexColor("#334155")   # 深灰标题
C_MUTED = colors.HexColor("#64748b")   # 浅灰注释
C_BG    = colors.HexColor("#f8fafc")   # 卡片背景
C_LINE  = colors.HexColor("#e2e8f0")   # 分割线
C_WHITE = colors.white


def pct(v, mul=100):
    try:
        return f"{float(v) * mul:.1f}%"
    except Exception:
        return "-"


def money(v, unit="¥"):
    try:
        f = float(v)
        if f >= 10000:
            return f"{unit}{f / 10000:.1f}万"
        return f"{unit}{f:,.0f}"
    except Exception:
        return f"{unit}0"


def count(v):
    try:
        return f"{int(float(v)):,}"
    except Exception:
        return "0"


def label_stage(k):
    return {
        "regular":    "忠诚常客",
        "one_time":   "一次性客",
        "occasional": "偶尔来客",
        "at_risk":    "预警流失",
        "dormant":    "沉睡客户",
    }.get(str(k), str(k))


def label_scene(k):
    return {
        "high_value":     "高消费客",
        "business":       "商务客",
        "family":         "家庭客",
        "risk":           "流失风险",
        "price_sensitive": "价格敏感",
    }.get(str(k), str(k))


def para(text, style):
    return Paragraph(str(text or "").replace("\n", "<br/>"), style)


def divider(color=C_LINE, thickness=0.6, spaceB=4, spaceA=4):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceAfter=spaceA, spaceBefore=spaceB)


def make_styles(font_name):
    base = ParagraphStyle("Base", fontName=font_name, fontSize=9.5, leading=15,
                          textColor=C_NAVY, alignment=TA_LEFT)
    return {
        "cover_title": ParagraphStyle("CoverTitle", parent=base, fontSize=28, leading=36,
                                      alignment=TA_CENTER, textColor=C_WHITE, spaceAfter=4),
        "cover_sub":   ParagraphStyle("CoverSub",   parent=base, fontSize=13, leading=20,
                                      alignment=TA_CENTER, textColor=colors.HexColor("#cbd5e1"), spaceAfter=0),
        "cover_date":  ParagraphStyle("CoverDate",  parent=base, fontSize=10, leading=14,
                                      alignment=TA_CENTER, textColor=colors.HexColor("#94a3b8"), spaceAfter=0),
        "section_h":   ParagraphStyle("SectionH",   parent=base, fontSize=14, leading=20,
                                      textColor=C_TEAL, spaceBefore=14, spaceAfter=6,
                                      borderPadding=(0, 0, 3, 0)),
        "card_label":  ParagraphStyle("CardLabel",  parent=base, fontSize=8.5, leading=12,
                                      textColor=C_MUTED),
        "card_value":  ParagraphStyle("CardValue",  parent=base, fontSize=22, leading=28,
                                      textColor=C_NAVY),
        "card_value_accent": ParagraphStyle("CardValueAccent", parent=base, fontSize=22, leading=28,
                                      textColor=C_TEAL),
        "card_unit":   ParagraphStyle("CardUnit",   parent=base, fontSize=10, leading=14,
                                      textColor=C_MUTED),
        "body":        ParagraphStyle("Body",       parent=base, fontSize=9.5, leading=15,
                                      alignment=TA_JUSTIFY),
        "body_bold":   ParagraphStyle("BodyBold",   parent=base, fontSize=9.5, leading=15,
                                      textColor=C_SLATE),
        "caption":     ParagraphStyle("Caption",    parent=base, fontSize=8, leading=12,
                                      textColor=C_MUTED),
        "exec_box":    ParagraphStyle("ExecBox",    parent=base, fontSize=10, leading=16,
                                      textColor=C_NAVY, alignment=TA_JUSTIFY),
        "finding_h":   ParagraphStyle("FindingH",   parent=base, fontSize=10.5, leading=15,
                                      textColor=C_SLATE),
        "finding_b":   ParagraphStyle("FindingB",   parent=base, fontSize=9.5, leading=14,
                                      textColor=C_MUTED, spaceBefore=2),
        "rec_h":       ParagraphStyle("RecH",       parent=base, fontSize=9.5, leading=14,
                                      textColor=C_TEAL),
        "rec_b":       ParagraphStyle("RecB",       parent=base, fontSize=9, leading=13,
                                      textColor=C_MUTED, spaceBefore=2),
        "table_hdr":   ParagraphStyle("TableHdr",   parent=base, fontSize=8.5, leading=12,
                                      textColor=C_WHITE, alignment=TA_CENTER),
        "table_cell":  ParagraphStyle("TableCell",  parent=base, fontSize=8.5, leading=12,
                                      textColor=C_NAVY),
        "small":       ParagraphStyle("Small",      parent=base, fontSize=8, leading=12,
                                      textColor=C_MUTED),
    }


def hdr_style(colWidths, bgColor=C_SLATE):
    return [
        ("BACKGROUND", (0, 0), (-1, 0), bgColor),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_BG]),
        ("GRID", (0, 0), (-1, -1), 0.3, C_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ]


def register_font():
    font_name = "CustomerOpsCN"
    candidates = [
        ("/System/Library/Fonts/STHeiti Light.ttc", 0),
        ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", None),
        ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
        ("/usr/share/fonts/truetype/arphic/uming.ttc", 0),
    ]
    for path, idx in candidates:
        if not Path(path).exists():
            continue
        try:
            if idx is None:
                pdfmetrics.registerFont(TTFont(font_name, path))
            else:
                pdfmetrics.registerFont(TTFont(font_name, path, subfontIndex=idx))
            return font_name
        except Exception:
            continue
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    return "STSong-Light"


class CoverCanvas:
    """封面页背景绘制回调（通过 doc.build(onFirstPage=...) 触发，绘制满版背景，
    不再走 story 里的 Table 拼凑方案——Table 高度只会撑到内容需要的高度，
    留下大片空白，是之前封面下半页空白的根因）。"""
    def __init__(self, store_name, date_range, subtitle, font_name):
        self.store = store_name
        self.date_range = date_range
        self.subtitle = subtitle
        self.fn = font_name

    def __call__(self, canvas, doc):
        canvas.saveState()
        # 深色满版背景
        canvas.setFillColor(C_NAVY)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        # 细腻的几何装饰：右上角与左下角描边方框，增加高级感层次
        canvas.setStrokeColor(colors.HexColor("#1e293b"))
        canvas.setLineWidth(1)
        canvas.rect(14 * mm, 14 * mm, W - 28 * mm, H - 28 * mm, fill=0, stroke=1)
        # 品牌绿色主色条（贯穿全宽的细横线，作为视觉锚点）
        canvas.setFillColor(C_TEAL)
        canvas.rect(0, H * 0.44, W, 2.2, fill=1, stroke=0)
        # 顶部小标签
        canvas.setFillColor(C_TEAL)
        canvas.setFont(self.fn, 10)
        canvas.drawCentredString(W / 2, H * 0.68, "HRMS · 餐厅增长闭环")
        # 主标题
        canvas.setFillColor(C_WHITE)
        canvas.setFont(self.fn, 32)
        canvas.drawCentredString(W / 2, H * 0.58, f"{self.store}")
        canvas.setFont(self.fn, 17)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawCentredString(W / 2, H * 0.51, "客户经营诊断报告")
        canvas.setFont(self.fn, 10.5)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawCentredString(W / 2, H * 0.39, self.date_range)
        if self.subtitle:
            canvas.setFont(self.fn, 9.5)
            canvas.setFillColor(colors.HexColor("#94a3b8"))
            canvas.drawCentredString(W / 2, H * 0.355, self.subtitle)
        # 底部 logo 区
        canvas.setFillColor(colors.HexColor("#1e293b"))
        canvas.rect(0, 0, W, 20 * mm, fill=1, stroke=0)
        canvas.setFillColor(C_TEAL)
        canvas.setFont(self.fn, 9)
        canvas.drawCentredString(W / 2, 8.5 * mm, "本报告由 HRMS 客户资产管理系统自动生成 · 仅供内部决策参考")
        canvas.restoreState()


def normal_page(canvas, doc):
    """正文页页眉页脚"""
    canvas.saveState()
    canvas.setFillColor(C_TEAL)
    canvas.rect(0, H - 8 * mm, W, 8 * mm, fill=1, stroke=0)
    canvas.setFillColor(C_WHITE)
    canvas.setFont("CustomerOpsCN" if "CustomerOpsCN" in pdfmetrics.getRegisteredFontNames() else "STSong-Light", 8)
    canvas.drawString(16 * mm, H - 5.5 * mm, "HRMS 客户经营诊断报告")
    canvas.drawRightString(W - 16 * mm, H - 5.5 * mm, f"第 {doc.page - 1} 页")
    canvas.setFillColor(C_LINE)
    canvas.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    canvas.restoreState()


def build_kpi_row(labels_values, s, colW=42 * mm, accent_first=False):
    """生成一行 KPI 卡片，labels_values = [(label, value, unit_or_None)]。
    accent_first=True 时首个卡片数值用品牌绿高亮，用于突出本组最核心的指标。"""
    n = len(labels_values)
    cells = []
    for i, (label, value, unit) in enumerate(labels_values):
        value_style = s["card_value_accent"] if (accent_first and i == 0) else s["card_value"]
        inner = [
            [para(label, s["card_label"])],
            [para(value, value_style)],
        ]
        if unit:
            inner.append([para(unit, s["card_unit"])])
        t = Table(inner, colWidths=[colW - 4 * mm])
        t.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        cells.append(t)
    outer = Table([cells], colWidths=[colW] * n)
    outer.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), C_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, C_LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, C_LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer


def build_exec_box(text, s, accent=C_TEAL):
    """带左色条的执行摘要卡片"""
    inner = Table([[para(text, s["exec_box"])]], colWidths=[148 * mm])
    inner.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f0fdfa")),
    ]))
    stripe = Table([[""]], colWidths=[4 * mm])
    stripe.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    outer = Table([[stripe, inner]], colWidths=[4 * mm, 148 * mm])
    outer.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BOX", (0, 0), (-1, -1), 0.4, C_LINE),
    ]))
    return outer


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: customer_ops_pdf.py output.pdf")
    out = Path(sys.argv[1])
    data = json.loads(sys.stdin.read() or "{}")

    font_name = register_font()
    s = make_styles(font_name)

    b    = data.get("business", {})
    q    = data.get("input_quality", {})
    mix  = data.get("customer_mix", {})
    lc   = mix.get("lifecycle") or {}
    sc   = mix.get("scene") or {}
    narr = data.get("narrative") or {}
    store = str(data.get("store_name") or "未命名门店")
    date_start = str(q.get("date_start") or "-")
    date_end   = str(q.get("date_end")   or "-")
    date_range = f"数据周期：{date_start} 至 {date_end}"

    # ── 文档 ─────────────────────────────────────────────────────────
    doc = SimpleDocTemplate(
        str(out), pagesize=A4,
        rightMargin=16 * mm, leftMargin=16 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
    )
    story = []

    # ── 第1页：封面 ──────────────────────────────────────────────────
    # 封面背景通过 doc.build(onFirstPage=CoverCanvas(...)) 在画布上直接绘制满版深色背景，
    # 这里只需要放一个空的 PageBreak 占位，触发翻到正文页。
    cover_subtitle = f"有效订单 {count(q.get('valid_orders'))}　·　客户数 {count(q.get('customers'))}"
    story.append(Spacer(1, 1))
    story.append(PageBreak())

    # ── 第2页起：正文（带页眉） ───────────────────────────────────────

    # ── 执行摘要 ──────────────────────────────────────────────────────
    story.append(para("执行摘要", s["section_h"]))
    story.append(divider(C_TEAL, 1.5))
    exec_text = narr.get("executive_summary") or (
        f"本次分析覆盖{date_start}至{date_end}，共 {count(q.get('customers'))} 名客户、"
        f"{count(q.get('valid_orders'))} 笔有效订单。"
        f"整体复购率为 {pct(b.get('customer_repeat_rate'))}，"
        f"平均客单价 {money(b.get('avg_check'))}。"
    )
    story.append(Spacer(1, 4))
    story.append(build_exec_box(exec_text, s))
    story.append(Spacer(1, 8))

    # ── KPI 卡片 ──────────────────────────────────────────────────────
    story.append(para("核心经营指标", s["section_h"]))
    story.append(divider())
    total_rev = float(b.get("revenue") or 0)
    kpis = [
        ("总营业额", money(total_rev), None),
        ("平均客单价", money(b.get("avg_check")), ""),
        ("复购率", pct(b.get("customer_repeat_rate")), ""),
        ("客流稳定性", f"{count(b.get('revenue_stability_score'))}", "/100分"),
    ]
    story.append(build_kpi_row(kpis, s, colW=41.5 * mm, accent_first=True))
    story.append(Spacer(1, 6))
    kpis2 = [
        ("总客户数", count(q.get("customers")), "人"),
        ("储值客户", count(b.get("stored_value", {}).get("customers")), "人"),
        ("储值在手余额", money(b.get("stored_value", {}).get("balance")), None),
        ("订单量", count(b.get("orders")), "笔"),
    ]
    story.append(build_kpi_row(kpis2, s, colW=41.5 * mm))
    story.append(Spacer(1, 10))

    # ── 诊断发现 ──────────────────────────────────────────────────────
    findings = narr.get("findings") or []
    if findings:
        story.append(para("诊断发现", s["section_h"]))
        story.append(divider())
        for i, f in enumerate(findings[:4]):
            num_label = f"发现 {i + 1}"
            title_text = f.get("title") or num_label
            data_text  = f.get("data") or ""
            assess_text = f.get("assessment") or ""
            badge_color = [C_TEAL, C_AMBER, C_RED, C_SLATE][i % 4]
            badge = Table([[para(f" {num_label} ", ParagraphStyle("badge", fontName=font_name, fontSize=8, leading=12, textColor=C_WHITE))]],
                          colWidths=[16 * mm])
            badge.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), badge_color),
                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]))
            content = Table(
                [[para(f"<b>{title_text}</b>", s["finding_h"])],
                 [para(data_text, s["finding_b"])],
                 [para(assess_text, s["body"])]],
                colWidths=[145 * mm]
            )
            content.setStyle(TableStyle([
                ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]))
            row = Table([[badge, content]], colWidths=[18 * mm, 145 * mm])
            row.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("BACKGROUND", (0, 0), (-1, -1), C_BG if i % 2 == 0 else C_WHITE),
                ("BOX", (0, 0), (-1, -1), 0.3, C_LINE),
            ]))
            story.append(KeepTogether(row))
            story.append(Spacer(1, 4))

    # ── 优先行动建议 ──────────────────────────────────────────────────
    recs = narr.get("recommendations") or []
    if recs:
        story.append(Spacer(1, 4))
        story.append(para("优先行动建议", s["section_h"]))
        story.append(divider(C_AMBER, 1.5))
        for i, r in enumerate(recs[:4]):
            action = r.get("action") or "-"
            result = r.get("expected_result") or ""
            idx_label = ["①", "②", "③", "④"][i]
            row_data = [[
                para(f"<b>{idx_label} {action}</b>", s["rec_h"]),
                para(f"→ {result}", s["rec_b"]),
            ]]
            rt = Table(row_data, colWidths=[88 * mm, 72 * mm])
            rt.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fffbeb") if i % 2 == 0 else C_WHITE),
                ("BOX", (0, 0), (-1, -1), 0.3, C_LINE),
                ("LINEAFTER", (0, 0), (0, -1), 0.3, C_LINE),
            ]))
            story.append(rt)
            story.append(Spacer(1, 3))

    story.append(PageBreak())

    # ── 第3页：客群结构 ───────────────────────────────────────────────
    story.append(para("一、客群结构", s["section_h"]))
    story.append(divider())
    total_c = max(1, sum(lc.values() or [0]) or 1)

    lc_rows = [[para("客群类型", s["table_hdr"]), para("人数", s["table_hdr"]), para("占比", s["table_hdr"]), para("说明", s["table_hdr"])]]
    explanations = {
        "regular":    "近期持续到访，是门店最核心的营收支柱",
        "occasional": "偶尔光顾，有进一步培养成常客的潜力",
        "one_time":   "仅消费一次，转化为回头客的关键机会",
        "at_risk":    "消费间隔超出正常周期，需优先触达挽留",
        "dormant":    "90天以上未到访，召回成本高但价值高",
    }
    for k, v in sorted(lc.items(), key=lambda x: -x[1]):
        lc_rows.append([
            para(label_stage(k), s["table_cell"]),
            para(count(v), s["table_cell"]),
            para(pct(float(v) / total_c), s["table_cell"]),
            para(explanations.get(k, ""), s["small"]),
        ])
    if len(lc_rows) == 1:
        lc_rows.append([para("-", s["table_cell"]), para("0", s["table_cell"]), para("-", s["table_cell"]), para("-", s["table_cell"])])
    lc_t = Table(lc_rows, colWidths=[38 * mm, 25 * mm, 25 * mm, 74 * mm])
    lc_t.setStyle(TableStyle(hdr_style(None, C_TEAL)))
    story.append(lc_t)
    story.append(Spacer(1, 8))

    # 场景标签
    if sc:
        story.append(para("消费场景分布", s["section_h"]))
        story.append(divider())
        sc_rows = [[para("场景标签", s["table_hdr"]), para("客户数", s["table_hdr"]), para("占总客户比", s["table_hdr"])]]
        for k, v in sorted(sc.items(), key=lambda x: -x[1]):
            sc_rows.append([para(label_scene(k), s["table_cell"]), para(count(v), s["table_cell"]), para(pct(float(v) / total_c), s["table_cell"])])
        sc_t = Table(sc_rows, colWidths=[60 * mm, 40 * mm, 62 * mm])
        sc_t.setStyle(TableStyle(hdr_style(None, C_SLATE)))
        story.append(sc_t)

    story.append(PageBreak())

    # ── 第4页：经营结构 ───────────────────────────────────────────────
    story.append(para("二、经营时段结构", s["section_h"]))
    story.append(divider())
    dp = b.get("daypart") or {}
    wd = b.get("weekday") or {}
    total_rev_f = max(1.0, float(b.get("revenue") or 0) or 1.0)

    dp_rows = [[para("时段", s["table_hdr"]), para("营业额", s["table_hdr"]), para("订单数", s["table_hdr"]), para("占比", s["table_hdr"]), para("诊断提示", s["table_hdr"])]]
    dp_hints = {
        "午市": "午市占比过低可考虑推出商务套餐或限时优惠",
        "晚市": "晚市是主力餐次，重点保障翻台率和出品稳定",
        "其他时段": "下午茶及宵夜时段，可作为差异化增量",
    }
    for key, name in [("lunch", "午市"), ("dinner", "晚市"), ("other", "其他时段")]:
        x = dp.get(key) or {}
        rev = float(x.get("revenue") or 0)
        dp_rows.append([
            para(name, s["table_cell"]),
            para(money(rev), s["table_cell"]),
            para(count(x.get("orders")), s["table_cell"]),
            para(pct(rev / total_rev_f), s["table_cell"]),
            para(dp_hints.get(name, ""), s["small"]),
        ])
    dp_t = Table(dp_rows, colWidths=[25 * mm, 35 * mm, 25 * mm, 22 * mm, 55 * mm])
    dp_t.setStyle(TableStyle(hdr_style(None, C_SLATE)))
    story.append(dp_t)
    story.append(Spacer(1, 10))

    wd_rows = [[para("日期类型", s["table_hdr"]), para("营业额", s["table_hdr"]), para("订单数", s["table_hdr"]), para("占比", s["table_hdr"])]]
    for key, name in [("weekday", "工作日"), ("weekend", "周末")]:
        x = wd.get(key) or {}
        rev = float(x.get("revenue") or 0)
        wd_rows.append([para(name, s["table_cell"]), para(money(rev), s["table_cell"]), para(count(x.get("orders")), s["table_cell"]), para(pct(rev / total_rev_f), s["table_cell"])])
    wd_t = Table(wd_rows, colWidths=[40 * mm, 45 * mm, 35 * mm, 42 * mm])
    wd_t.setStyle(TableStyle(hdr_style(None, C_SLATE)))
    story.append(para("工作日与周末分布", s["section_h"]))
    story.append(divider())
    story.append(wd_t)
    story.append(PageBreak())

    # ── 第5页：重点客户样本 ───────────────────────────────────────────
    story.append(para("三、重点客户样本（前20名）", s["section_h"]))
    story.append(divider())
    top = (mix.get("top_customers") or [])[:20]
    top_rows = [[
        para("客户ID", s["table_hdr"]),
        para("手机号", s["table_hdr"]),
        para("消费次数", s["table_hdr"]),
        para("累计消费", s["table_hdr"]),
        para("距上次(天)", s["table_hdr"]),
        para("偏好菜品", s["table_hdr"]),
        para("标签", s["table_hdr"]),
    ]]
    for c in top:
        tags = [label_scene(x) for x in (c.get("scene_tags") or [])]
        if not tags:
            tags = [label_stage(c.get("lifecycle_stage") or "")]
        top_rows.append([
            para(c.get("customer_id") or "-", s["table_cell"]),
            para(c.get("phone") or "-", s["table_cell"]),
            para(count(c.get("order_count")), s["table_cell"]),
            para(money(c.get("total_spend")), s["table_cell"]),
            para(count(c.get("days_since_last_visit")), s["table_cell"]),
            para("、".join((c.get("favorite_dishes") or [])[:2]) or "-", s["small"]),
            para("、".join(tags), s["small"]),
        ])
    if len(top_rows) == 1:
        top_rows.append([para("-", s["table_cell"])] * 7)
    top_t = Table(top_rows, colWidths=[20 * mm, 26 * mm, 18 * mm, 23 * mm, 18 * mm, 36 * mm, 21 * mm],
                  repeatRows=1)
    top_t.setStyle(TableStyle(hdr_style(None, colors.HexColor("#374151"))))
    story.append(top_t)
    story.append(Spacer(1, 10))
    story.append(divider())
    story.append(Spacer(1, 4))
    story.append(para(
        "说明：本报告基于客户提供的 POS Excel 数据自动清洗与分析生成。"
        "若原始数据缺少手机号、菜品明细或门店字段，对应画像和建议的置信度会相应降低。"
        "本报告中所有建议仅供参考，请结合实际经营情况综合判断。",
        s["small"]
    ))

    doc.build(story, onFirstPage=CoverCanvas(store, date_range, cover_subtitle, font_name), onLaterPages=normal_page)


if __name__ == "__main__":
    main()
