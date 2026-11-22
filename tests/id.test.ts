import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createId } from '../src/lib/id'
import { SupabaseFinanceRepository } from '../src/lib/supabase/FinanceRepository'
import type { Database } from '../src/lib/supabase/database.types'

afterEach(() => vi.unstubAllGlobals())

describe('secure client identifiers', () => {
  it('prefers native randomUUID and preserves its receiver', () => {
    const provider = {
      randomUUID() {
        expect(this).toBe(provider)
        return 'f5f7e396-28ad-43c1-8a39-42d193d9221b'
      },
      getRandomValues: vi.fn(),
    }
    vi.stubGlobal('crypto', provider)
    expect(createId()).toBe('f5f7e396-28ad-43c1-8a39-42d193d9221b')
    expect(provider.getRandomValues).not.toHaveBeenCalled()
  })

  it('encodes RFC 4122 version and variant bits without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255))
    vi.stubGlobal('crypto', { getRandomValues })
    expect(createId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('generates distinct UUID v4 identifiers with cryptographic fallback', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const identifiers = Array.from({ length: 1000 }, () => createId())
    expect(new Set(identifiers).size).toBe(1000)
    expect(identifiers.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
  })

  it('handles a non-function native API using getRandomValues', () => {
    vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues: (bytes: Uint8Array) => bytes.fill(0) })
    expect(createId()).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('fails explicitly rather than using weak randomness when Web Crypto is absent', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => createId()).toThrow('Secure ID generation is unavailable')
    vi.stubGlobal('crypto', {})
    expect(() => createId()).toThrow('Secure ID generation is unavailable')
  })

  it('uses fallback UUIDs for every financial repository operation and retains explicit retry IDs', async () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
      from: (table: string) => ({ select: () => ({ eq: async () => ({
        data: table === 'accounts'
          ? [{ client_id: 'source', id: '10000000-0000-4000-8000-000000000001' }, { client_id: 'destination', id: '10000000-0000-4000-8000-000000000002' }]
          : [{ client_id: table === 'goals' ? 'goal' : 'occurrence', id: '10000000-0000-4000-8000-000000000003' }],
        error: null,
      }) }) }),
      rpc,
    } as unknown as SupabaseClient<Database>
    const repository = new SupabaseFinanceRepository(client)
    const common = { id: 'entry', amount: 10, accountId: 'source', date: '2026-10-22' }
    await repository.upsertTransaction('owner', { ...common, type: 'income', source: 'QA', notes: '' })
    await repository.upsertTransaction('owner', { ...common, type: 'expense', category: 'Food', description: 'QA' })
    await repository.upsertTransaction('owner', { ...common, type: 'saving', savingType: 'Emergency', mode: 'transfer' })
    await repository.recordTransfer('owner', { ...common, sourceAccountId: 'source', destinationAccountId: 'destination', note: '' })
    await repository.upsertGoalContribution('owner', { ...common, goalId: 'goal', type: 'reserve', notes: '' })
    await repository.deleteTransaction('owner', 'entry')
    await repository.reconcileBudgetOccurrence('owner', 'occurrence', 0)
    const operationIds = rpc.mock.calls.map(([, values]) => values.p_operation_id as string)
    expect(operationIds).toHaveLength(7)
    expect(new Set(operationIds).size).toBe(7)
    expect(operationIds.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
    const retryId = createId()
    await repository.deleteTransaction('owner', 'entry', retryId)
    expect(rpc).toHaveBeenLastCalledWith('delete_transaction', { p_client_id: 'entry', p_operation_id: retryId })
  })
})