import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
})

const defaultLinkOpenRule = markdown.renderer.rules.link_open

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noreferrer noopener')

  if (typeof defaultLinkOpenRule === 'function') {
    return defaultLinkOpenRule(tokens, idx, options, env, self)
  }

  return self.renderToken(tokens, idx, options)
}

export function renderCodexMarkdown(value = '') {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }

  return markdown.render(text)
}
