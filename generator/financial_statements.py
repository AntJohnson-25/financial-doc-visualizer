"""
Financial Statements Generator
Generates P&L, Balance Sheet, and Cash Flow Statement with randomized figures
in CSV, Excel, or PDF format.

Usage:
    python financial_statements.py
    (or pass flags: --company "Acme" --path "./out" --format excel)

Dependencies:
    pip install pandas openpyxl reportlab
"""

import argparse
import random
import sys
from datetime import date
from pathlib import Path

import pandas as pd


# ---------------------------------------------------------------------------
# RANDOM DATA GENERATORS
# ---------------------------------------------------------------------------
def r(low, high):
    """Random integer rounded to nearest 100."""
    return round(random.randint(low, high), -2)


def get_profit_and_loss():
    revenue = r(400_000, 900_000)
    cogs = -r(int(revenue * 0.35), int(revenue * 0.55))
    gross = revenue + cogs
    salaries = -r(60_000, 120_000)
    rent = -r(18_000, 36_000)
    utilities = -r(4_000, 10_000)
    marketing = -r(8_000, 25_000)
    depreciation = -r(5_000, 15_000)
    opex = salaries + rent + utilities + marketing + depreciation
    op_income = gross + opex
    interest = -r(2_000, 8_000)
    pretax = op_income + interest
    tax = -round(pretax * 0.25) if pretax > 0 else 0
    net = pretax + tax

    return [
        ("Revenue", revenue),
        ("Cost of Goods Sold", cogs),
        ("Gross Profit", gross),
        ("Salaries & Wages", salaries),
        ("Rent", rent),
        ("Utilities", utilities),
        ("Marketing", marketing),
        ("Depreciation", depreciation),
        ("Total Operating Expenses", opex),
        ("Operating Income", op_income),
        ("Interest Expense", interest),
        ("Income Before Tax", pretax),
        ("Income Tax", tax),
        ("Net Income", net),
    ]


def get_balance_sheet():
    cash = r(40_000, 150_000)
    ar = r(20_000, 80_000)
    inventory = r(30_000, 120_000)
    current_assets = cash + ar + inventory

    ppe = r(150_000, 400_000)
    accum_dep = -r(20_000, 80_000)
    intangibles = r(10_000, 60_000)
    noncurrent_assets = ppe + accum_dep + intangibles
    total_assets = current_assets + noncurrent_assets

    ap = r(15_000, 60_000)
    short_debt = r(10_000, 40_000)
    current_liab = ap + short_debt
    long_debt = r(50_000, 180_000)
    total_liab = current_liab + long_debt

    common_stock = r(100_000, 200_000)
    retained = total_assets - total_liab - common_stock  # balances the sheet
    total_equity = common_stock + retained

    return [
        ("--- ASSETS ---", ""),
        ("Cash & Equivalents", cash),
        ("Accounts Receivable", ar),
        ("Inventory", inventory),
        ("Total Current Assets", current_assets),
        ("Property, Plant & Equipment", ppe),
        ("Accumulated Depreciation", accum_dep),
        ("Intangible Assets", intangibles),
        ("Total Non-Current Assets", noncurrent_assets),
        ("TOTAL ASSETS", total_assets),
        ("--- LIABILITIES ---", ""),
        ("Accounts Payable", ap),
        ("Short-Term Debt", short_debt),
        ("Total Current Liabilities", current_liab),
        ("Long-Term Debt", long_debt),
        ("Total Liabilities", total_liab),
        ("--- EQUITY ---", ""),
        ("Common Stock", common_stock),
        ("Retained Earnings", retained),
        ("Total Equity", total_equity),
        ("TOTAL LIABILITIES & EQUITY", total_liab + total_equity),
    ]


def get_cash_flow():
    net_income = r(20_000, 80_000)
    dep = r(5_000, 15_000)
    ar_change = -r(1_000, 10_000)
    inv_change = -r(1_000, 12_000)
    ap_change = r(1_000, 8_000)
    op_cash = net_income + dep + ar_change + inv_change + ap_change

    equipment = -r(10_000, 40_000)
    investments = r(2_000, 10_000)
    inv_cash = equipment + investments

    debt_in = r(5_000, 25_000)
    debt_out = -r(3_000, 15_000)
    dividends = -r(2_000, 10_000)
    fin_cash = debt_in + debt_out + dividends

    net_change = op_cash + inv_cash + fin_cash
    begin_cash = r(40_000, 100_000)
    end_cash = begin_cash + net_change

    return [
        ("--- OPERATING ACTIVITIES ---", ""),
        ("Net Income", net_income),
        ("Depreciation & Amortization", dep),
        ("Changes in Accounts Receivable", ar_change),
        ("Changes in Inventory", inv_change),
        ("Changes in Accounts Payable", ap_change),
        ("Net Cash from Operations", op_cash),
        ("--- INVESTING ACTIVITIES ---", ""),
        ("Purchase of Equipment", equipment),
        ("Sale of Investments", investments),
        ("Net Cash from Investing", inv_cash),
        ("--- FINANCING ACTIVITIES ---", ""),
        ("Proceeds from Debt", debt_in),
        ("Repayment of Debt", debt_out),
        ("Dividends Paid", dividends),
        ("Net Cash from Financing", fin_cash),
        ("Net Change in Cash", net_change),
        ("Cash at Beginning of Period", begin_cash),
        ("Cash at End of Period", end_cash),
    ]


# ---------------------------------------------------------------------------
# WRITERS
# ---------------------------------------------------------------------------
def to_dataframe(data):
    return pd.DataFrame(data, columns=["Line Item", "Amount"])


def write_csv(folder, name, data, company):
    path = folder / f"{name}.csv"
    to_dataframe(data).to_csv(path, index=False)
    return path


def write_excel(folder, name, data, company):
    path = folder / f"{name}.xlsx"
    sheet = name[:31]
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        to_dataframe(data).to_excel(writer, sheet_name=sheet, index=False)
        ws = writer.sheets[sheet]
        ws.column_dimensions["A"].width = 40
        ws.column_dimensions["B"].width = 18
        for cell in ws[1]:
            cell.font = cell.font.copy(bold=True)
    return path


def write_pdf(folder, name, data, company):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    )

    path = folder / f"{name}.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=letter)
    styles = getSampleStyleSheet()
    elements = [
        Paragraph(f"<b>{company}</b>", styles["Title"]),
        Paragraph(name.replace("_", " "), styles["Heading2"]),
        Paragraph(f"As of {date.today().isoformat()}", styles["Normal"]),
        Spacer(1, 12),
    ]

    rows = [["Line Item", "Amount"]]
    for item, amt in data:
        rows.append([item, f"{amt:,.2f}" if isinstance(amt, (int, float)) else amt])

    table = Table(rows, colWidths=[300, 120])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#4472C4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#F2F2F2")]),
    ]))
    elements.append(table)
    doc.build(elements)
    return path


WRITERS = {"csv": write_csv, "excel": write_excel, "pdf": write_pdf}


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------
def prompt(msg, default=None, choices=None):
    suffix = f" [{default}]" if default else ""
    if choices:
        suffix = f" ({'/'.join(choices)})" + suffix
    while True:
        val = input(f"{msg}{suffix}: ").strip() or default
        if not val:
            print("  Value required.")
            continue
        if choices and val.lower() not in choices:
            print(f"  Choose one of: {', '.join(choices)}")
            continue
        return val


def main():
    parser = argparse.ArgumentParser(description="Generate financial statements.")
    parser.add_argument("--company", help="Company name")
    parser.add_argument("--path", help="Base output directory")
    parser.add_argument("--format", choices=["csv", "excel", "pdf"], help="Output format")
    args = parser.parse_args()

    company = args.company or prompt("Company name")
    base_path = args.path or prompt("Output folder path", default=".")
    fmt = (args.format or prompt("Format", choices=["csv", "excel", "pdf"], default="excel")).lower()

    today = date.today().isoformat()
    safe_company = "".join(c for c in company if c.isalnum() or c in (" ", "-", "_")).strip()
    out_folder = Path(base_path).expanduser().resolve() / f"{safe_company} - {today}"
    out_folder.mkdir(parents=True, exist_ok=True)

    documents = {
        "Profit_and_Loss": get_profit_and_loss(),
        "Balance_Sheet": get_balance_sheet(),
        "Cash_Flow_Statement": get_cash_flow(),
    }

    writer = WRITERS[fmt]
    print(f"\nGenerating {fmt.upper()} files in: {out_folder}")
    for name, data in documents.items():
        path = writer(out_folder, name, data, company)
        print(f"  ✓ {path.name}")
    print("\nDone.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(1)
