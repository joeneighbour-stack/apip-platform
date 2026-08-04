'use client'
import { useState } from 'react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface Props {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder: string
}

// Shared multi-select-with-search dropdown, extracted from the previous Analytics
// page's inline implementation so filter UI isn't hand-rolled per component.
export function MultiSelect({ label, options, selected, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const allSelected = selected.length === 0
  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div className="relative">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <button type="button" onClick={() => { setOpen(!open); setSearch('') }}
        className="w-full text-left text-xs px-2.5 py-2 rounded-md border border-border bg-background flex items-center justify-between gap-2">
        <span className="truncate">{allSelected ? placeholder : `${selected.length} selected`}</span>
        <span className="text-muted-foreground shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-full min-w-[12rem] bg-card border border-border rounded-md shadow-lg z-50 flex flex-col max-h-56">
            {options.length > 6 && (
              <div className="p-2 border-b border-border shrink-0">
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search..." onClick={e => e.stopPropagation()} autoFocus
                  className="w-full text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30" />
              </div>
            )}
            <div className="overflow-y-auto">
              <button type="button" className="w-full text-left text-xs px-3 py-2 hover:bg-muted transition-colors font-medium"
                onClick={() => { onChange([]); setSearch('') }}>
                {allSelected ? '✔ ' : '  '}All
              </button>
              {filtered.map(opt => (
                <button key={opt.value} type="button" className="w-full text-left text-xs px-3 py-2 hover:bg-muted transition-colors"
                  onClick={() => {
                    const next = selected.includes(opt.value)
                      ? selected.filter(v => v !== opt.value)
                      : [...selected, opt.value]
                    onChange(next)
                  }}>
                  {selected.includes(opt.value) ? '✔ ' : '  '}{opt.label}
                </button>
              ))}
              {filtered.length === 0 && <p className="text-xs text-muted-foreground px-3 py-2">No matches</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
