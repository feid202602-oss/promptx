function uniqueNonEmpty(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))]
}

function createMetaBlock(items = []) {
  const normalized = items
    .map((item) => ({
      label: String(item?.label || '').trim(),
      value: String(item?.value || '').trim(),
    }))
    .filter((item) => item.label && item.value)

  return normalized.length ? { type: 'meta', items: normalized } : null
}

function formatGroupTypeLabel(groupType = '') {
  if (groupType === 'read') {
    return '读取'
  }
  if (groupType === 'grep') {
    return '检索'
  }
  if (groupType === 'list') {
    return '列出'
  }
  if (groupType === 'web') {
    return '网页'
  }
  if (groupType === 'todo') {
    return '待办'
  }
  if (groupType === 'reasoning') {
    return '思考'
  }
  return groupType
}

function buildGroupTitle(groupType = '', count = 0) {
  const total = Math.max(1, Number(count) || 0)
  if (groupType === 'read') {
    return `连续读取 ${total} 项`
  }
  if (groupType === 'grep') {
    return `连续检索 ${total} 次`
  }
  if (groupType === 'list') {
    return `连续列出 ${total} 处`
  }
  if (groupType === 'web') {
    return `连续网页检索 ${total} 次`
  }
  if (groupType === 'todo') {
    return '待办列表'
  }
  if (groupType === 'reasoning') {
    return '思考过程'
  }
  return `连续处理 ${total} 项`
}

function buildSummaryBlocks(groupType = '', items = [], terminalEvents = []) {
  const targets = uniqueNonEmpty(items.map((item) => item.groupTarget))
  const blocks = []
  if (groupType === 'todo') {
    const latestChecklist = [...terminalEvents]
      .reverse()
      .flatMap((item) => (Array.isArray(item?.detailBlocks) ? item.detailBlocks : []))
      .find((block) => block?.type === 'checklist')

    return latestChecklist ? [latestChecklist] : []
  }

  if (groupType === 'reasoning') {
    const latestReasoning = [...items]
      .reverse()
      .find((item) => Array.isArray(item?.detailBlocks) && item.detailBlocks.length)

    return latestReasoning?.detailBlocks?.length ? latestReasoning.detailBlocks : []
  }

  const metaBlock = createMetaBlock([
    { label: '类型', value: formatGroupTypeLabel(groupType) },
    { label: '次数', value: String(items.length) },
  ])

  if (metaBlock) {
    blocks.push(metaBlock)
  }

  if (targets.length) {
    blocks.push({
      type: 'bullet_list',
      items: targets.slice(0, 8),
      totalCount: targets.length,
      hiddenCount: Math.max(0, targets.length - 8),
    })
  }

  return blocks
}

function summarizeGroup(items = []) {
  if (!items.length) {
    return []
  }

  const [first] = items
  const groupType = String(first.groupType || '').trim()
  if (!groupType) {
    return items
  }

  if (groupType === 'reasoning') {
    if (items.length === 1) {
      return items
    }

    const latest = items[items.length - 1]
    return [{
      ...latest,
      id: `${latest.id}-group`,
      title: buildGroupTitle(groupType, items.length),
      detail: '',
      detailBlocks: buildSummaryBlocks(groupType, items, items),
      isGrouped: true,
      groupedCount: items.length,
    }]
  }

  const terminalEvents = items.filter((item) => item.phase === 'completed' || item.phase === 'updated' || item.kind === 'error')
  if (!terminalEvents.length) {
    return [items[items.length - 1]]
  }

  if (groupType === 'todo') {
    if (items.length === 1) {
      return items
    }

    const latest = terminalEvents[terminalEvents.length - 1]
    return [{
      ...latest,
      id: `${latest.id}-group`,
      title: buildGroupTitle(groupType, items.length),
      detail: '',
      detailBlocks: buildSummaryBlocks(groupType, items, terminalEvents),
      isGrouped: true,
      groupedCount: items.length,
    }]
  }

  if (terminalEvents.length === 1 && items.length <= 2) {
    return [terminalEvents[0]]
  }

  return [{
    ...terminalEvents[terminalEvents.length - 1],
    id: `${terminalEvents[terminalEvents.length - 1].id}-group`,
    title: buildGroupTitle(groupType, terminalEvents.length),
    detail: '',
    detailBlocks: buildSummaryBlocks(groupType, terminalEvents, terminalEvents),
    isGrouped: true,
    groupedCount: terminalEvents.length,
  }]
}

function collapseTodoSnapshots(events = []) {
  const list = Array.isArray(events) ? events : []
  const todoItems = list.filter((item) => String(item?.groupType || '').trim() === 'todo')
  if (todoItems.length <= 1) {
    return list
  }

  const [latestTodo] = summarizeGroup(todoItems)
  if (!latestTodo) {
    return list
  }

  const lastTodoIndex = list.reduce((result, item, index) => (
    String(item?.groupType || '').trim() === 'todo' ? index : result
  ), -1)

  if (lastTodoIndex < 0) {
    return list
  }

  return list.flatMap((item, index) => {
    if (String(item?.groupType || '').trim() !== 'todo') {
      return [item]
    }

    if (index === lastTodoIndex) {
      return [latestTodo]
    }

    return []
  })
}

export function aggregateProcessEvents(events = []) {
  const list = collapseTodoSnapshots(Array.isArray(events) ? events.filter(Boolean) : [])
  const result = []

  for (let index = 0; index < list.length; index += 1) {
    const current = list[index]
    const currentGroupType = String(current?.groupType || '').trim()
    if (!currentGroupType) {
      result.push(current)
      continue
    }

    const groupItems = [current]
    while (index + 1 < list.length && String(list[index + 1]?.groupType || '').trim() === currentGroupType) {
      groupItems.push(list[index + 1])
      index += 1
    }

    result.push(...summarizeGroup(groupItems))
  }

  return result
}
