// Excel export for the Combined ("All Signals") report -- CombinedSignalsReportBuilder.tsx's
// "Export Excel" button.
//
// This report's underlying data is fundamentally different in shape from the other three
// exports (lib/patternExcelExport.ts, lib/analystExcelExport.ts, lib/aiSignalsExcelExport.ts):
// it works entirely from pre-aggregated SignalTypeData/CombinedAssetClassRow/CombinedYearRow/
// CombinedMarketRow (lib/combinedSignalAnalytics.ts), never a raw per-trade array, so there
// is no FullBreakdownRow to build from here -- each sheet below is a spreadsheet-native
// version of a table already on the PDF, not a new breakdown dimension. Shares only the
// generic caption-block/header-row/autofilter mechanics with the other exports (lib/
// excelReportHelpers.ts), not the FullBreakdownRow-specific metric-column helpers.
import {
  type SignalTypeKey, type SignalTypeData, type CombinedAssetClassRow, type CombinedMarketRow, type CombinedYearRow,
  TYPE_LABELS, TYPE_ORDER,
} from './combinedSignalAnalytics'
import {
  addHeaderBlock, styleHeaderRow, styleTotalRow, HEADER_ROW_NUM, FIRST_DATA_ROW, finaliseSheet,
  buildWorkbookFilename, downloadWorkbook, newWorkbook, type WorkbookCaption,
} from './excelReportHelpers'

export interface CombinedWorkbookInput extends WorkbookCaption {
  types: Record<SignalTypeKey, SignalTypeData>
  byAssetClass: CombinedAssetClassRow[]
  byYear: CombinedYearRow[]
  topMarkets: CombinedMarketRow[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function numCell(excelRow: import('exceljs').Row, col: number, value: number | null, numFmt: string) {
  const cell = excelRow.getCell(col)
  cell.value = value
  cell.numFmt = numFmt
}

// --- Sheet 1: Performance Comparison (one row per signal type) --------------------
function addComparisonSheet(wb: import('exceljs').Workbook, input: CombinedWorkbookInput) {
  const ws = wb.addWorksheet('Performance Comparison')
  const headers = [
    'Signal Type', 'Total Signals', 'Win Rate', 'Avg R', 'Total R', 'Max Drawdown (R)',
    'Payout Ratio', 'BE Win Rate', 'First Signal', 'Last Signal',
  ]
  const widths = [14, 14, 10, 9, 11, 15, 13, 12, 13, 13]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const key of TYPE_ORDER) {
    const d = input.types[key].summary
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = TYPE_LABELS[key]
    numCell(excelRow, 2, d.totalSignals, '0')
    numCell(excelRow, 3, d.winRate, '0.0%')
    numCell(excelRow, 4, round2(d.avgR), '0.00')
    numCell(excelRow, 5, round2(d.totalR), '0.00')
    numCell(excelRow, 6, round2(d.maxDrawdownR), '0.00')
    numCell(excelRow, 7, d.payoutRatio !== null ? round2(d.payoutRatio) : null, '0.00')
    numCell(excelRow, 8, d.breakEvenWinRate, '0.0%')
    excelRow.getCell(9).value = d.firstSignalDate
    excelRow.getCell(10).value = d.lastSignalDate
    rowNum++
  }

  finaliseSheet(ws, headers.length)
}

// --- Sheet 2: By Asset Class --------------------------------------------------------
function addAssetClassSheet(wb: import('exceljs').Workbook, input: CombinedWorkbookInput) {
  const ws = wb.addWorksheet('By Asset Class')
  const headers = ['Asset Class', 'Analyst R', 'Pattern R', 'AI R', 'Combined Total R', 'Combined Win Rate']
  const widths = [16, 12, 12, 12, 16, 16]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  let combinedTotal = 0
  for (const row of input.byAssetClass) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.assetClass
    numCell(excelRow, 2, row.analystR !== null ? round2(row.analystR) : null, '0.00')
    numCell(excelRow, 3, row.patternR !== null ? round2(row.patternR) : null, '0.00')
    numCell(excelRow, 4, row.aiR !== null ? round2(row.aiR) : null, '0.00')
    numCell(excelRow, 5, row.combinedTotalR !== null ? round2(row.combinedTotalR) : null, '0.00')
    numCell(excelRow, 6, row.combinedWinRate, '0.0%')
    if (row.combinedTotalR !== null) combinedTotal += row.combinedTotalR
    rowNum++
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  numCell(totalRow, 5, round2(combinedTotal), '0.00')
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

// --- Sheet 3: Year by Year -----------------------------------------------------------
function addYearSheet(wb: import('exceljs').Workbook, input: CombinedWorkbookInput) {
  const ws = wb.addWorksheet('Year by Year')
  const headers = ['Year', 'Analyst', 'Pattern', 'AI', 'Combined']
  const widths = [10, 11, 11, 11, 12]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.byYear) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.year
    numCell(excelRow, 2, row.analyst !== null ? round2(row.analyst) : null, '0.00')
    numCell(excelRow, 3, row.pattern !== null ? round2(row.pattern) : null, '0.00')
    numCell(excelRow, 4, row.ai !== null ? round2(row.ai) : null, '0.00')
    const combinedValues = [row.analyst, row.pattern, row.ai].filter((v): v is number => v !== null)
    const combinedTotal = combinedValues.length > 0 ? round2(combinedValues.reduce((a, b) => a + b, 0)) : null
    numCell(excelRow, 5, combinedTotal, '0.00')
    rowNum++
  }

  finaliseSheet(ws, headers.length)
}

// --- Sheet 4: Top Markets ------------------------------------------------------------
// Same top-20 list already shown on the PDF (buildTopMarkets() in
// app/api/analytics/combined/route.ts is fixed to 20) -- not expanded to every market,
// since that would need a backend change beyond this export.
function addTopMarketsSheet(wb: import('exceljs').Workbook, input: CombinedWorkbookInput) {
  const ws = wb.addWorksheet('Top Markets')
  const headers = ['Symbol', 'Analyst R', 'Pattern R', 'AI R', 'Combined Total R', 'Combined Win Rate', 'Trades']
  const widths = [14, 12, 12, 12, 16, 16, 10]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.topMarkets) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.symbol
    numCell(excelRow, 2, row.analystR !== null ? round2(row.analystR) : null, '0.00')
    numCell(excelRow, 3, row.patternR !== null ? round2(row.patternR) : null, '0.00')
    numCell(excelRow, 4, row.aiR !== null ? round2(row.aiR) : null, '0.00')
    numCell(excelRow, 5, row.combinedTotalR !== null ? round2(row.combinedTotalR) : null, '0.00')
    numCell(excelRow, 6, row.combinedWinRate, '0.0%')
    numCell(excelRow, 7, row.trades, '0')
    rowNum++
  }

  finaliseSheet(ws, headers.length)
}

export async function downloadCombinedWorkbook(input: CombinedWorkbookInput): Promise<void> {
  const wb = newWorkbook()
  addComparisonSheet(wb, input)
  addAssetClassSheet(wb, input)
  addYearSheet(wb, input)
  addTopMarketsSheet(wb, input)
  await downloadWorkbook(wb, buildWorkbookFilename(input.reportName, input.dateRangeLabel))
}
