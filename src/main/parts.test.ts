import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'

// parts.ts imports getProjectPath / pullPartsJson / pushPartsJson from ./git.
// Mock those so we don't need a real git repo with a remote.
let mockProjectPath = ''
vi.mock('./git', () => ({
  getProjectPath: () => mockProjectPath,
  pullPartsJson: vi.fn().mockResolvedValue(undefined),
  pushPartsJson: vi.fn().mockResolvedValue(undefined)
}))

// Pin the build-time team prefix so the part-numbering tests keep
// asserting concrete strings instead of branching on the env-var
// state of the host. Verifies the migration behaviour against the
// historical 2129 team segment.
vi.mock('./branding', () => ({
  getBuildDefaultPrefix: () => '2129',
  getBuildDefaultTeamName: () => null,
  getBuildDefaultIssueRepo: () => null
}))

import * as parts from './parts'

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(dir, 'parts.json'), 'utf-8')
  return JSON.parse(raw)
}

describe('parts.classifyFile', () => {
  it('returns "part" for .sldprt', () => {
    expect(parts.classifyFile('foo.sldprt')).toBe('part')
  })

  it('returns "assembly" for .sldasm', () => {
    expect(parts.classifyFile('foo.sldasm')).toBe('assembly')
  })

  it('returns "drawing" for .slddrw', () => {
    expect(parts.classifyFile('foo.slddrw')).toBe('drawing')
  })

  it('is case-insensitive', () => {
    expect(parts.classifyFile('FOO.SLDPRT')).toBe('part')
    expect(parts.classifyFile('Foo.SldAsm')).toBe('assembly')
  })

  it('returns null for non-SolidWorks files', () => {
    expect(parts.classifyFile('foo.txt')).toBeNull()
    expect(parts.classifyFile('foo.step')).toBeNull()
    expect(parts.classifyFile('README.md')).toBeNull()
  })
})

describe('parts module (with temp project dir)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'trentcad-test-'))
    mockProjectPath = tempDir
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('loadManifest year prefix migration', () => {
    it('returns a default-prefix manifest when parts.json is missing', async () => {
      const manifest = await parts.loadManifest()
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(manifest.prefix).toBe(`${yy}-2129`)
    })

    it('prepends current year to a prefix that lacks one', async () => {
      await fs.writeFile(
        path.join(tempDir, 'parts.json'),
        JSON.stringify({
          prefix: '2129',
          nextCounters: {},
          nextAssemblyCounters: {},
          entries: {},
          assemblies: {}
        })
      )
      const manifest = await parts.loadManifest()
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(manifest.prefix).toBe(`${yy}-2129`)
    })

    it('leaves a prefix that already starts with YY- untouched', async () => {
      await fs.writeFile(
        path.join(tempDir, 'parts.json'),
        JSON.stringify({
          prefix: '25-2129',
          nextCounters: {},
          nextAssemblyCounters: {},
          entries: {},
          assemblies: {}
        })
      )
      const manifest = await parts.loadManifest()
      expect(manifest.prefix).toBe('25-2129')
    })
  })

  describe('createNewPart', () => {
    it('reserves sequential numbers at the project root', async () => {
      const a = await parts.createNewPart('', 'first')
      const b = await parts.createNewPart('', 'second')
      const c = await parts.createNewPart('', 'third')
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(a.partNumber).toBe(`${yy}-2129-001`)
      expect(b.partNumber).toBe(`${yy}-2129-002`)
      expect(c.partNumber).toBe(`${yy}-2129-003`)
    })

    it('returns a path matching the part number filename', async () => {
      const r = await parts.createNewPart('', 'gearbox plate')
      expect(r.filePath).toBe(`${r.partNumber}.sldprt`)
    })

    it('does NOT create an empty .sldprt file', async () => {
      const r = await parts.createNewPart('', '')
      const abs = path.join(tempDir, r.filePath)
      // The .sldprt itself should not be created (empty .sldprt = corrupt
      // according to SolidWorks). Only the parent dir + manifest are written.
      await expect(fs.stat(abs)).rejects.toThrow()
    })

    it('persists the reservation in parts.json', async () => {
      const r = await parts.createNewPart('', 'description here')
      const manifest = await readManifest(tempDir)
      const entries = manifest.entries as Record<string, { partNumber: string; description?: string }>
      expect(entries[r.filePath]).toBeDefined()
      expect(entries[r.filePath].partNumber).toBe(r.partNumber)
      expect(entries[r.filePath].description).toBe('description here')
    })

    it('nests part numbers inside a folder using the assembly segment', async () => {
      const r = await parts.createNewPart('Drivetrain', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      // First folder under root → assembly segment "01"
      expect(r.partNumber).toBe(`${yy}-2129-01-001`)
      expect(r.filePath).toBe(`Drivetrain/${r.partNumber}.sldprt`)
    })
  })

  describe('createNewAssembly', () => {
    it('reserves the assembly number for a new folder under root', async () => {
      const r = await parts.createNewAssembly('', 'Drivetrain', 'gearboxes etc')
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(r.partNumber).toBe(`${yy}-2129-01`)
      expect(r.filePath).toBe(`Drivetrain/${r.partNumber}.sldasm`)
    })

    it('creates the assembly folder and drops a .gitkeep', async () => {
      const r = await parts.createNewAssembly('', 'Drivetrain', undefined)
      const folder = path.join(tempDir, 'Drivetrain')
      const folderStat = await fs.stat(folder)
      expect(folderStat.isDirectory()).toBe(true)
      const gitkeep = await fs.stat(path.join(folder, '.gitkeep'))
      expect(gitkeep.isFile()).toBe(true)
      // .sldasm should NOT be on disk (empty .sldasm = corrupt)
      await expect(fs.stat(path.join(tempDir, r.filePath))).rejects.toThrow()
    })

    it('assigns successive assembly segments to sibling folders', async () => {
      const r1 = await parts.createNewAssembly('', 'Drivetrain', undefined)
      const r2 = await parts.createNewAssembly('', 'Intake', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(r1.partNumber).toBe(`${yy}-2129-01`)
      expect(r2.partNumber).toBe(`${yy}-2129-02`)
    })

    it('nested sub-assembly inherits the top-level folder number (no extra dash-segment)', async () => {
      // Top-level Drivetrain gets 01
      await parts.createNewAssembly('', 'Drivetrain', undefined)
      // Sub-assembly Wheels inside Drivetrain: previously was 01-01, now 01-001
      const sub = await parts.createNewAssembly('Drivetrain', 'Wheels', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(sub.partNumber).toBe(`${yy}-2129-01-001`)
      expect(sub.filePath).toBe(`Drivetrain/Wheels/${sub.partNumber}.sldasm`)
    })
  })

  describe('part numbering scope (top-level folder only)', () => {
    it('part 3 levels deep uses only the top-level folder number', async () => {
      await parts.createNewAssembly('', 'Drivetrain', undefined)
      await parts.createSubsystem('Drivetrain', 'Wheels')
      await parts.createSubsystem('Drivetrain/Wheels', 'Spokes')
      // Sub-folders share Drivetrain's counter (01); the part gets a 3-digit
      // sequence, NOT one segment per folder level
      const p = await parts.createNewPart('Drivetrain/Wheels/Spokes', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(p.partNumber).toBe(`${yy}-2129-01-001`)
    })

    it('counter is shared across all depths within a top-level folder', async () => {
      await parts.createNewAssembly('', 'Drivetrain', undefined)
      const a = await parts.createNewPart('Drivetrain', undefined)
      await parts.createSubsystem('Drivetrain', 'Wheels')
      const b = await parts.createNewPart('Drivetrain/Wheels', undefined)
      await parts.createSubsystem('Drivetrain/Wheels', 'Spokes')
      const c = await parts.createNewPart('Drivetrain/Wheels/Spokes', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(a.partNumber).toBe(`${yy}-2129-01-001`)
      expect(b.partNumber).toBe(`${yy}-2129-01-002`)
      expect(c.partNumber).toBe(`${yy}-2129-01-003`)
    })

    it('sibling top-level folders keep independent counters', async () => {
      await parts.createNewAssembly('', 'Drivetrain', undefined)
      await parts.createNewAssembly('', 'Intake', undefined)
      const d1 = await parts.createNewPart('Drivetrain', undefined)
      const i1 = await parts.createNewPart('Intake', undefined)
      const d2 = await parts.createNewPart('Drivetrain', undefined)
      const yy = new Date().getFullYear().toString().slice(-2)
      expect(d1.partNumber).toBe(`${yy}-2129-01-001`)
      expect(i1.partNumber).toBe(`${yy}-2129-02-001`)
      expect(d2.partNumber).toBe(`${yy}-2129-01-002`)
    })
  })

  describe('createSubsystem (plain folder)', () => {
    it('creates a folder with a .gitkeep', async () => {
      const r = await parts.createSubsystem('', 'Electrical')
      expect(r.folderPath).toBe('Electrical')
      const folder = path.join(tempDir, 'Electrical')
      const folderStat = await fs.stat(folder)
      expect(folderStat.isDirectory()).toBe(true)
      const gitkeep = await fs.stat(path.join(folder, '.gitkeep'))
      expect(gitkeep.isFile()).toBe(true)
    })

    it('rejects empty names', async () => {
      await expect(parts.createSubsystem('', '')).rejects.toThrow('Invalid folder name')
      await expect(parts.createSubsystem('', '   ')).rejects.toThrow('Invalid folder name')
    })

    it('rejects path traversal attempts', async () => {
      await expect(parts.createSubsystem('', '..')).rejects.toThrow()
      await expect(parts.createSubsystem('', '../etc')).rejects.toThrow()
      await expect(parts.createSubsystem('', 'foo/bar')).rejects.toThrow()
      await expect(parts.createSubsystem('', 'foo\\bar')).rejects.toThrow()
    })

    it('rejects illegal Windows filename characters', async () => {
      await expect(parts.createSubsystem('', 'has:colon')).rejects.toThrow()
      await expect(parts.createSubsystem('', 'has*star')).rejects.toThrow()
      await expect(parts.createSubsystem('', 'has?q')).rejects.toThrow()
    })

    it('accepts normal names with spaces and dashes', async () => {
      await expect(parts.createSubsystem('', 'Drive Train - 2026')).resolves.toMatchObject({
        folderPath: 'Drive Train - 2026'
      })
    })
  })

  describe('COTS-library project behavior', () => {
    async function markAsCotsProject() {
      const dir = path.join(tempDir, '.trentcad')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'admin.json'), JSON.stringify({ isCotsProject: true }))
    }

    it('createNewPart throws on a COTS-library project', async () => {
      await markAsCotsProject()
      await expect(parts.createNewPart('', 'thing')).rejects.toThrow(/COTS/i)
    })

    it('createNewAssembly throws on a COTS-library project', async () => {
      await markAsCotsProject()
      await expect(parts.createNewAssembly('', 'Drivetrain')).rejects.toThrow(/COTS/i)
    })

    it('syncManifest returns an empty manifest on a COTS-library project', async () => {
      await markAsCotsProject()
      // Even with .sldprt files lying around, no entries are created
      await fs.writeFile(path.join(tempDir, 'foo.sldprt'), '')
      const manifest = await parts.syncManifest()
      expect(Object.keys(manifest.entries)).toHaveLength(0)
    })
  })

  describe('assignPartNumber (idempotency)', () => {
    it('returns the existing entry for a path that already has one', async () => {
      const r = await parts.createNewPart('', 'thing')
      const manifest = await parts.loadManifest()
      const again = parts.assignPartNumber(manifest, r.filePath)
      expect(again?.partNumber).toBe(r.partNumber)
    })

    it('returns null for non-SolidWorks file extensions', async () => {
      const manifest = await parts.loadManifest()
      expect(parts.assignPartNumber(manifest, 'README.md')).toBeNull()
    })

    it('links a drawing to a part that shares its base filename in the same folder', async () => {
      const r = await parts.createNewPart('', 'plate')
      const baseName = r.partNumber  // e.g. "26-2129-001"
      const manifest = await parts.loadManifest()
      const drawing = parts.assignPartNumber(manifest, `${baseName}.slddrw`)
      expect(drawing).not.toBeNull()
      expect(drawing!.type).toBe('drawing')
      expect(drawing!.partNumber).toBe(r.partNumber)
    })
  })
})
