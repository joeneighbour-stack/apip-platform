// Excel export for the Patterns report (PatternReportBuilder.tsx's "Export Excel"
// button) -- the Asset x Pattern breakdown used to be a PDF appendix (1,605 distinct
// normalised-symbol x family combinations at full history); it moved here instead so
// the PDF stays short while the full combination-level detail is still available.
//
// Library choice: the repo-root package.json declares "xlsx": "^0.18.5" but nothing in
// apps/web or intelligence-engine actually imports it, and npm audit flags that exact
// version as a HIGH-severity, no-fix-available Prototype Pollution/ReDoS
// vulnerability -- not a suitable existing dependency to build on. exceljs is used
// instead (added to apps/web/package.json); its own `uuid` sub-dependency carries one
// unrelated moderate advisory with no non-breaking fix, which is a different order of
// severity and not triggered by how this file uses the library (writing a workbook
// from already-computed numbers, no attacker-controlled input).
import type { FullBreakdownRow, FullBreakdownGroup } from './metrics'
import {
  METRIC_HEADERS, METRIC_WIDTHS, writeMetricCells, addHeaderBlock, styleHeaderRow, styleTotalRow,
  HEADER_ROW_NUM, FIRST_DATA_ROW, finaliseSheet, buildWorkbookFilename, downloadWorkbook, newWorkbook,
  type WorkbookCaption,
} from './excelReportHelpers'

export interface AssetSummaryRow extends FullBreakdownRow {
  assetClass: string
}

export interface PatternWorkbookInput extends WorkbookCaption {
  patternSummaryRows: FullBreakdownRow[]
  assetSummaryRows: AssetSummaryRow[]
  assetPatternGroups: FullBreakdownGroup[]
  grandTotal: FullBreakdownRow
  lowSampleThreshold: number
}

// --- Sheet 1: Pattern Summary -----------------------------------------------------
function addPatternSummarySheet(wb: import('exceljs').Workbook, input: PatternWorkbookInput) {
  const ws = wb.addWorksheet('Pattern Summary')
  const headers = ['Pattern', ...METRIC_HEADERS]
  const widths = [28, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.patternSummaryRows) {
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

// --- Sheet 2: Asset Summary --------------------------------------------------------
function addAssetSummarySheet(wb: import('exceljs').Workbook, input: PatternWorkbookInput) {
  const ws = wb.addWorksheet('Asset Summary')
  const headers = ['Asset', 'Asset Class', ...METRIC_HEADERS]
  const widths = [16, 16, ...METRIC_WIDTHS]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  let rowNum = FIRST_DATA_ROW
  for (const row of input.assetSummaryRows) {
    const excelRow = ws.getRow(rowNum)
    excelRow.getCell(1).value = row.label
    excelRow.getCell(2).value = row.assetClass
    writeMetricCells(excelRow, 3, row)
    rowNum++
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  writeMetricCells(totalRow, 3, input.grandTotal)
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

// --- Sheet 3: Asset x Pattern -------------------------------------------------------
// Every combination, grouped by asset (alphabetical) then sorted by Total R descending
// within each asset -- assetPatternGroups already carries rows sorted by Total R
// descending per group (fullBreakdownGrouped), this just re-orders the groups
// themselves alphabetically by asset name rather than by the groups' own Total R
// (which is how the PDF's retired appendix ordered them).
function addAssetPatternSheet(wb: import('exceljs').Workbook, input: PatternWorkbookInput) {
  const ws = wb.addWorksheet('Asset x Pattern')
  const headers = ['Asset', 'Pattern', ...METRIC_HEADERS, 'Low Sample']
  const widths = [16, 28, ...METRIC_WIDTHS, 11]
  ws.columns = headers.map((header, i) => ({ header, width: widths[i] }))
  addHeaderBlock(ws, input, headers.length)

  const headerRow = ws.getRow(HEADER_ROW_NUM)
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h })
  styleHeaderRow(headerRow)

  const groups = [...input.assetPatternGroups].sort((a, b) => a.groupLabel.localeCompare(b.groupLabel))

  let rowNum = FIRST_DATA_ROW
  for (const group of groups) {
    for (const row of group.rows) {
      const excelRow = ws.getRow(rowNum)
      excelRow.getCell(1).value = group.groupLabel
      excelRow.getCell(2).value = row.label
      writeMetricCells(excelRow, 3, row)
      excelRow.getCell(3 + METRIC_HEADERS.length).value = row.trades < input.lowSampleThreshold ? 'Yes' : 'No'
      rowNum++
    }
  }

  const totalRow = ws.getRow(rowNum)
  totalRow.getCell(1).value = 'Grand Total'
  writeMetricCells(totalRow, 3, input.grandTotal)
  styleTotalRow(totalRow)

  finaliseSheet(ws, headers.length)
}

export async function downloadPatternWorkbook(input: PatternWorkbookInput): Promise<void> {
  const wb = newWorkbook()
  addPatternSummarySheet(wb, input)
  addAssetSummarySheet(wb, input)
  addAssetPatternSheet(wb, input)
  await downloadWorkbook(wb, buildWorkbookFilename(input.reportName, input.dateRangeLabel))
}
