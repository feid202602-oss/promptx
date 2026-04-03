const ANSI_OSC_PATTERN = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
const ANSI_CSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_ESCAPE_PATTERN = /\u001B[@-_]/g
const OTHER_CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g

function stripBackspaces(value = '') {
  let result = ''
  for (const char of String(value || '')) {
    if (char === '\b' || char === '\u007F') {
      result = result.slice(0, -1)
      continue
    }
    result += char
  }
  return result
}

export function sanitizeProcessDetailText(value = '') {
  return stripBackspaces(String(value || ''))
    .replace(ANSI_OSC_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(OTHER_CONTROL_PATTERN, '')
}

function normalizeText(value = '') {
  return sanitizeProcessDetailText(value)
}

function trimBoundaryBlankLines(value = '') {
  return String(value || '')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '')
}

function limitItems(items = [], max = 12) {
  const list = Array.isArray(items) ? items : []
  if (list.length <= max) {
    return { items: list, hiddenCount: 0 }
  }

  return {
    items: list.slice(0, max),
    hiddenCount: list.length - max,
  }
}

function parseHeaderMeta(text = '') {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n')
  const firstLine = String(lines[0] || '').trim()
  if (!firstLine) {
    return null
  }

  const matched = firstLine.match(/^([A-Za-z][A-Za-z0-9 _/-]{1,24}):\s*(.+)$/)
  if (!matched) {
    return null
  }

  const rest = trimBoundaryBlankLines(lines.slice(1).join('\n'))
  return {
    meta: {
      type: 'meta',
      items: [
        {
          label: matched[1].trim(),
          value: matched[2].trim(),
        },
      ],
    },
    rest,
  }
}

function parseXmlDirectoryBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim() || !normalized.includes('<path>') || !normalized.includes('<entries>')) {
    return null
  }

  const pathMatch = normalized.match(/<path>([\s\S]*?)<\/path>/i)
  const typeMatch = normalized.match(/<type>([\s\S]*?)<\/type>/i)
  const entriesMatch = normalized.match(/<entries>([\s\S]*?)<\/entries>/i)

  if (!pathMatch && !entriesMatch) {
    return null
  }

  const rawEntries = String(entriesMatch?.[1] || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(\d+\s+entries?\)$/i.test(line))

  const { items, hiddenCount } = limitItems(rawEntries, options.maxItems ?? 12)
  return {
    type: 'directory_list',
    path: String(pathMatch?.[1] || '').trim(),
    entryType: String(typeMatch?.[1] || '').trim(),
    entries: items,
    totalCount: rawEntries.length,
    hiddenCount,
  }
}

function parseChecklistBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n').map((line) => line.trimEnd())
  const parsed = lines
    .map((line) => {
      const matched = line.match(/^\s*\[([ xX])\]\s+(.+)$/)
      if (!matched) {
        return null
      }

      return {
        completed: matched[1].toLowerCase() === 'x',
        text: matched[2].trim(),
      }
    })
    .filter(Boolean)

  if (!parsed.length || parsed.length < Math.ceil(lines.filter(Boolean).length * 0.6)) {
    return null
  }

  const { items, hiddenCount } = limitItems(parsed, options.maxItems ?? 12)
  return {
    type: 'checklist',
    items,
    totalCount: parsed.length,
    hiddenCount,
  }
}

function parseBuildErrorBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim() || !/(build failed|error during build)/i.test(normalized)) {
    return null
  }

  const lines = normalized.split('\n').map((line) => line.trimEnd())
  const errorCodeMatch = lines
    .map((line) => line.match(/^\[([A-Z0-9_ -]+)\]\s*Error:?$/i))
    .find(Boolean)
  const locationMatch = normalized.match(/\[\s*([^[\]]+?):(\d+):(\d+)\s*\]/)
  const frameLines = lines
    .map((line) => {
      const matched = line.match(/^\s*(\d+)\s*[│|]\s?(.*)$/)
      if (!matched) {
        return null
      }

      return {
        number: matched[1],
        content: matched[2] || '',
      }
    })
    .filter(Boolean)

  const summaryStartIndex = Math.max(
    lines.findIndex((line) => /^\[([A-Z0-9_ -]+)\]\s*Error:?$/i.test(line)),
    lines.findIndex((line) => /^error during build:?$/i.test(line))
  )
  const summary = lines
    .slice(summaryStartIndex >= 0 ? summaryStartIndex + 1 : 0)
    .map((line) => line.trim())
    .find((line) => (
      line
      && !/^build failed/i.test(line)
      && !/^error during build:?$/i.test(line)
      && !/^[╭╰│─]+/.test(line)
      && !/^\[\s*[^[]+:\d+:\d+\s*\]$/.test(line)
    )) || ''

  if (!summary && !locationMatch && !frameLines.length) {
    return null
  }

  const { items, hiddenCount } = limitItems(frameLines, options.maxItems ?? 8)

  return {
    type: 'build_error',
    title: lines.find((line) => /^build failed/i.test(line)) || '',
    errorCode: String(errorCodeMatch?.[1] || '').trim(),
    summary,
    location: locationMatch ? {
      path: String(locationMatch[1] || '').trim(),
      line: String(locationMatch[2] || '').trim(),
      column: String(locationMatch[3] || '').trim(),
    } : null,
    lines: items,
    totalCount: frameLines.length,
    hiddenCount,
  }
}

function looksLikeTerminalCodeLine(value = '') {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return false
  }

  return (
    /^@[^/\s]+\/[^@\s]+@\d+(?:\.\d+)*(?:[-+][A-Za-z0-9.-]+)?\s+\w+/.test(normalized)
    || /^[/~.]/.test(normalized)
    || /^[A-Za-z]:[\\/]/.test(normalized)
    || /^\$?\s*(pnpm|npm|yarn|node|git|rg|grep|vite|uv|bash|zsh|sh|python|npx)\b/.test(normalized)
    || /^(?:M|MM|A|D|R|C|U|UU|AM|\?\?)\s+\S+/.test(normalized)
    || /^Scope:\s+\d+\s+of\s+\d+\s+workspace projects$/i.test(normalized)
    || /^[A-Za-z0-9@/_.-]+\s+(?:build|dev|test|lint|start|typecheck)(?:\$|:)\s+.+$/.test(normalized)
    || /^[A-Za-z0-9@/_.-]+\s+(?:build|dev|test|lint|start|typecheck):\s+Done$/i.test(normalized)
    || /^--?[A-Za-z0-9][A-Za-z0-9-]*(?:[=\s]|$)/.test(normalized)
    || /\s\|\s+\d+/.test(normalized)
    || /[+]{3,}|[-]{3,}/.test(normalized)
    || /\b(files changed|insertions?\(\+\)|deletions?\(-\))\b/i.test(normalized)
  )
}

function parseCodeTextBlock(text = '') {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n').filter(Boolean)
  if (!lines.length) {
    return null
  }

  const matchedCount = lines.filter((line) => looksLikeTerminalCodeLine(line)).length
  const singleLine = lines.length === 1 && looksLikeTerminalCodeLine(lines[0])
  const mostlyCodeLike = lines.length >= 2 && matchedCount >= Math.ceil(lines.length * 0.6)

  if (!singleLine && !mostlyCodeLike) {
    return null
  }

  return {
    type: 'code_text',
    text: normalized,
  }
}

function looksLikeSearchResultPath(value = '') {
  const normalized = String(value || '').trim()
  if (!normalized || /^\d+$/.test(normalized)) {
    return false
  }

  return /[\\/._-]/.test(normalized) || /^[A-Za-z]:/.test(normalized)
}

function parseSearchResultsBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n')
  const parsed = lines
    .map((line) => {
      const matched = line.match(/^(.*?):(\d+):(.*)$/)
      if (!matched) {
        return null
      }

      const filePath = String(matched[1] || '').trim()
      if (!looksLikeSearchResultPath(filePath)) {
        return null
      }

      return {
        path: filePath,
        number: matched[2],
        content: matched[3] || '',
      }
    })
    .filter(Boolean)

  if (!parsed.length || parsed.length < Math.ceil(lines.filter(Boolean).length * 0.6)) {
    return null
  }

  const matchesByPath = new Map()
  const orderedPaths = []

  parsed.forEach((item) => {
    if (!matchesByPath.has(item.path)) {
      matchesByPath.set(item.path, [])
      orderedPaths.push(item.path)
    }
    matchesByPath.get(item.path).push({
      number: item.number,
      content: item.content,
    })
  })

  const maxFiles = Math.max(1, Number(options.maxSearchFiles) || 4)
  const maxMatchesPerFile = Math.max(1, Number(options.maxSearchMatchesPerFile) || 5)
  const files = orderedPaths.slice(0, maxFiles).map((filePath) => {
    const matches = matchesByPath.get(filePath) || []
    const { items, hiddenCount } = limitItems(matches, maxMatchesPerFile)
    return {
      path: filePath,
      matches: items,
      totalCount: matches.length,
      hiddenCount,
    }
  })

  return {
    type: 'search_results',
    files,
    fileCount: orderedPaths.length,
    totalCount: parsed.length,
    hiddenFileCount: Math.max(0, orderedPaths.length - files.length),
  }
}

function parseCodeSnippetBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n')
  const parsed = lines
    .map((line) => {
      const matched = line.match(/^(\d+)\s*:\s?(.*)$/)
      if (!matched) {
        return null
      }

      return {
        number: matched[1],
        content: matched[2] || '',
      }
    })
    .filter(Boolean)

  if (parsed.length < 2 || parsed.length < Math.ceil(lines.filter(Boolean).length * 0.6)) {
    return null
  }

  const { items, hiddenCount } = limitItems(parsed, options.maxItems ?? 12)
  return {
    type: 'code_snippet',
    lines: items,
    totalCount: parsed.length,
    hiddenCount,
  }
}

function parseUnifiedDiffBlock(text = '') {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const hasGitDiffHeader = /^diff --git\s+/m.test(normalized)
  const hasPatchMarkers = /^---\s+\S+/m.test(normalized) && /^\+\+\+\s+\S+/m.test(normalized)
  const hasHunkHeader = /^@@\s+[-+,\d]+\s+[-+,\d]+\s+@@/m.test(normalized)

  if (!hasGitDiffHeader && !(hasPatchMarkers && hasHunkHeader)) {
    return null
  }

  return {
    type: 'code_text',
    text: normalized,
  }
}

function parseNumberedLinesBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n')
  const parsed = lines
    .map((line) => {
      const matched = (
        line.match(/^(\d+)[-.)]\s*(.*)$/)
        || line.match(/^\s*(\d+)(?:\t+| {2,})(.*)$/)
        || line.match(/^\s*(\d+)\s*$/)
      )
      if (!matched) {
        return null
      }

      return {
        number: matched[1],
        content: matched[2] || '',
      }
    })
    .filter(Boolean)

  if (parsed.length < 3 || parsed.length < Math.ceil(lines.filter(Boolean).length * 0.6)) {
    return null
  }

  const { items, hiddenCount } = limitItems(parsed, options.maxItems ?? 15)
  return {
    type: 'numbered_lines',
    items,
    totalCount: parsed.length,
    hiddenCount,
  }
}

function parseBulletListBlock(text = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(text))
  if (!normalized.trim()) {
    return null
  }

  const lines = normalized.split('\n')
  const parsed = lines
    .map((line) => {
      const matched = line.match(/^[-*]\s+(.+)$/)
      return matched ? matched[1].trim() : null
    })
    .filter(Boolean)

  if (parsed.length < 2 || parsed.length < Math.ceil(lines.filter(Boolean).length * 0.6)) {
    return null
  }

  const { items, hiddenCount } = limitItems(parsed, options.maxItems ?? 12)
  return {
    type: 'bullet_list',
    items,
    totalCount: parsed.length,
    hiddenCount,
  }
}

function shouldPreferMarkdown(text = '') {
  return /```|^\s*#{1,4}\s+|^\s*>\s+/m.test(text)
}

function createFallbackTextBlock(text = '', options = {}) {
  return {
    type: shouldPreferMarkdown(text) || options.preferMarkdown ? 'markdown' : 'text',
    text,
  }
}

function mergeAdjacentTextBlocks(blocks = []) {
  return blocks.reduce((result, block) => {
    const previous = result[result.length - 1]
    if (
      previous
      && block
      && previous.type === block.type
      && ['text', 'markdown'].includes(block.type)
    ) {
      previous.text = `${previous.text}\n\n${block.text}`
      return result
    }

    result.push(block)
    return result
  }, [])
}

function parseMixedContentBlocks(text = '', options = {}) {
  const segments = String(text || '')
    .split(/\n{2,}/)
    .map((segment) => trimBoundaryBlankLines(segment))
    .filter((segment) => segment.trim())

  if (segments.length < 2) {
    return null
  }

  const parsed = mergeAdjacentTextBlocks(segments.flatMap((segment) => (
    parseProcessDetailTextBlocks(segment, { ...options, _disableMixedSegmentation: true })
  )))
  const hasStructuredBlock = parsed.some((block) => !['text', 'markdown'].includes(block?.type))
  const hasPlainBlock = parsed.some((block) => ['text', 'markdown'].includes(block?.type))
  return hasStructuredBlock && hasPlainBlock ? parsed : null
}

export function parseProcessDetailTextBlocks(value = '', options = {}) {
  const normalized = trimBoundaryBlankLines(normalizeText(value))
  if (!normalized.trim()) {
    return []
  }

  const header = parseHeaderMeta(normalized)
  if (header?.rest) {
    const innerBlocks = parseProcessDetailTextBlocks(header.rest, options)
    return [header.meta, ...(innerBlocks.length ? innerBlocks : [{ type: 'text', text: header.rest }])]
  }

  const directoryBlock = parseXmlDirectoryBlock(normalized, options)
  if (directoryBlock) {
    return [directoryBlock]
  }

  const checklistBlock = parseChecklistBlock(normalized, options)
  if (checklistBlock) {
    return [checklistBlock]
  }

  const buildErrorBlock = parseBuildErrorBlock(normalized, options)
  if (buildErrorBlock) {
    return [buildErrorBlock]
  }

  const searchResultsBlock = parseSearchResultsBlock(normalized, options)
  if (searchResultsBlock) {
    return [searchResultsBlock]
  }

  const codeSnippetBlock = parseCodeSnippetBlock(normalized, options)
  if (codeSnippetBlock) {
    return [codeSnippetBlock]
  }

  const unifiedDiffBlock = parseUnifiedDiffBlock(normalized)
  if (unifiedDiffBlock) {
    return [unifiedDiffBlock]
  }

  const numberedLinesBlock = parseNumberedLinesBlock(normalized, options)
  if (numberedLinesBlock) {
    return [numberedLinesBlock]
  }

  const bulletListBlock = parseBulletListBlock(normalized, options)
  if (bulletListBlock) {
    return [bulletListBlock]
  }

  if (!options._disableMixedSegmentation) {
    const mixedBlocks = parseMixedContentBlocks(normalized, options)
    if (mixedBlocks?.length) {
      return mixedBlocks
    }
  }

  const codeTextBlock = parseCodeTextBlock(normalized)
  if (codeTextBlock) {
    return [codeTextBlock]
  }

  return [createFallbackTextBlock(normalized, options)]
}

export {
  parseBuildErrorBlock,
}
