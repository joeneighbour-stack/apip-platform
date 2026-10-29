// Excel export for the AI Signals report -- AiSignalsReportBuilder.tsx's "Export Excel"
// button, parallel to lib/patternExcelExport.ts / lib/analystExcelExport.ts.
//
// AI signals have no per-analyst identity (same anonymity rule as the Patterns/Analyst
// exports) and no pattern-family dimension -- confidence score is this signal type's own
// distinguishing dimension instead (see AiSignalsReportBuilder.tsx's own header comment),
// so the combination sheet below is Asset Class x Confidence rather than Asset x Pattern.
import type { FullBreakdownRow, FullBreakdownGroup } from './metrics'
import {
  METRIC_HEADERS, METRIC_WIDTHS, writeMetricCells, addHeaderBlock, styleHeaderRow, styleTotalRow,
  HEADER_ROW_NUM, FIRST_DATA_ROW, finaliseSheet, buildWorkbookFilename, downloadWorkbook, newWorkbook,
  type WorkbookCaption,
} from './excelReportHelpers'

export interface AiSignalsWorkbookInput extends WorkbookCaption {
  assetClassSummaryRows: FullBreakdownRow[]
  marketSummaryRows: FullBreakdownRow[]
  assetClassConfidenceGroups: FullBreakdownGroup[]
  grandTotal: FullBreakdownRow
}

// --- Sheet 1: Asset Class Summary --------------------------------------------------
function addAssetClassSummarySheet(wb: import('exceljs').Workbook, input: AiSignalsWorkbookInput) {
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
function addMarketSummarySheet(wb: import('exceljs').Workbook, input: AiSignalsWorkbookInput) {
  const ws = wb.addWorksheet('Market Summary')
  const headers = ['Market', ...METRIC_HEADERS]
  const widths = [18, ...METRIC_WIDTHS]
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

// --- Sheet 3: Asset Class x Confidence ----------------------------------------------
// Groups sorted by subtotal Total R descending (fullBreakdownGrouped's own order,
// unchanged -- there are only a handful of asset classes, unlike Patterns' Asset x
// Pattern sheet which re-sorts alphabetically because it has hundreds of asset groups).
function addAssetClassConfidenceSheet(wb: import('exceljs').Workbook, input: AiSignalsWorkbookInput) {
  const ws = wb.addWorksheet('Asset Class x Confidence')
  const headers = ['Asset Class', 'Confidence', ...METRIC_HEADERS]
  const widths = [18, 14, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const group of input.assetClassConfidenceGroups) {
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

export async function downloadAiSignalsWorkbook(input: AiSignalsWorkbookInput): Promise<void> {
  const wb = newWorkbook()
  addAssetClassSummarySheet(wb, input)
  addMarketSummarySheet(wb, input)
  addAssetClassConfidenceSheet(wb, input)
  await downloadWorkbook(wb, buildWorkbookFilename(input.reportName, input.dateRangeLabel))
}
