// Excel export for the Analyst (internal) report -- ReportBuilder.tsx's "Export Excel"
// button, parallel to the Patterns report's own export (lib/patternExcelExport.ts).
//
// Deliberately has NO per-analyst sheet or breakdown: this report's own UI states
// "Analyst identities are never included in generated reports" (ReportBuilder.tsx), and
// ReportAttributionDimension has no 'analyst' member at all for exactly that reason
// (see dimensionFn's comment there). The three sheets below stay within that same
// asset-class/market dimension the PDF itself already uses, just unrolled into full,
// non-top-N, spreadsheet-native detail.
import type { FullBreakdownRow, FullBreakdownGroup } from './metrics'
import {
  METRIC_HEADERS, METRIC_WIDTHS, writeMetricCells, addHeaderBlock, styleHeaderRow, styleTotalRow,
  HEADER_ROW_NUM, FIRST_DATA_ROW, finaliseSheet, buildWorkbookFilename, downloadWorkbook, newWorkbook,
  type WorkbookCaption,
} from './excelReportHelpers'

export interface AnalystWorkbookInput extends WorkbookCaption {
  assetClassSummaryRows: FullBreakdownRow[]
  marketSummaryRows: FullBreakdownRow[]
  assetBreakdown: FullBreakdownGroup[]
  grandTotal: FullBreakdownRow
}

// --- Sheet 1: Asset Class Summary --------------------------------------------------
function addAssetClassSummarySheet(wb: import('exceljs').Workbook, input: AnalystWorkbookInput) {
  const ws = wb.addWorksheet('Asset Class Summary')
  const headers = ['Asset Class', ...METRIC_HEADERS]
  const widths = [18, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.assetClassSummaryRows) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.label
    writeMetricCells(excelRow, 2, row)
    rowNum++
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  writeMetricCells(totalRow, 2, input.grandTotal)
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

// --- Sheet 2: Market Summary --------------------------------------------------------
function addMarketSummarySheet(wb: import('exceljs').Workbook, input: AnalystWorkbookInput) {
  const ws = wb.addWorksheet('Market Summary')
  const headers = ['Market', ...METRIC_HEADERS]
  const widths = [16, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.marketSummaryRows) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.label
    writeMetricCells(excelRow, 2, row)
    rowNum++
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  writeMetricCells(totalRow, 2, input.grandTotal)
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

// --- Sheet 3: Full Asset Breakdown (Asset Class x Market) --------------------------
// Same grouping already embedded in the PDF (data.assetBreakdown/assetBreakdownTotal,
// see ReportBuilder.tsx's handleGenerate()) -- groups sorted by subtotal Total R
// descending, each group's markets sorted by Total R descending, matching the PDF
// table's own order exactly (unlike the Patterns workbook's Asset x Pattern sheet,
// which re-sorts alphabetically -- no equivalent instruction was given for this report,
// so it stays consistent with what's already on the PDF page).
function addFullAssetBreakdownSheet(wb: import('exceljs').Workbook, input: AnalystWorkbookInput) {
  const ws = wb.addWorksheet('Full Asset Breakdown')
  const headers = ['Asset Class', 'Market', ...METRIC_HEADERS]
  const widths = [16, 16, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const group of input.assetBreakdown) {
    for (const row of group.rows) {
      const excelRow = ws.getRow(rowNum)
      excelRow.getCell(1).value = group.groupLabel
      excelRow.getCell(2).value = row.label
      writeMetricCells(excelRow, 3, row)
      rowNum++
    }
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  writeMetricCells(totalRow, 3, input.grandTotal)
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

export async function downloadAnalystWorkbook(input: AnalystWorkbookInput): Promise<void> {
  const wb = newWorkbook()
  addAssetClassSummarySheet(wb, input)
  addMarketSummarySheet(wb, input)
  addFullAssetBreakdownSheet(wb, input)
  await downloadWorkbook(wb, buildWorkbookFilename(input.reportName, input.dateRangeLabel))
}
