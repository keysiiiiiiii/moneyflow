import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '../lib/finance'
import type { BudgetOccurrence } from '../types'

export function BudgetOccurrenceDialog({ occurrence, title, onClose, onSaved }: { occurrence: BudgetOccurrence; title: string; onClose: () => void; onSaved: (actualAmount: number) => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const [actualAmount, setActualAmount] = useState(String(occurrence.actualAmount ?? occurrence.plannedAmount))
  const [error, setError] = useState('')

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, button')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(actualAmount)
    if (!Number.isFinite(amount) || amount < 0) { setError('Enter an actual amount, or zero if nothing was spent.'); return }
    onSaved(amount)
    onClose()
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="occurrence-dialog-title" onKeyDown={handleKeyDown}>
    <header className="dialog-header"><div><span className="eyebrow">BUDGET RECONCILIATION</span><h2 id="occurrence-dialog-title">{title}</h2></div><button className="icon-button" type="button" aria-label="Close reconciliation" onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}><div className="form-grid"><label className="field"><span>Planned amount</span><input value={formatCurrency(occurrence.plannedAmount)} readOnly /></label><label className="field"><span>Actual spent</span><input required type="number" min="0" step="0.01" value={actualAmount} onChange={(event) => setActualAmount(event.target.value)} /></label><p className="form-hint">Unused reserved money will return to Available to Spend.</p></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">Save actual amount</button></footer></form>
  </section></div>
}