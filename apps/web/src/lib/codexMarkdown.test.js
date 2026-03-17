import assert from 'node:assert/strict'
import test from 'node:test'

import { renderCodexMarkdown } from './codexMarkdown.js'

test('renderCodexMarkdown renders fenced code blocks and lists', () => {
  const html = renderCodexMarkdown([
    '# 标题',
    '',
    '- 一',
    '- 二',
    '',
    '```js',
    'console.log(1)',
    '```',
  ].join('\n'))

  assert.match(html, /<ul>/)
  assert.match(html, /<pre><code class="language-js">/)
  assert.match(html, /console\.log\(1\)/)
})

test('renderCodexMarkdown escapes raw html and hardens links', () => {
  const html = renderCodexMarkdown('<script>alert(1)</script>\n\n[link](https://example.com)')

  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noreferrer noopener"/)
})
