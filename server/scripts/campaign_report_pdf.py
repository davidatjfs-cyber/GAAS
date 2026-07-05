#!/usr/bin/env python3
"""
营销活动执行报告 PDF 生成器
目标读者：品牌方/加盟商，用于证明门店的营销执行动作与效果
风格：与 customer_ops_pdf.py 保持一致的顾问报告视觉语言
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)

from customer_ops_pdf import (
    W, H, C_NAVY, C_TEAL, C_AMBER, C_RED, C_SLATE, C_MUTED, C_BG, C_LINE, C_WHITE,
    money, count, para, divider, make_styles, hdr_style, register_font,
    build_kpi_row, build_exec_box,
)


def campaign_page(canvas, doc):
    """正文页页眉页脚（营销活动报告专用标题）"""
    canvas.saveState()
    canvas.setFillColor(C_TEAL)
    canvas.rect(0, H - 8 * mm, W, 8 * mm, fill=1, stroke=0)
    canvas.setFillColor(C_WHITE)
    canvas.setFont("CustomerOpsCN" if "CustomerOpsCN" in pdfmetrics.getRegisteredFontNames() else "STSong-Light", 8)
    canvas.drawString(16 * mm, H - 5.5 * mm, "HRMS 营销活动执行报告")
    canvas.drawRightString(W - 16 * mm, H - 5.5 * mm, f"第 {doc.page - 1} 页")
    canvas.setFillColor(C_LINE)
    canvas.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    canvas.restoreState()

EFFECT_LABELS = {
    "excellent": "优秀",
    "meets": "达标",
    "below": "不达标",
    "blacklist": "黑名单",
}
EFFECT_COLORS = {
    "excellent": C_TEAL,
    "meets": colors.HexColor("#0284c7"),
    "below": C_AMBER,
    "blacklist": C_RED,
}
STATUS_LABELS = {
    "planned": "计划中",
    "in_progress": "进行中",
    "active": "进行中",
    "completed": "已完成",
    "paused": "已暂停",
    "cancelled": "已取消",
}


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: campaign_report_pdf.py output.pdf")
    out = Path(sys.argv[1])
    data = json.loads(sys.stdin.read() or "{}")

    font_name = register_font()
    s = make_styles(font_name)

    campaigns = data.get("campaigns") or []
    date_from = str(data.get("date_from") or "-")
    date_to = str(data.get("date_to") or "-")
    store_filter = str(data.get("store_filter") or "全部门店")
    generated_at = str(data.get("generated_at") or "-")
    date_range = f"数据周期：{date_from} 至 {date_to}　·　{store_filter}"

    # ── 汇总统计 ──────────────────────────────────────────────────────
    total_campaigns = len(campaigns)
    total_exposure = total_send = total_redeem = total_conv = 0
    total_revenue = total_cost = 0.0
    effect_counter = {"excellent": 0, "meets": 0, "below": 0, "blacklist": 0, "": 0}
    auto_count = 0
    for c in campaigns:
        if str(c.get("source") or "") == "auto":
            auto_count += 1
        for r in (c.get("results") or []):
            total_exposure += int(r.get("actual_exposure_count") or 0)
            total_send += int(r.get("actual_send_count") or 0)
            total_redeem += int(r.get("actual_redemption_count") or 0)
            total_conv += int(r.get("actual_conversion_count") or 0)
            total_revenue += float(r.get("actual_revenue") or 0)
            total_cost += float(r.get("actual_cost") or 0)
            eff = str(r.get("effect_rating") or "")
            effect_counter[eff] = effect_counter.get(eff, 0) + 1
    redeem_rate = f"{(total_redeem / total_send * 100):.1f}%" if total_send > 0 else "-"
    roi = f"{((total_revenue - total_cost) / total_cost):.2f}" if total_cost > 0 else "-"

    doc = SimpleDocTemplate(
        str(out), pagesize=A4,
        rightMargin=16 * mm, leftMargin=16 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
    )
    story = []

    # ── 封面 ─────────────────────────────────────────────────────────
    cover_bg = Table(
        [[para("营销活动执行报告", ParagraphStyle("ct", fontName=font_name, fontSize=26, leading=34, alignment=TA_CENTER, textColor=C_WHITE))],
         [para("Marketing Campaign Execution Report", ParagraphStyle("ce", fontName=font_name, fontSize=11, leading=16, alignment=TA_CENTER, textColor=colors.HexColor("#64748b")))],
         [Spacer(1, 8 * mm)],
         [para(date_range, ParagraphStyle("cs", fontName=font_name, fontSize=12, leading=18, alignment=TA_CENTER, textColor=colors.HexColor("#94a3b8")))],
         [para(f"活动总数 {total_campaigns}　·　自动执行 {auto_count} 个", ParagraphStyle("ci", fontName=font_name, fontSize=9.5, leading=14, alignment=TA_CENTER, textColor=colors.HexColor("#64748b")))],
         [Spacer(1, 50 * mm)],
         [para(f"生成时间：{generated_at}　·　本报告由 HRMS 客户资产管理系统自动生成",
               ParagraphStyle("cf", fontName=font_name, fontSize=8, leading=12, alignment=TA_CENTER, textColor=colors.HexColor("#64748b")))]],
        colWidths=[W - 32 * mm],
    )
    cover_bg.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), C_NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16 * mm),
        ("TOPPADDING", (0, 0), (0, 0), 48 * mm),
    ]))
    story.append(cover_bg)
    story.append(PageBreak())

    # ── 执行摘要 ──────────────────────────────────────────────────────
    story.append(para("执行摘要", s["section_h"]))
    story.append(divider(C_TEAL, 1.5))
    exec_text = (
        f"本报告统计{date_from}至{date_to}期间{store_filter}范围内共执行营销活动 {total_campaigns} 个"
        f"（其中系统自动执行 {auto_count} 个），累计触达 {count(total_send)} 人次，"
        f"核销 {count(total_redeem)} 单（核销率 {redeem_rate}），带动营业额 {money(total_revenue)}，"
        f"投入成本 {money(total_cost)}，综合 ROI {roi}。"
        f"效果评级中优秀 {effect_counter.get('excellent', 0)} 个、达标 {effect_counter.get('meets', 0)} 个、"
        f"不达标 {effect_counter.get('below', 0)} 个、黑名单 {effect_counter.get('blacklist', 0)} 个。"
    )
    story.append(Spacer(1, 4))
    story.append(build_exec_box(exec_text, s))
    story.append(Spacer(1, 8))

    # ── KPI 卡片 ──────────────────────────────────────────────────────
    story.append(para("核心执行指标", s["section_h"]))
    story.append(divider())
    kpis1 = [
        ("曝光人数", count(total_exposure), "人"),
        ("发送人数", count(total_send), "人"),
        ("核销单数", count(total_redeem), "单"),
        ("核销率", redeem_rate, None),
    ]
    story.append(build_kpi_row(kpis1, s, colW=41.5 * mm))
    story.append(Spacer(1, 6))
    kpis2 = [
        ("到店/转化", count(total_conv), "人"),
        ("带动营业额", money(total_revenue), None),
        ("活动成本", money(total_cost), None),
        ("综合ROI", roi, None),
    ]
    story.append(build_kpi_row(kpis2, s, colW=41.5 * mm))
    story.append(Spacer(1, 10))

    # ── 活动清单 ──────────────────────────────────────────────────────
    story.append(para("活动执行清单", s["section_h"]))
    story.append(divider())
    list_rows = [[
        para("活动名称", s["table_hdr"]), para("渠道", s["table_hdr"]), para("状态", s["table_hdr"]),
        para("执行时间", s["table_hdr"]), para("门店", s["table_hdr"]), para("来源", s["table_hdr"]),
    ]]
    for c in campaigns:
        store_ids = c.get("store_ids") or []
        if isinstance(store_ids, str):
            try:
                store_ids = json.loads(store_ids)
            except Exception:
                store_ids = []
        d_start = str(c.get("planned_date") or "")[:10]
        d_end = str(c.get("planned_end_date") or "")[:10]
        date_str = f"{d_start} → {d_end}" if d_start and d_end and d_end != d_start else (d_start or "未设置")
        list_rows.append([
            para(c.get("title") or "-", s["table_cell"]),
            para(c.get("channel") or "-", s["small"]),
            para(STATUS_LABELS.get(c.get("status"), c.get("status") or "-"), s["small"]),
            para(date_str, s["small"]),
            para("、".join(store_ids) if store_ids else "全部门店", s["small"]),
            para("自动执行" if str(c.get("source") or "") == "auto" else "人工创建", s["small"]),
        ])
    if len(list_rows) == 1:
        list_rows.append([para("-", s["table_cell"])] * 6)
    list_t = Table(list_rows, colWidths=[42 * mm, 20 * mm, 18 * mm, 32 * mm, 30 * mm, 22 * mm], repeatRows=1)
    list_t.setStyle(TableStyle(hdr_style(None, C_SLATE)))
    story.append(list_t)
    story.append(PageBreak())

    # ── 各活动详情与门店复盘 ──────────────────────────────────────────
    story.append(para("活动详情与门店复盘", s["section_h"]))
    story.append(divider(C_AMBER, 1.5))
    for i, c in enumerate(campaigns):
        results = c.get("results") or []
        title_text = c.get("title") or "-"
        goal_text = c.get("goal") or ""
        tag = "【自动执行】" if str(c.get("source") or "") == "auto" else ""
        header = Table(
            [[para(f"<b>{tag}{title_text}</b>", s["finding_h"])],
             [para(f"目标：{goal_text}" if goal_text else "未设置活动目标", s["finding_b"])]],
            colWidths=[163 * mm]
        )
        header.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), C_BG),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("BOX", (0, 0), (-1, -1), 0.3, C_LINE),
        ]))
        story.append(KeepTogether(header))

        if results:
            r_rows = [[
                para("门店", s["table_hdr"]), para("曝光", s["table_hdr"]), para("发送", s["table_hdr"]),
                para("核销", s["table_hdr"]), para("核销率", s["table_hdr"]), para("到店", s["table_hdr"]),
                para("收入", s["table_hdr"]), para("成本", s["table_hdr"]), para("ROI", s["table_hdr"]),
                para("效果", s["table_hdr"]),
            ]]
            for r in results:
                send = int(r.get("actual_send_count") or 0)
                redeem = int(r.get("actual_redemption_count") or 0)
                revenue = float(r.get("actual_revenue") or 0)
                cost = float(r.get("actual_cost") or 0)
                rate = f"{(redeem / send * 100):.1f}%" if send > 0 else "-"
                r_roi = f"{((revenue - cost) / cost):.2f}" if cost > 0 else "-"
                eff = str(r.get("effect_rating") or "")
                r_rows.append([
                    para(r.get("store_name") or r.get("store_id") or "-", s["table_cell"]),
                    para(count(r.get("actual_exposure_count")), s["table_cell"]),
                    para(count(send), s["table_cell"]),
                    para(count(redeem), s["table_cell"]),
                    para(rate, s["table_cell"]),
                    para(count(r.get("actual_conversion_count")), s["table_cell"]),
                    para(money(revenue), s["table_cell"]),
                    para(money(cost), s["table_cell"]),
                    para(r_roi, s["table_cell"]),
                    para(EFFECT_LABELS.get(eff, "-"), s["table_cell"]),
                ])
            r_t = Table(r_rows, colWidths=[22*mm, 15*mm, 15*mm, 15*mm, 16*mm, 15*mm, 20*mm, 20*mm, 15*mm, 16*mm], repeatRows=1)
            r_t.setStyle(TableStyle(hdr_style(None, C_TEAL)))
            story.append(r_t)
        else:
            story.append(para("暂无门店复盘数据", s["small"]))
        story.append(Spacer(1, 10))

    story.append(divider())
    story.append(Spacer(1, 4))
    story.append(para(
        "说明：本报告数据来自门店营销活动台账的实际执行与复盘记录，"
        "标注「自动执行」的活动为系统按预设规则自动触发的常态化营销触达，"
        "其余为人工规划与执行的专项活动。核销率=核销单数/发送人数，ROI=(带动营业额-活动成本)/活动成本。",
        s["small"]
    ))

    doc.build(story, onLaterPages=campaign_page)


if __name__ == "__main__":
    main()
