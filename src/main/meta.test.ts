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

  describe('setPartMass / setPartCost', () => {
    it('stores and clears mass via null', async () => {
      await meta.setPartMass('foo.sldprt', 1.25)
      expect((await meta.getPartMeta('foo.sldprt')).mass).toBe(1.25)
      await meta.setPartMass('foo.sldprt', null)
      expect((await meta.getPartMeta('foo.sldprt')).mass).toBeUndefined()
    })

    it('stores and clears cost via null', async () => {
      await meta.setPartCost('foo.sldprt', 99.99)
      expect((await meta.getPartMeta('foo.sldprt')).cost).toBe(99.99)
      await meta.setPartCost('foo.sldprt', null)
      expect((await meta.getPartMeta('foo.sldprt')).cost).toBeUndefined()
    })

    it('rejects negative mass', async () => {
      await expect(meta.setPartMass('foo.sldprt', -1)).rejects.toThrow(/non-negative/i)
    })

    it('rejects non-finite mass', async () => {
      await expect(meta.setPartMass('foo.sldprt', NaN)).rejects.toThrow(/non-negative/i)
      await expect(meta.setPartMass('foo.sldprt', Infinity)).rejects.toThrow(/non-negative/i)
    })

    it('rejects negative cost', async () => {
      await expect(meta.setPartCost('foo.sldprt', -10)).rejects.toThrow(/non-negative/i)
    })

    it('keeps mass and cost independent', async () => {
      await meta.setPartMass('foo.sldprt', 2.5)
      await meta.setPartCost('foo.sldprt', 50)
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.mass).toBe(2.5)
      expect(result.cost).toBe(50)
    })

    it('preserves comments and release state', async () => {
      await meta.addComment('foo.sldprt', 'hello')
      await meta.setReleaseState('foo.sldprt', 'released')
      await meta.setPartMass('foo.sldprt', 1.0)
      const result = await meta.getPartMeta('foo.sldprt')
      expect(result.comments).toHaveLength(1)
      expect(result.release?.state).toBe('released')
      expect(result.mass).toBe(1.0)
    })
  })

  describe('setManufacturingMethod / setManufacturingMaterial', () => {
    it('stores manufacturing method', async () => {
      await meta.setManufacturingMethod('foo.sldprt', 'cnc')
      expect((await meta.getPartMeta('foo.sldprt')).manufacturingMethod).toBe('cnc')
    })

    it('clears manufacturing method via null', async () => {
      await meta.setManufacturingMethod('foo.sldprt', 'print')
      await meta.setManufacturingMethod('foo.sldprt', null)
      expect((await meta.getPartMeta('foo.sldprt')).manufacturingMethod).toBeUndefined()
    })

    it('trims and stores material', async () => {
      await meta.setManufacturingMaterial('foo.sldprt', '  6061-T6  ')
      expect((await meta.getPartMeta('foo.sldprt')).manufacturingMaterial).toBe('6061-T6')
    })

    it('clears material when given empty string', async () => {
      await meta.setManufacturingMaterial('foo.sldprt', '6061')
      await meta.setManufacturingMaterial('foo.sldprt', '')
      expect((await meta.getPartMeta('foo.sldprt')).manufacturingMaterial).toBeUndefined()
    })
  })

  describe('getManufacturingQueue', () => {
    it('returns empty for empty project', async () => {
      const queue = await meta.getManufacturingQueue()
      expect(queue).toEqual([])
    })

    it('only includes parts in the released state', async () => {
      await meta.setReleaseState('draft.sldprt', 'draft')
      await meta.setReleaseState('review.sldprt', 'in-review')
      await meta.setReleaseState('ready.sldprt', 'released')
      await meta.setReleaseState('made.sldprt', 'manufactured')
      const queue = await meta.getManufacturingQueue()
      expect(queue.map(i => i.path)).toEqual(['ready.sldprt'])
    })

    it('orders oldest-released first', async () => {
      await meta.setReleaseState('a.sldprt', 'released')
      // small wait so timestamps differ
      await new Promise(r => setTimeout(r, 5))
      await meta.setReleaseState('b.sldprt', 'released')
      await new Promise(r => setTimeout(r, 5))
      await meta.setReleaseState('c.sldprt', 'released')
      const queue = await meta.getManufacturingQueue()
      expect(queue.map(i => i.path)).toEqual(['a.sldprt', 'b.sldprt', 'c.sldprt'])
    })

    it('includes method, material, mass, notes in queue items', async () => {
      await meta.setPartMass('foo.sldprt', 2.5)
      await meta.setManufacturingMethod('foo.sldprt', 'cnc')
      await meta.setManufacturingMaterial('foo.sldprt', '6061')
      await meta.setManufacturingNotes('foo.sldprt', 'tap M6 holes')
      await meta.setReleaseState('foo.sldprt', 'released')
      const queue = await meta.getManufacturingQueue()
      expect(queue).toHaveLength(1)
      expect(queue[0].method).toBe('cnc')
      expect(queue[0].material).toBe('6061')
      expect(queue[0].mass).toBe(2.5)
      expect(queue[0].notes).toBe('tap M6 holes')
      expect(queue[0].releasedBy).toBe('tfox')
    })

    it('defaults method to "other" when not set', async () => {
      await meta.setReleaseState('foo.sldprt', 'released')
      const queue = await meta.getManufacturingQueue()
      expect(queue[0].method).toBe('other')
    })
  })

  describe('getProjectTotals', () => {
    it('returns zeros for an empty project', async () => {
      const totals = await meta.getProjectTotals()
      expect(totals).toEqual({ mass: 0, cost: 0, partsWithMass: 0, partsWithCost: 0, totalParts: 0 })
    })

    it('sums mass and cost across all parts', async () => {
      await meta.setPartMass('a.sldprt', 1.5)
      await meta.setPartMass('b.sldprt', 2.5)
      await meta.setPartMass('c.sldprt', 0.25)
      await meta.setPartCost('a.sldprt', 100)
      await meta.setPartCost('b.sldprt', 200)
      const totals = await meta.getProjectTotals()
      expect(totals.mass).toBeCloseTo(4.25, 4)
      expect(totals.cost).toBe(300)
      expect(totals.partsWithMass).toBe(3)
      expect(totals.partsWithCost).toBe(2)
      expect(totals.totalParts).toBe(3)
    })

    it('ignores zero mass or cost when counting populated parts', async () => {
      await meta.setPartMass('a.sldprt', 1.5)
      await meta.setPartMass('b.sldprt', 0)
      const totals = await meta.getProjectTotals()
      expect(totals.partsWithMass).toBe(1)
      expect(totals.mass).toBe(1.5)
    })

    it('counts parts that have any metadata at all', async () => {
      await meta.addComment('a.sldprt', 'no mass yet')
      const totals = await meta.getProjectTotals()
      expect(totals.totalParts).toBe(1)
      expect(totals.partsWithMass).toBe(0)
      expect(totals.partsWithCost).toBe(0)
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
