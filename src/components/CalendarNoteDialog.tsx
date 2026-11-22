import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { createId } from '../store'
import type { CalendarNote } from '../types'

export function CalendarNoteDialog({ date, note, onClose, onSaved }: { date: string; note?: CalendarNote; onClose: () => void; onSaved: (note: CalendarNote) => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) { setError('Add note content before saving.'); return }
    const now = new Date().toISOString()
    onSaved({ id: note?.id ?? createId(), userId: note?.userId ?? 'local', date, title: title.trim(), content: content.trim(), createdAt: note?.createdAt ?? now, updatedAt: now })
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="calendar-note-title" onKeyDown={handleKeyDown}>
    <header className="dialog-header"><div><span className="eyebrow">CALENDAR NOTE · {date}</span><h2 id="calendar-note-title">{note ? 'Edit note' : 'Add note'}</h2></div><button className="icon-button" type="button" aria-label="Close note" onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}><div className="form-grid"><label className="field"><span>Title (optional)</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Note</span><textarea required rows={5} value={content} onChange={(event) => setContent(event.target.value)} /></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="dialog-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit">Save note</button></footer></form>
  </section></div>
}