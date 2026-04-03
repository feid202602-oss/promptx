import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createProcessDetailBlockKeyEntries,
  reconcileExpandedProcessDetailKeys,
} from './processDetailBlockKeys.js'

test('createProcessDetailBlockKeyEntries keeps stable keys for unique blocks', () => {
  const entries = createProcessDetailBlockKeyEntries([
    { type: 'text', text: 'alpha' },
    { type: 'code_text', text: 'beta' },
  ])

  assert.equal(entries.length, 2)
  assert.notEqual(entries[0]?.key, entries[1]?.key)
  assert.equal(entries[0]?.duplicateCount, 1)
})

test('reconcileExpandedProcessDetailKeys preserves stable unique block keys', () => {
  const previousEntries = createProcessDetailBlockKeyEntries([
    { type: 'text', text: 'alpha' },
    { type: 'code_text', text: 'beta' },
  ])
  const nextEntries = createProcessDetailBlockKeyEntries([
    { type: 'meta', items: [{ label: '命令', value: 'pnpm build' }] },
    { type: 'text', text: 'alpha' },
    { type: 'code_text', text: 'beta' },
  ])

  const expandedKeys = new Set([previousEntries[1].key])
  const reconciled = reconcileExpandedProcessDetailKeys(expandedKeys, previousEntries, nextEntries)

  assert.deepEqual([...reconciled], [nextEntries[2].key])
})

test('reconcileExpandedProcessDetailKeys drops duplicate-signature state when counts change', () => {
  const previousEntries = createProcessDetailBlockKeyEntries([
    { type: 'code_text', text: 'same' },
    { type: 'code_text', text: 'same' },
  ])
  const nextEntries = createProcessDetailBlockKeyEntries([
    { type: 'code_text', text: 'same' },
    { type: 'code_text', text: 'same' },
    { type: 'code_text', text: 'same' },
  ])

  const expandedKeys = new Set([previousEntries[0].key])
  const reconciled = reconcileExpandedProcessDetailKeys(expandedKeys, previousEntries, nextEntries)

  assert.equal(reconciled.size, 0)
})

test('reconcileExpandedProcessDetailKeys keeps duplicate state when keys stay identical', () => {
  const previousEntries = createProcessDetailBlockKeyEntries([
    { type: 'code_text', text: 'same' },
    { type: 'code_text', text: 'same' },
  ])
  const nextEntries = createProcessDetailBlockKeyEntries([
    { type: 'code_text', text: 'same' },
    { type: 'code_text', text: 'same' },
  ])

  const expandedKeys = new Set([previousEntries[1].key])
  const reconciled = reconcileExpandedProcessDetailKeys(expandedKeys, previousEntries, nextEntries)

  assert.deepEqual([...reconciled], [nextEntries[1].key])
})
