import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTempFilePath,
  getSafeTempExtension,
  normalizeUploadFileName,
} from './upload.js'

test('normalizeUploadFileName 保留基础文件名并支持回退值', () => {
  assert.equal(normalizeUploadFileName('C:\\temp\\测试文档.PDF'), '测试文档.PDF')
  assert.equal(normalizeUploadFileName(''), 'file')
  assert.equal(normalizeUploadFileName('', 'task.pdf'), 'task.pdf')
})

test('getSafeTempExtension 只保留安全扩展名', () => {
  assert.equal(getSafeTempExtension('测试文档.PDF'), '.pdf')
  assert.equal(getSafeTempExtension('archive.tar.gz'), '.gz')
  assert.equal(getSafeTempExtension('README'), '')
  assert.equal(getSafeTempExtension('evil.<script>', '.txt'), '.txt')
})

test('createTempFilePath 生成 ASCII 临时文件名并保留扩展名', () => {
  const tempPath = createTempFilePath('D:\\code\\tmpprompt\\apps\\server\\tmp', '受试者招募反馈.pdf', '.pdf')
  const baseName = path.basename(tempPath)

  assert.match(baseName, /^[A-Za-z0-9_-]{12}\.pdf$/)
  assert.doesNotMatch(baseName, /[^\x00-\x7F]/)
  assert.equal(path.dirname(tempPath), 'D:\\code\\tmpprompt\\apps\\server\\tmp')
})
