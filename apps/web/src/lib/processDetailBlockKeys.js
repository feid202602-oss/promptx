function hashString(value = '') {
  let hash = 5381
  for (const char of String(value || '')) {
    hash = ((hash << 5) + hash) + char.charCodeAt(0)
    hash |= 0
  }
  return String(hash >>> 0)
}

function getBlockSignature(block = {}) {
  const stableId = String(block?.id || '').trim()
  if (stableId) {
    return `id:${stableId}`
  }

  return `${block?.type || 'block'}:${hashString(JSON.stringify(block || {}))}`
}

function countSignatures(entries = []) {
  return entries.reduce((counts, entry) => {
    const signature = String(entry?.signature || '')
    if (!signature) {
      return counts
    }

    counts.set(signature, (counts.get(signature) || 0) + 1)
    return counts
  }, new Map())
}

export function createProcessDetailBlockKeyEntries(blocks = []) {
  const list = Array.isArray(blocks) ? blocks : []
  const totalBySignature = list.reduce((counts, block) => {
    const signature = getBlockSignature(block)
    counts.set(signature, (counts.get(signature) || 0) + 1)
    return counts
  }, new Map())

  const occurrenceMap = new Map()
  return list.map((block) => {
    const signature = getBlockSignature(block)
    const occurrence = (occurrenceMap.get(signature) || 0) + 1
    occurrenceMap.set(signature, occurrence)

    return {
      key: `${signature}:${occurrence}`,
      signature,
      occurrence,
      duplicateCount: totalBySignature.get(signature) || 1,
    }
  })
}

export function reconcileExpandedProcessDetailKeys(expandedKeys, previousEntries = [], nextEntries = []) {
  const currentExpandedKeys = expandedKeys instanceof Set ? expandedKeys : new Set(expandedKeys || [])
  const nextKeySet = new Set(nextEntries.map((entry) => entry.key))

  const previousKeyList = previousEntries.map((entry) => entry.key)
  const nextKeyList = nextEntries.map((entry) => entry.key)
  const keyListChanged = (
    previousKeyList.length !== nextKeyList.length
    || previousKeyList.some((key, index) => key !== nextKeyList[index])
  )

  if (!keyListChanged) {
    return new Set([...currentExpandedKeys].filter((key) => nextKeySet.has(key)))
  }

  const previousCounts = countSignatures(previousEntries)
  const nextCounts = countSignatures(nextEntries)
  const signatureByKey = new Map([
    ...previousEntries.map((entry) => [entry.key, entry.signature]),
    ...nextEntries.map((entry) => [entry.key, entry.signature]),
  ])
  const unstableSignatures = new Set([
    ...previousCounts.keys(),
    ...nextCounts.keys(),
  ].filter((signature) => {
    const previousCount = previousCounts.get(signature) || 0
    const nextCount = nextCounts.get(signature) || 0
    return previousCount !== nextCount || previousCount > 1 || nextCount > 1
  }))

  return new Set(
    [...currentExpandedKeys].filter((key) => {
      if (!nextKeySet.has(key)) {
        return false
      }

      const signature = signatureByKey.get(key)
      return signature ? !unstableSignatures.has(signature) : false
    })
  )
}
