import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateProcessEvents } from './processEventGrouping.js'

test('aggregateProcessEvents collapses started and completed read events', () => {
  const items = aggregateProcessEvents([
    { id: '1', title: '开始执行命令', kind: 'command', groupType: 'read', groupTarget: '/tmp/a', phase: 'started' },
    { id: '2', title: '命令执行完成', kind: 'command', groupType: 'read', groupTarget: '/tmp/a', phase: 'completed' },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].id, '2')
  assert.equal(items[0].title, '命令执行完成')
})

test('aggregateProcessEvents groups consecutive grep events', () => {
  const items = aggregateProcessEvents([
    { id: '1', title: '命令执行完成', kind: 'command', groupType: 'grep', groupTarget: '/tmp/a.js', phase: 'completed' },
    { id: '2', title: '命令执行完成', kind: 'command', groupType: 'grep', groupTarget: '/tmp/b.js', phase: 'completed' },
    { id: '3', title: '命令执行完成', kind: 'command', groupType: 'grep', groupTarget: '/tmp/c.js', phase: 'completed' },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].title, '连续检索 3 次')
  assert.equal(items[0].detailBlocks?.[1]?.type, 'bullet_list')
  assert.deepEqual(items[0].detailBlocks?.[1]?.items, ['/tmp/a.js', '/tmp/b.js', '/tmp/c.js'])
})

test('aggregateProcessEvents keeps latest todo snapshot and collapses updates', () => {
  const items = aggregateProcessEvents([
    { id: '1', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'started', detailBlocks: [{ type: 'checklist', items: [{ completed: false, text: 'A' }] }] },
    { id: '2', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'updated', detailBlocks: [{ type: 'checklist', items: [{ completed: true, text: 'A' }, { completed: false, text: 'B' }] }] },
    { id: '3', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'completed', detailBlocks: [{ type: 'checklist', items: [{ completed: true, text: 'A' }, { completed: true, text: 'B' }] }] },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].title, '待办列表')
  assert.equal(items[0].detailBlocks?.[0]?.type, 'checklist')
  assert.deepEqual(items[0].detailBlocks?.[0]?.items, [
    { completed: true, text: 'A' },
    { completed: true, text: 'B' },
  ])
})

test('aggregateProcessEvents keeps only the latest todo snapshot across separated groups', () => {
  const items = aggregateProcessEvents([
    { id: '1', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'started', detailBlocks: [{ type: 'checklist', items: [{ completed: true, text: 'A' }, { completed: true, text: 'B' }, { completed: false, text: 'C' }] }] },
    { id: '2', title: '命令执行完成', kind: 'command', groupType: 'read', groupTarget: '/tmp/a', phase: 'completed' },
    { id: '3', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'updated', detailBlocks: [{ type: 'checklist', items: [{ completed: true, text: 'A' }, { completed: true, text: 'B' }, { completed: true, text: 'C' }] }] },
    { id: '4', title: '更新待办列表', kind: 'todo', groupType: 'todo', phase: 'completed', detailBlocks: [{ type: 'checklist', items: [{ completed: true, text: 'A' }, { completed: true, text: 'B' }, { completed: true, text: 'C' }] }] },
  ])

  assert.equal(items.length, 2)
  assert.equal(items[0].title, '命令执行完成')
  assert.equal(items[1].title, '待办列表')
  assert.equal(items[1].groupedCount, 3)
  assert.deepEqual(items[1].detailBlocks?.[0]?.items, [
    { completed: true, text: 'A' },
    { completed: true, text: 'B' },
    { completed: true, text: 'C' },
  ])
})

test('aggregateProcessEvents collapses consecutive reasoning updates to latest detail', () => {
  const items = aggregateProcessEvents([
    { id: '1', title: '思考过程', kind: 'reasoning', groupType: 'reasoning', phase: 'updated', detailBlocks: [{ type: 'markdown', text: '第一版思路' }] },
    { id: '2', title: '思考过程', kind: 'reasoning', groupType: 'reasoning', phase: 'updated', detailBlocks: [{ type: 'markdown', text: '第二版思路' }] },
    { id: '3', title: '思考过程', kind: 'reasoning', groupType: 'reasoning', phase: 'updated', detailBlocks: [{ type: 'markdown', text: '最终思路' }] },
  ])

  assert.equal(items.length, 1)
  assert.equal(items[0].title, '思考过程')
  assert.equal(items[0].detailBlocks?.[0]?.type, 'markdown')
  assert.equal(items[0].detailBlocks?.[0]?.text, '最终思路')
})
