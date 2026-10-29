// Shared low-level Excel-building primitives for the on-demand report exports
// (lib/patternExcelExport.ts, lib/analystExcelExport.ts) -- both need the same thing: a
// workbook whose every sheet has the same 8 metric columns from a FullBreakdownRow, the
// same 3-row report-name/date-range/filters caption block, a bold frozen header row,
// autofilter, and a reconciling Grand Total row. Kept separate from the report-specific
// sheet layout (which columns/groupings each report adds beyond the shared 8) -- same
// "share the generic table mechanics, not the report structure" split FullBreakdownTable
// already uses between the two PDF reports.
import ExcelJS from 'exceljs'
import type { FullBreakdownRow } from './metrics'

export const METRIC_HEADERS = [
  'Trades', 'Win Rate', 'Avg R', 'Total R', 'Profit Factor', 'Payout Ratio', 'Best Trade (R)', 'Worst Trade (R)',
]
export const METRIC_WIDTHS = [9, 10, 9, 11, 12, 12, 13, 14]
export const METRIC_NUMFMTS = ['0', '0.0%', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00']

export function metricValues(row: FullBreakdownRow): (number | null)[] {
  return [row.trades, row.winRate, row.avgR, row.totalR, row.profitFactor, row.payoutRatio, row.bestTradeR, row.worstTradeR]
}

export function writeMetricCells(excelRow: ExcelJS.Row, firstMetricCol: number, row: FullBreakdownRow) {
  metricValues(row).forEach((v, i) => {
    const cell = excelRow.getCell(firstMetricCol + i)
    cell.value = v
    cell.numFmt = METRIC_NUMFMTS[i]
  })
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }

export interface WorkbookCaption {
  reportName: string
  dateRangeLabel: string
  filterSummary: string
}

// Rows 1-3: report name / date range / active filters, spanning every column this sheet
// uses. Row 4 left blank. Row 5 is the real header row the autofilter/freeze pane
// anchor to, so the caption reads as a block above the table, not part of it.
export function addHeaderBlock(ws: ExcelJS.Worksheet, caption: WorkbookCaption, lastCol: number) {
  ws.mergeCells(1, 1, 1, lastCol)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = caption.reportName
  titleCell.font = { bold: true, size: 13 }

  ws.mergeCells(2, 1, 2, lastCol)
  ws.getCell(2, 1).value = `Date Range: ${caption.dateRangeLabel}`
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF475569' } }

  ws.mergeCells(3, 1, 3, lastCol)
  ws.getCell(3, 1).value = `Filters: ${caption.filterSummary}`
  ws.getCell(3, 1).font = { italic: true, size: 10, color: { argb: 'FF475569' } }
}

export function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = HEADER_FILL
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } }
  })
}

export function styleTotalRow(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = TOTAL_FILL
  })
}

export const HEADER_ROW_NUM = 5
export const FIRST_DATA_ROW = 6

export function finaliseSheet(ws: ExcelJS.Worksheet, lastCol: number) {
  ws.autoFilter = { from: { row: HEADER_ROW_NUM, column: 1 }, to: { row: HEADER_ROW_NUM, column: lastCol } }
  // Freeze the header row and everything above it (the 3-row caption + the blank
  // spacer) so column headers stay visible while scrolling a full-history export.
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW_NUM }]
}

function sanitiseForFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')
}

export function buildWorkbookFilename(reportName: string, dateRangeLabel: string): string {
  return `${sanitiseForFilename(reportName)}_${sanitiseForFilename(dateRangeLabel)}.xlsx`
}

export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'APIP'
  wb.created = new Date()
  return wb
}
