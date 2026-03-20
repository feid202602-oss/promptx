import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createClaudeNormalizationState,
  extractClaudeAssistantText,
  extractClaudeResultText,
  extractClaudeSessionId,
  normalizeClaudeEvent,
  normalizeClaudeEvents,
} from './claudeCodeRunner.js'

test('extractClaudeAssistantText joins nested text parts', () => {
  const text = extractClaudeAssistantText({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    },
  })

  assert.equal(text, '第一段\n第二段')
})

test('extractClaudeSessionId reads common session id fields', () => {
  assert.equal(extractClaudeSessionId({ session_id: 'claude-session-1' }), 'claude-session-1')
  assert.equal(extractClaudeSessionId({ result: { session_id: 'claude-session-2' } }), 'claude-session-2')
})

test('normalizeClaudeEvent maps assistant output to agent message', () => {
  assert.deepEqual(
    normalizeClaudeEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: '已完成修改' }],
      },
    }),
    {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: '已完成修改',
      },
    }
  )
})

test('normalizeClaudeEvent maps result output to turn completion', () => {
  assert.deepEqual(
    normalizeClaudeEvent({
      type: 'result',
      result: '最终回复',
    }),
    {
      type: 'turn.completed',
      result: '最终回复',
    }
  )

  assert.equal(extractClaudeResultText({ result: '最终回复' }), '最终回复')
})

test('normalizeClaudeEvents maps system init to thread start', () => {
  assert.deepEqual(
    normalizeClaudeEvents({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-init',
    }),
    [{
      type: 'thread.started',
      thread_id: 'claude-session-init',
    }]
  )
})

test('normalizeClaudeEvents maps thinking, tool use and text blocks', () => {
  const state = createClaudeNormalizationState()

  assert.deepEqual(
    normalizeClaudeEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: '先看看目录结构' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls -1' } },
          { type: 'text', text: '已查看完成' },
        ],
      },
    }, state),
    [
      {
        type: 'item.started',
        item: {
          type: 'reasoning',
          text: '先看看目录结构',
        },
      },
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'Bash: ls -1',
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: '已查看完成',
        },
      },
    ]
  )
})

test('normalizeClaudeEvents maps tool results back to remembered tool call', () => {
  const state = createClaudeNormalizationState()
  normalizeClaudeEvents({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'pwd' } },
      ],
    },
  }, state)

  assert.deepEqual(
    normalizeClaudeEvents({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tool-2', content: '/tmp/demo', is_error: false },
        ],
      },
    }, state),
    [{
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'Bash: pwd',
        status: 'completed',
        exit_code: 0,
        aggregated_output: '/tmp/demo',
      },
    }]
  )
})
