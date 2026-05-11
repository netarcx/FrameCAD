import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'

let mockProjectPath = ''
let mockUsername = 'tfox'

// Mock git: getProjectPath / getGit + pull/push helpers used by meta.ts.
// pullRemoteFile and commitAndPushFile are no-ops in tests (no real repo).
vi.mock('./git', () => ({
  getProjectPath: () => mockProjectPath,
  getGit: () => ({
    getConfig: () => Promise.resolve({ value: mockUsername })
  }),
  pullRemoteFile: vi.fn().mockResolvedValue(undefined),
  commitAndPushFile: vi.fn().mockResolvedValue(undefined)
}))

import * as meta from './meta'

describe('meta module', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'trentcad-meta-test-'))
    mockProjectPath = tempDir
    mockUsername = 'tfox'
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('getPartMeta', () => {
    it('returns an empty object when no metadata file exists', async () => {
      const result = await meta.getPartMeta('Drivetrain/foo.sldprt')
      expect(result).toEqual({})
    })

    it('returns an empty object for a file with no entry', async () => {
      await fs.mkdir(path.join(tempDir, '.trentcad'), { recursive: true })
      await fs.writeFile(
        path.join(tempDir, '.trentcad', 'parts-meta.json'),
        JSON.stringify({ 'OtherFile.sldprt': { release: { state: 'released' } } })
      )
      const result = await meta.getPartMeta('Drivetrain/foo.sldprt')
      expect(result).toEqual({})
    })

    it('returns existing entry data', async () => {
      await fs.mkdir(path.join(tempDir, '.trentcad'), { recursive: true })
      await fs.writeFile(
        path.join(tempDir, '.trentcad', 'parts-meta.json'),
        JSON.stringify({
          'foo.sldprt': {
            release: { state: 'in-review', by: 'alex', at: '2026-01-01T00:00:00Z' },
            comments: [{ id: 'c1', author: 'sam', text: 'fix this', at: '2026-01-01T00:00:00Z' }]
          }
        })
      )
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.release?.state).toBe('in-review')
      expect(result.comments).toHaveLength(1)
    })
  })

  describe('setReleaseState', () => {
    it('writes release state with the current git user', async () => {
      await meta.setReleaseState('foo.sldprt', 'released')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.release?.state).toBe('released')
      expect(result.release?.by).toBe('tfox')
      expect(result.release?.at).toBeDefined()
    })

    it('preserves comments when changing release state', async () => {
      await meta.addComment('foo.sldprt', 'first thought')
      await meta.setReleaseState('foo.sldprt', 'released')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.comments).toHaveLength(1)
      expect(result.release?.state).toBe('released')
    })

    it('attaches a release note when provided', async () => {
      await meta.setReleaseState('foo.sldprt', 'released', 'approved by mentor')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.release?.note).toBe('approved by mentor')
    })

    it('drops whitespace-only release notes', async () => {
      await meta.setReleaseState('foo.sldprt', 'released', '   ')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.release?.note).toBeUndefined()
    })
  })

  describe('addComment', () => {
    it('appends a comment with author and timestamp', async () => {
      await meta.addComment('foo.sldprt', 'rethink web pattern')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.comments).toHaveLength(1)
      expect(result.comments![0].text).toBe('rethink web pattern')
      expect(result.comments![0].author).toBe('tfox')
      expect(result.comments![0].id).toMatch(/^c-/)
    })

    it('keeps comments in chronological order across multiple posts', async () => {
      await meta.addComment('foo.sldprt', 'first')
      mockUsername = 'alex'
      await meta.addComment('foo.sldprt', 'second')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.comments).toHaveLength(2)
      expect(result.comments![0].text).toBe('first')
      expect(result.comments![1].text).toBe('second')
      expect(result.comments![0].author).toBe('tfox')
      expect(result.comments![1].author).toBe('alex')
    })

    it('rejects empty comments', async () => {
      await expect(meta.addComment('foo.sldprt', '   ')).rejects.toThrow(/empty/i)
    })

    it('trims whitespace from comment text', async () => {
      await meta.addComment('foo.sldprt', '  hello  ')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.comments![0].text).toBe('hello')
    })
  })

  describe('setManufacturingNotes', () => {
    it('stores notes verbatim including newlines', async () => {
      const notes = '1/4" 6061\ndeburr edges\ntap M6 hole'
      await meta.setManufacturingNotes('foo.sldprt', notes)
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.manufacturingNotes).toBe(notes)
    })

    it('overwrites previous notes', async () => {
      await meta.setManufacturingNotes('foo.sldprt', 'old notes')
      await meta.setManufacturingNotes('foo.sldprt', 'new notes')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.manufacturingNotes).toBe('new notes')
    })

    it('preserves release state and comments', async () => {
      await meta.setReleaseState('foo.sldprt', 'in-review')
      await meta.addComment('foo.sldprt', 'a comment')
      await meta.setManufacturingNotes('foo.sldprt', 'machined here')
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.release?.state).toBe('in-review')
      expect(result.comments).toHaveLength(1)
      expect(result.manufacturingNotes).toBe('machined here')
    })
  })

  describe('annotateMeta', () => {
    it('stamps releaseState and commentCount onto matching file entries', async () => {
      await meta.setReleaseState('Drivetrain/foo.sldprt', 'released')
      await meta.addComment('Drivetrain/foo.sldprt', 'comment 1')
      await meta.addComment('Drivetrain/foo.sldprt', 'comment 2')
      const all = await meta.loadAllMeta()
      const entries = [
        { path: 'Drivetrain', isDirectory: true, children: [
          { path: 'Drivetrain/foo.sldprt', isDirectory: false },
          { path: 'Drivetrain/bar.sldprt', isDirectory: false }
        ] }
      ]
      meta.annotateMeta(entries as never, all)
      const drivetrain = entries[0] as unknown as { children: Array<{ path: string; releaseState?: string; commentCount?: number }> }
      const foo = drivetrain.children.find(c => c.path === 'Drivetrain/foo.sldprt')!
      const bar = drivetrain.children.find(c => c.path === 'Drivetrain/bar.sldprt')!
      expect(foo.releaseState).toBe('released')
      expect(foo.commentCount).toBe(2)
      expect(bar.releaseState).toBeUndefined()
      expect(bar.commentCount).toBeUndefined()
    })
  })

  it('multiple files keep independent metadata', async () => {
    await meta.setReleaseState('a.sldprt', 'released')
    await meta.setReleaseState('b.sldprt', 'in-review')
    await meta.addComment('a.sldprt', 'about a')

    const a = await meta.getPartMeta('a.sldprt')
    const b = await meta.getPartMeta('b.sldprt')
    expect(a.release?.state).toBe('released')
    expect(b.release?.state).toBe('in-review')
    expect(a.comments).toHaveLength(1)
    expect(b.comments).toBeUndefined()
  })
})
