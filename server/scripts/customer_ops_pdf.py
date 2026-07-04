#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
)


def pct(v):
    try:
        return f"{float(v) * 100:.1f}%"
    except Exception:
        return "-"


def money(v):
    try:
        return f"RMB {float(v):,.0f}"
    except Exception:
        return "RMB 0"


def count(v):
    try:
        return f"{int(float(v)):,}"
    except Exception:
        return "0"


def label_stage(k):
    return {
        "regular": "常来客",
        "one_time": "来一次客",
        "occasional": "偶尔来",
        "at_risk": "濒临流失",
        "dormant": "沉睡客",
    }.get(str(k), str(k))


def label_scene(k):
    return {
        "high_value": "高消费客",
        "business": "商务客",
        "family": "家庭客",
        "risk": "流失风险",
    }.get(str(k), str(k))


def para(text, style):
    return Paragraph(str(text or "").replace("\n", "<br/>"), style)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: customer_ops_pdf.py output.pdf")
    out = Path(sys.argv[1])
    data = json.loads(sys.stdin.read() or "{}")
    font_name = "CustomerOpsCN"
    font_candidates = [
        ("/System/Library/Fonts/STHeiti Light.ttc", 0),
        ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
        ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", None),
        ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
        ("/usr/share/fonts/truetype/arphic/uming.ttc", 0),
    ]
    registered = False
    for font_path, subfont in font_candidates:
        if not Path(font_path).exists():
            continue
        try:
            if subfont is None:
                pdfmetrics.registerFont(TTFont(font_name, font_path))
            else:
                pdfmetrics.registerFont(TTFont(font_name, font_path, subfontIndex=subfont))
            registered = True
            break
        except Exception:
            continue
    if not registered:
        font_name = "STSong-Light"
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleCN", parent=styles["Title"], fontName=font_name,
        fontSize=22, leading=28, alignment=TA_CENTER, textColor=colors.HexColor("#111827")
    )
    h2 = ParagraphStyle(
        "H2CN", parent=styles["Heading2"], fontName=font_name,
        fontSize=14, leading=18, textColor=colors.HexColor("#0f766e"), spaceBefore=8, spaceAfter=6
    )
    body = ParagraphStyle(
        "BodyCN", parent=styles["BodyText"], fontName=font_name,
        fontSize=9.5, leading=14, alignment=TA_LEFT, textColor=colors.HexColor("#1f2937")
    )
    small = ParagraphStyle(
        "SmallCN", parent=body, fontSize=8, leading=11, textColor=colors.HexColor("#6b7280")
    )

    doc = SimpleDocTemplate(
        str(out), pagesize=A4, rightMargin=16 * mm, leftMargin=16 * mm,
        topMargin=15 * mm, bottomMargin=14 * mm
    )
    story = []

    store = data.get("store_name") or "未命名门店"
    story.append(para(f"{store} 客户经营诊断报告", title))
    q = data.get("input_quality", {})
    story.append(para(f"数据范围：{q.get('date_start') or '-'} 至 {q.get('date_end') or '-'} · 有效订单 {count(q.get('valid_orders'))} · 客户 {count(q.get('customers'))}", small))
    story.append(Spacer(1, 8))

    b = data.get("business", {})
    metrics = [
        ["营业额", money(b.get("revenue")), "订单数", count(b.get("orders"))],
        ["客户数", count(b.get("customers")), "平均客单", money(b.get("avg_check"))],
        ["复购客户占比", pct(b.get("customer_repeat_rate")), "客流稳定性", f"{count(b.get('revenue_stability_score'))}/100"],
    ]
    t = Table(metrics, colWidths=[30 * mm, 48 * mm, 30 * mm, 48 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#111827")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)

    cleaning = (q.get("cleaning") or {})
    story.append(para("POS数据清洗可信度", h2))
    missing = "、".join(cleaning.get("missing_required") or []) or "无"
    warnings = "；".join(cleaning.get("warnings") or []) or "无"
    story.append(para(f"系统清洗置信度：{cleaning.get('confidence_score', 0)}/100 · 缺失关键字段：{missing} · 提醒：{warnings}", small))
    sheet_rows = [["Sheet", "表头行", "数据行", "手机号", "日期", "金额", "菜品"]]
    for s in (cleaning.get("sheets") or [])[:5]:
        mp = s.get("mapping") or {}
        def src(k):
            m = mp.get(k) or {}
            return f"{m.get('source_header') or '-'} {m.get('confidence') or 0}%"
        sheet_rows.append([s.get("sheet_name") or "-", count(s.get("header_row") or 1), count(s.get("rows") or 0), src("phone"), src("bizDate"), src("amount"), src("dish")])
    if len(sheet_rows) == 1:
        sheet_rows.append(["-", "-", "-", "-", "-", "-", "-"])
    story.append(Table(sheet_rows, colWidths=[26 * mm, 18 * mm, 18 * mm, 28 * mm, 28 * mm, 28 * mm, 28 * mm], style=[
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#334155")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    story.append(para("一、客人资产结构", h2))
    mix = data.get("customer_mix", {})
    lifecycle = mix.get("lifecycle") or {}
    scene = mix.get("scene") or {}
    rows = [["客群", "人数", "占比"]]
    total_c = max(1, int(q.get("customers") or sum(lifecycle.values() or [0]) or 1))
    for k, v in lifecycle.items():
        rows.append([label_stage(k), count(v), pct(float(v) / total_c)])
    if len(rows) == 1:
        rows.append(["暂无可识别客群", "0", "-"])
    story.append(Table(rows, colWidths=[60 * mm, 40 * mm, 50 * mm], style=[
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    story.append(para("二、经营结构", h2))
    daypart = b.get("daypart") or {}
    weekday = b.get("weekday") or {}
    rows = [["维度", "营业额", "订单数", "占营业额"]]
    total_rev = max(1.0, float(b.get("revenue") or 0) or 1.0)
    for key, name in [("lunch", "午市"), ("dinner", "晚市"), ("other", "其他时段")]:
        x = daypart.get(key) or {}
        rows.append([name, money(x.get("revenue")), count(x.get("orders")), pct(float(x.get("revenue") or 0) / total_rev)])
    for key, name in [("weekday", "平日"), ("weekend", "周末")]:
        x = weekday.get(key) or {}
        rows.append([name, money(x.get("revenue")), count(x.get("orders")), pct(float(x.get("revenue") or 0) / total_rev)])
    story.append(Table(rows, colWidths=[45 * mm, 45 * mm, 30 * mm, 35 * mm], style=[
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    story.append(para("三、建议优先维护动作", h2))
    ops = data.get("opportunities") or []
    if not ops:
        story.append(para("本次数据暂未识别出足够明确的自动维护人群。建议补充手机号、订单明细、商品明细后重新导入。", body))
    else:
        rows = [["维护场景", "目标人数", "推荐渠道", "预计收入"]]
        for op in ops[:8]:
            rows.append([op.get("title"), count(op.get("target_count")), " / ".join(op.get("channels") or []), money(op.get("expected_revenue"))])
        story.append(Table(rows, colWidths=[58 * mm, 25 * mm, 45 * mm, 32 * mm], style=[
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#7c2d12")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d1d5db")),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))

    story.append(PageBreak())
    story.append(para("四、重点客人样本", h2))
    top = (mix.get("top_customers") or [])[:20]
    rows = [["客户ID", "手机号", "消费次数", "累计消费", "最近消费", "偏好", "标签"]]
    for c in top:
        rows.append([
            c.get("customer_id"), c.get("phone") or "-",
            count(c.get("order_count")), money(c.get("total_spend")),
            f"{count(c.get('days_since_last_visit'))}天前",
            "、".join((c.get("favorite_dishes") or [])[:2]) or "-",
            "、".join([label_scene(x) for x in (c.get("scene_tags") or [])]) or label_stage(c.get("lifecycle_stage"))
        ])
    if len(rows) == 1:
        rows.append(["-", "-", "-", "-", "-", "-", "-"])
    story.append(Table(rows, colWidths=[20 * mm, 26 * mm, 20 * mm, 27 * mm, 22 * mm, 35 * mm, 34 * mm], repeatRows=1, style=[
        ("FONTNAME", (0, 0), (-1, -1), font_name),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#374151")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))

    story.append(Spacer(1, 10))
    story.append(para("说明：本报告基于客户提供的POS Excel数据自动清洗生成。若原始表缺少手机号、菜品明细或门店字段，对应画像和偏好判断会降低置信度。", small))

    doc.build(story)


if __name__ == "__main__":
    main()
