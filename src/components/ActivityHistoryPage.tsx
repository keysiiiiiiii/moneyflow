import { useMemo, useState } from 'react'
import { Activity, Search } from 'lucide-react'
import { formatCurrency, formatDate } from '../lib/finance'
import type { Account, ActivityHistoryEntry, HistoryCategory } from '../types'

const categories: Array<[HistoryCategory | 'all', string]> = [['all', 'All'], ['expenses', 'Expenses'], ['income', 'Income'], ['transfers', 'Transfers'], ['accounts', 'Accounts'], ['savings', 'Savings'], ['goals', 'Goals'], ['budgets', 'Budgets'], ['contributions', 'Contributions'], ['system', 'System']]

export function ActivityHistoryPage({ entries, accounts }: { entries: ActivityHistoryEntry[]; accounts: Account[] }) {
  const [category, setCategory] = useState<HistoryCategory | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [accountId, setAccountId] = useState('all')
  const [categoryName, setCategoryName] = useState('all')
  const [query, setQuery] = useState('')
  const categoryNames = [...new Set(entries.map((entry) => entry.categoryName).filter((name): name is string => Boolean(name)))].sort()
  const matching = useMemo(() => entries.filter((entry) => {
    const text = `${entry.title} ${entry.description} ${entry.action} ${entry.categoryName ?? ''}`.toLowerCase()
    return (category === 'all' || entry.category === category) && (!startDate || entry.date >= startDate) && (!endDate || entry.date <= endDate) && (accountId === 'all' || entry.accountId === accountId) && (categoryName === 'all' || entry.categoryName === categoryName) && text.includes(query.trim().toLowerCase())
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [entries, category, startDate, endDate, accountId, categoryName, query])
  const groups = new Map<string, ActivityHistoryEntry[]>()
  for (const entry of matching) groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry])

  return <section className="panel page-panel history-page">
    <div className="panel-heading"><div><span className="eyebrow">PERMANENT ACTIVITY LOG</span><h2>History</h2></div><span className="notification-count">{matching.length} events</span></div>
    <div className="filters history-filters">
      <label className="search-field"><Search size={16} /><input aria-label="Search history" placeholder="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="Filter history category" value={category} onChange={(event) => setCategory(event.target.value as HistoryCategory | 'all')}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select aria-label="Filter history account" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="all">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
      <select aria-label="Filter history expense category" value={categoryName} onChange={(event) => setCategoryName(event.target.value)}><option value="all">All expense categories</option>{categoryNames.map((name) => <option key={name}>{name}</option>)}</select>
      <label className="month-filter"><span>From</span><input aria-label="History start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="month-filter"><span>To</span><input aria-label="History end date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
    </div>
    {groups.size ? <div className="history-timeline">{[...groups].map(([date, dayEntries]) => <section className="history-day" key={date}><h3>{formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>{dayEntries.map((entry) => <article className="history-event" key={entry.id}><span className="history-event-icon"><Activity size={16} /></span><div className="history-event-copy"><strong>{entry.title}</strong><small>{entry.action} · {entry.entityType.replaceAll('_', ' ')}{entry.accountId ? ` · ${accounts.find((account) => account.id === entry.accountId)?.name ?? 'Account'}` : ''}{entry.categoryName ? ` · ${entry.categoryName}` : ''}</small><p>{entry.description}</p>{entry.beforeBalance !== undefined && entry.afterBalance !== undefined ? <small>{formatCurrency(entry.beforeBalance)} → {formatCurrency(entry.afterBalance)}</small> : null}</div>{entry.amount !== undefined ? <strong className="history-event-amount">{formatCurrency(entry.amount)}</strong> : null}</article>)}</section>)}</div> : <div className="history-empty"><Activity size={22} /><strong>No activity matches</strong><p>New finance changes will appear here.</p></div>}
  </section>
}