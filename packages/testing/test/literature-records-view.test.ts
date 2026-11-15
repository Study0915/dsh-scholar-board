/**
 * 文献阅读卡的判定：阅读阶段、摘要、作者信息、回收倒计时、视图过滤、年份与材料地址。
 *
 * `records-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/literature-records/records-model.js'

interface LiteratureModel {
  KIND: string
  STAGES: string[]
  stageOf(record: unknown): string
  stageKey(stage: unknown): string
  snippetOf(record: unknown): string
  metaOf(record: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string, stage?: string): Array<Record<string, unknown>>
  materialValid(url: unknown, title: unknown): boolean
  materialKindOf(material: unknown): string
  localPathValid(path: unknown): boolean
  materialProblem(material: unknown): string
  dateTextValid(text: unknown): boolean
  materialDraft(input: Record<string, unknown>, now: number, index: number): Record<string, unknown> | null
  materialDevice(material: unknown): string
  deviceMismatch(material: unknown, device: unknown): boolean
  materialTitleOf(material: unknown): string
  materialMetaOf(material: unknown): string
  externalWith(list: unknown, ref: Record<string, unknown>): Array<Record<string, unknown>>
  zoteroExternal(library: string, item: Record<string, unknown>): Record<string, unknown> | null
  zoteroFields(item: unknown): Record<string, string> | null
  doiAdoption(candidate: unknown, current: unknown): Array<Record<string, string>>
  openableUrl(url: unknown): boolean
  yearValue(text: unknown): { ok: boolean, value: number | null }
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { LiteratureRecords: LiteratureModel }).LiteratureRecords

/** 一篇文献。 */
function paper(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    kind: 'literature',
    title: '低轨星座干扰下的多用户检测',
    authors: 'A. Author, B. Author',
    venue: 'IEEE TWC',
    year: 2025,
    stage: 'reading',
    understanding: '把干扰建模成非平稳过程',
    questions: '信道状态更新频率对误码率的影响还没算清',
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('阅读阶段与摘要', () => {
  it('只认三个阶段，不认识的值按待读算', () => {
    expect(model.KIND).toBe('literature')
    expect(model.STAGES).toEqual(['queued', 'reading', 'understood'])
    expect(model.stageKey('queued')).toBe('stageQueued')
    expect(model.stageKey('reading')).toBe('stageReading')
    expect(model.stageKey('understood')).toBe('stageUnderstood')
    expect(model.stageOf(paper())).toBe('reading')
    expect(model.stageOf(paper({ stage: 'read' }))).toBe('queued')
    expect(model.stageOf(null)).toBe('queued')
  })

  it('摘要优先自己的理解，没有理解时用问题，空白压成一行', () => {
    expect(model.snippetOf(paper())).toBe('把干扰建模成非平稳过程')
    expect(model.snippetOf(paper({ understanding: undefined }))).toBe('信道状态更新频率对误码率的影响还没算清')
    expect(model.snippetOf(paper({ understanding: '', questions: '第一行\n  第二行' }))).toBe('第一行 第二行')
    expect(model.snippetOf(paper({ understanding: '', questions: '' }))).toBe('')
    expect(model.snippetOf(null)).toBe('')
  })

  it('作者信息只写有的部分，都没有时是空串', () => {
    expect(model.metaOf(paper())).toBe('A. Author, B. Author · IEEE TWC · 2025')
    expect(model.metaOf(paper({ authors: undefined, venue: undefined }))).toBe('2025')
    expect(model.metaOf(paper({ authors: undefined, venue: undefined, year: undefined }))).toBe('')
  })

  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(paper({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(paper({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(paper({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(paper(), now)).toBeNull()
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    paper({ id: 'queued-old', stage: 'queued', updatedAt: '2026-10-01T00:00:00.000Z' }),
    paper({ id: 'reading-new', stage: 'reading', updatedAt: '2026-11-10T00:00:00.000Z' }),
    paper({ id: 'understood', stage: 'understood', updatedAt: '2026-11-05T00:00:00.000Z' }),
    paper({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    paper({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    paper({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]

  it('活跃视图没有归档与回收站，按最近更新从新到旧', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['reading-new', 'understood', 'queued-old'])
  })

  it('活跃里按阅读阶段筛', () => {
    expect(model.viewRows(rows, 'active', 'queued').map((row) => row.id)).toEqual(['queued-old'])
    expect(model.viewRows(rows, 'active', 'understood').map((row) => row.id)).toEqual(['understood'])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, paper()], 'active')).toHaveLength(1)
  })
})

describe('年份、地址与文案', () => {
  it('年份留空是未填，越界或不是整数时拒绝', () => {
    expect(model.yearValue('')).toEqual({ ok: true, value: null })
    expect(model.yearValue('  ')).toEqual({ ok: true, value: null })
    expect(model.yearValue('2025')).toEqual({ ok: true, value: 2025 })
    expect(model.yearValue('999')).toEqual({ ok: false, value: null })
    expect(model.yearValue('3001')).toEqual({ ok: false, value: null })
    expect(model.yearValue('2025.5')).toEqual({ ok: false, value: null })
    expect(model.yearValue('abc')).toEqual({ ok: false, value: null })
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/paper.pdf', '论文页')).toBe(true)
    expect(model.materialValid('http://example.com', '论文页')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '论文页')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '论文页')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://arxiv.org/abs/2611.08850v1')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('最近 {n} 条 · 共 {total} 条', { n: 3, total: 8 })).toBe('最近 3 条 · 共 8 条')
  })
})

describe('材料引用', () => {
  const web = { id: 'm1', kind: 'web', url: 'https://example.com/paper.pdf', title: '论文页' }

  it('来源优先看 kind，旧记录按 url 与 path 推断', () => {
    expect(model.materialKindOf(web)).toBe('web')
    expect(model.materialKindOf({ url: 'https://example.com' })).toBe('web')
    expect(model.materialKindOf({ path: '/papers/a.pdf' })).toBe('local')
    expect(model.materialKindOf({ title: '无坐标' })).toBe('')
    expect(model.materialKindOf(null)).toBe('')
  })

  it('本地路径只收文本，不收地址与带控制字符的值', () => {
    expect(model.localPathValid('/papers/a.pdf')).toBe(true)
    expect(model.localPathValid('/home/user/papers/a.pdf')).toBe(true)
    expect(model.localPathValid('  /tmp/a.pdf  ')).toBe(true)
    expect(model.localPathValid('')).toBe(false)
    expect(model.localPathValid('https://example.com/a.pdf')).toBe(false)
    expect(model.localPathValid('file:///etc/passwd')).toBe(false)
    expect(model.localPathValid('/a\u0000b')).toBe(false)
    expect(model.localPathValid('x'.repeat(1025))).toBe(false)
  })

  it('材料校验按来源检查坐标，网页与本地不能混填', () => {
    expect(model.materialProblem(web)).toBe('')
    expect(model.materialProblem({ kind: 'local', path: '/papers/a.pdf', title: '本地', purpose: '复现' })).toBe('')
    expect(model.materialProblem({ kind: 'web', url: 'file:///etc/passwd', title: 'x' })).toBe('materialInvalid')
    expect(model.materialProblem({ kind: 'web', url: 'https://example.com', title: 'x', path: '/papers/a' })).toBe('materialInvalid')
    expect(model.materialProblem({ kind: 'local', path: '', title: 'x' })).toBe('materialPathInvalid')
    expect(model.materialProblem({ kind: 'local', path: '/papers/a', url: 'https://example.com', title: 'x' })).toBe('materialInvalid')
    expect(model.materialProblem({ kind: 'web', url: 'https://example.com', title: '  ' })).toBe('materialInvalid')
  })

  it('新材料只保留这一种坐标，可选的说明与核查日期跟着走', () => {
    const local = model.materialDraft({
      kind: 'local',
      path: '  /papers/a.pdf  ',
      title: ' 复现材料 ',
      purpose: ' 复现 ',
      device: ' 笔记本 ',
      version: ' 2 ',
      checkedAt: '2026-11-10',
    }, 1700000000000, 3)
    expect(local).toEqual({
      id: 'm-1700000000000-3',
      kind: 'local',
      title: '复现材料',
      path: '/papers/a.pdf',
      purpose: '复现',
      device: '笔记本',
      version: '2',
      checkedAt: '2026-11-10',
    })
    expect(model.materialDraft({ kind: 'web', url: 'https://example.com', title: '页' }, 1, 0)).toEqual({
      id: 'm-1-0', kind: 'web', title: '页', url: 'https://example.com',
    })
    expect(model.materialDraft({ kind: 'web', url: 'javascript:alert(1)', title: '页' }, 1, 0)).toBeNull()
    expect(model.materialDraft({ kind: 'local', path: 'https://example.com', title: '页' }, 1, 0)).toBeNull()
    expect(model.materialDraft({ kind: 'local', path: '/papers/a', title: '页', checkedAt: '11/10/2026' }, 1, 0))
      .toEqual({ id: 'm-1-0', kind: 'local', title: '页', path: '/papers/a' })
  })

  it('核查日期按 YYYY-MM-DD，空串表示未填', () => {
    expect(model.dateTextValid('')).toBe(true)
    expect(model.dateTextValid('2026-11-10')).toBe(true)
    expect(model.dateTextValid('2026-13-01')).toBe(false)
    expect(model.dateTextValid('11/10/2026')).toBe(false)
  })

  it('设备标签只标在本地材料上，换机器时标出另一台设备', () => {
    const local = { id: 'm1', kind: 'local', path: '/papers/a', title: 'x', device: '笔记本' }
    expect(model.materialDevice(local)).toBe('笔记本')
    expect(model.materialDevice(web)).toBe('')
    expect(model.deviceMismatch(local, '笔记本')).toBe(false)
    expect(model.deviceMismatch(local, '台式机')).toBe(true)
    expect(model.deviceMismatch(local, '')).toBe(false)
    expect(model.deviceMismatch({ ...local, device: '' }, '台式机')).toBe(false)
    expect(model.deviceMismatch(web, '台式机')).toBe(false)
  })

  it('标题与说明行：标题空时退回坐标，说明只写有的部分', () => {
    expect(model.materialTitleOf(web)).toBe('论文页')
    expect(model.materialTitleOf({ kind: 'local', path: '/papers/a.pdf', title: '' })).toBe('/papers/a.pdf')
    expect(model.materialMetaOf({ kind: 'local', path: '/papers/a', title: 'x', purpose: '复现', version: '2', device: '笔记本', checkedAt: '2026-11-10' }))
      .toBe('复现 · v2 · 笔记本 · 2026-11-10')
    expect(model.materialMetaOf(web)).toBe('')
  })
})

describe('外部来源与 DOI 候选', () => {
  it('Zotero 条目变成外部来源，只留库、条目与接口版本', () => {
    const ref = model.zoteroExternal('0', { key: 'ABCD1234', title: 'x' })
    expect(ref).toMatchObject({ provider: 'zotero', library: '0', itemKey: 'ABCD1234', apiVersion: '3' })
    expect(typeof ref?.fetchedAt).toBe('string')
    expect(model.zoteroExternal('0', { title: '没有 key' })).toBeNull()
  })

  it('同一库同一条目只留最新一份，最多四份', () => {
    const refs = ['A', 'B', 'C', 'D', 'E'].map((key) => ({ provider: 'zotero', library: '0', itemKey: key, apiVersion: '3', fetchedAt: '2026-11-10T00:00:00.000Z' }))
    expect(model.externalWith([], refs[0]).map((entry) => entry.itemKey)).toEqual(['A'])
    expect(model.externalWith([refs[0]], { ...refs[0], fetchedAt: '2026-11-11T00:00:00.000Z' })).toHaveLength(1)
    expect(model.externalWith(refs.slice(0, 4), refs[4]).map((entry) => entry.itemKey)).toEqual(['B', 'C', 'D', 'E'])
  })

  it('Zotero 字段与表单同名，缺的给空串', () => {
    expect(model.zoteroFields({
      key: 'A', title: '论文', authors: ['甲', '乙'], venue: 'JSAC', year: 2025,
      doi: '10.1109/x', url: 'https://example.com',
    })).toEqual({ title: '论文', authors: '甲, 乙', venue: 'JSAC', year: '2025', doi: '10.1109/x', url: 'https://example.com' })
    expect(model.zoteroFields({ key: 'A' })).toEqual({ title: '', authors: '', venue: '', year: '', doi: '', url: '' })
    expect(model.zoteroFields(null)).toBeNull()
  })

  it('DOI 候选只列有的字段，空、同、冲突三种状态', () => {
    const rows = model.doiAdoption({
      title: '论文', authors: ['甲'], year: 2025, venue: '', url: 'https://doi.org/10.1/x',
    }, { title: '论文', authors: '乙', year: '', venue: '旧刊', url: '' })
    expect(rows.map((row) => [row.field, row.state])).toEqual([
      ['title', 'same'],
      ['authors', 'conflict'],
      ['year', 'empty'],
      ['url', 'empty'],
    ])
    expect(rows[1].current).toBe('乙')
    expect(rows[3].value).toBe('https://doi.org/10.1/x')
    expect(model.doiAdoption(null, {})).toEqual([])
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/literature-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/literature-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
    }
    expect(manifest.id).toBe('literature-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
      'widget-board:records.open',
      'literature.doi',
      'literature.zotero',
      'materials.device',
    ])
    expect(manifest.scripts).toEqual([
      'records-model.js',
      'copy.js',
      'view.js',
      'reading-panel.js',
      'doi-panel.js',
      'zotero-panel.js',
      'materials-panel.js',
      'editor.js',
    ])
  })
})
