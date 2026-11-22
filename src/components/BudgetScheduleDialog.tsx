import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { AccountPicker } from './AccountPicker'
import { createId } from '../store'
import { expenseCategories, localDate } from '../lib/finance'
import type { BudgetSchedule } from '../types'

const weekdays: Array<[number, string]> = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']]

export function BudgetScheduleDialog({ schedule, onClose, onSaved }: { schedule?: BudgetSchedule; onClose: () => void; onSaved: (schedule: BudgetSchedule) => { success: boolean; message: string } }) {
  const today = localDate()
  const dialogRef = useRef<HTMLElement>(null)
  const [title, setTitle] = useState(schedule?.title ?? '')
  const [category, setCategory] = useState(schedule?.category ?? 'Transportation')
  const [amount, setAmount] = useState(schedule ? String(schedule.amount) : '')
  const [accountId, setAccountId] = useState(schedule?.sourceAccountId ?? '')
  const [startDate, setStartDate] = useState(schedule?.startDate ?? today)
  const [endDate, setEndDate] = useState(schedule?.endDate ?? today)
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(schedule?.weekdays ?? [])
  const [reserve, setReserve] = useState(schedule?.reservationMode === 'reserve')
  const [autoPost, setAutoPost] = useState(schedule?.autoPost ?? false)
  const [error, setError] = useState('')

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !accountId || endDate < startDate) {
      setError('Enter a title, positive amount, active account, and valid date range.')
      return
    }
    const now = new Date().toISOString()
    const result = onSaved({ id: schedule?.id ?? createId(), userId: schedule?.userId ?? 'local', title: title.trim(), category, amount: numericAmount, sourceAccountId: accountId, startDate, endDate, weekdays: selectedWeekdays, reservationMode: reserve ? 'reserve' : 'none', autoPost, status: schedule?.status ?? 'active', createdAt: schedule?.createdAt ?? now, updatedAt: now })
    if (!result.success) { setError(result.message); return }
    onClose()
  }

  function toggleWeekday(day: number) {
    setSelectedWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="budget-schedule-title" onKeyDown={handleKeyDown}>
    <header className="dialog-header"><div><span className="eyebrow">BUDGET OCCURRENCES</span><h2 id="budget-schedule-title">{schedule ? 'Edit schedule' : 'Schedule budget'}</h2></div><button className="icon-button" type="button" aria-label="Close schedule" onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}><div className="form-grid">
      <label className="field"><span>Budget title</span><input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{expenseCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>Amount per occurrence</span><input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <AccountPicker label="Funding account" value={accountId} onChange={setAccountId} />
      <label className="field"><span>Start date</span><input required type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="field"><span>End date</span><input required type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <fieldset className="weekday-picker"><legend>Repeat on</legend><div><button type="button" className={`button ${selectedWeekdays.length === 0 ? 'primary' : 'secondary'}`} aria-pressed={selectedWeekdays.length === 0} onClick={() => setSelectedWeekdays([])}>All days</button>{weekdays.map(([day, label]) => <label key={day}><input type="checkbox" checked={selectedWeekdays.includes(day)} onChange={() => toggleWeekday(day)} /><span>{label.slice(0, 3)}</span></label>)}</div></fieldset>
      <label className="check-field"><input type="checkbox" checked={reserve} onChange={(event) => setReserve(event.target.checked)} /><span>Reserve each occurrence from this account</span></label>
      <label className="check-field"><input type="checkbox" checked={autoPost} onChange={(event) => setAutoPost(event.target.checked)} /><span>Automatically post due occurrences</span></label>
    </div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">{schedule ? 'Save schedule' : 'Create schedule'}</button></footer></form>
  </section></div>
}