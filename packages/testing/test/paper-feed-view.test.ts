/**
 * 文献追踪卡的判定：Atom 条目的映射、链接能不能交给宿主打开、卡片该说哪一句。
 *
 * `main.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的
 * 判定，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/paper-feed/main.js'

/** 一行要画的东西。 */
interface Row {
  title: string
  url: string
  openable: boolean
  authors: string
  date: string
  summary: string
}

interface PaperFeedApi {
  LIMIT: number
  WAIT_MS: number
  DEFAULT_CATEGORY: string
  textOf(value: unknown): string
  openable(url: unknown): boolean
  linkOf(entry: unknown): string
  authorsOf(entry: unknown): string
  dateOf(entry: unknown): string
  categoryOf(props: unknown): string
  limitOf(props: unknown): number
  queryOf(props: unknown): string
  sourceOf(props: unknown): string
  nameOf(props: unknown): string
  subscriptionKey(props: unknown): string
  normalizeDoi(value: unknown): string
  arxivMainId(value: unknown): string
  arxivVersionOf(value: unknown): string
  doiOf(entry: unknown): string
  arxivOf(entry: unknown): { id: string, version: string }
  titleSimilar(left: unknown, right: unknown): boolean
  rowsOf(data: unknown, props: unknown): Row[]
  stateOf(state: { data: unknown, failed: boolean, rowCount: number }): string
  yearOfDate(date: unknown): number | null
  recordOf(row: unknown): Record<string, unknown> | null
  alreadyAdded(records: unknown, url: unknown): boolean
  duplicatesOf(records: unknown, row: unknown): Array<{ reason: string, record: Record<string, unknown> }>
  comparisonOf(record: unknown, row: unknown): Array<{ label: string, current: string, next: string, missing: boolean }>
  missingPatchOf(record: unknown, row: unknown): Record<string, unknown>
}

const api = (globalThis as unknown as { PaperFeed: PaperFeedApi }).PaperFeed

/** 一份 arXiv 那样的条目。 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'A Paper',
    author: [{ name: 'Alice' }, { name: 'Bob' }],
    published: '2026-11-06T01:14:40Z',
    summary: 'A summary',
    link: [
      { '@_href': 'https://arxiv.org/abs/2611.08850v1', '@_rel': 'alternate' },
      { '@_href': 'https://arxiv.org/pdf/2611.08850v1', '@_rel': 'related' },
    ],
    ...overrides,
  }
}

describe('文本与链接', () => {
  it('只有文字的元素读成字符串，带属性的读成 #text', () => {
    expect(api.textOf('  hello  ')).toBe('hello')
    expect(api.textOf({ '#text': '  wrapped  ' })).toBe('wrapped')
    expect(api.textOf(null)).toBe('')
    expect(api.textOf(42)).toBe('')
  })

  it('只认 arXiv 的 https 页面，别的地址都不做成按钮', () => {
    expect(api.openable('https://arxiv.org/abs/2611.08850v1')).toBe(true)
    expect(api.openable('https://arxiv.org/pdf/2611.08850v1')).toBe(true)
    expect(api.openable('http://arxiv.org/abs/1')).toBe(false)
    expect(api.openable('https://evil.example/abs/1')).toBe(false)
    expect(api.openable('javascript:alert(1)')).toBe(false)
    expect(api.openable(undefined)).toBe(false)
  })

  it('取 alternate 链接；没有时退回第一条带 href 的链接', () => {
    expect(api.linkOf(entry())).toBe('https://arxiv.org/abs/2611.08850v1')
    expect(api.linkOf(entry({ link: [{ '@_href': 'https://arxiv.org/abs/2' }] }))).toBe('https://arxiv.org/abs/2')
    expect(api.linkOf(entry({ link: [] }))).toBe('')
    expect(api.linkOf(null)).toBe('')
  })

  it('作者按顺序用逗号连起来，日期只留前十位', () => {
    expect(api.authorsOf(entry())).toBe('Alice, Bob')
    expect(api.authorsOf(entry({ author: [{ name: '  Solo  ' }] }))).toBe('Solo')
    expect(api.authorsOf(entry({ author: [] }))).toBe('')
    expect(api.dateOf(entry())).toBe('2026-11-06')
    expect(api.dateOf(entry({ published: '2026-11-06' }))).toBe('2026-11-06')
    expect(api.dateOf(entry({ published: '' }))).toBe('')
  })
})

describe('设置', () => {
  it('分类为空或不是字符串时退回默认分类', () => {
    expect(api.categoryOf({ category: 'physics.optics' })).toBe('physics.optics')
    expect(api.categoryOf({ category: '  ' })).toBe(api.DEFAULT_CATEGORY)
    expect(api.categoryOf({ category: 42 })).toBe(api.DEFAULT_CATEGORY)
    expect(api.categoryOf(null)).toBe(api.DEFAULT_CATEGORY)
  })

  it('条数收在 3 到上限之间，读不出来时是 8', () => {
    expect(api.limitOf({ limit: 5 })).toBe(5)
    expect(api.limitOf({ limit: 1 })).toBe(3)
    expect(api.limitOf({ limit: 999 })).toBe(api.LIMIT)
    expect(api.limitOf({ limit: 'x' })).toBe(8)
    expect(api.limitOf(null)).toBe(8)
  })
})

describe('条目映射', () => {
  it('把 Atom 条目铺成行，没有标题的跳过', () => {
    const rows = api.rowsOf({ feed: { entry: [entry(), entry({ title: '   ' }), entry({ title: 'Third' })] } }, { limit: 8 })
    expect(rows.map((row) => row.title)).toEqual(['A Paper', 'Third'])
    expect(rows[0]).toMatchObject({ url: 'https://arxiv.org/abs/2611.08850v1', openable: true, authors: 'Alice, Bob', date: '2026-11-06', summary: 'A summary' })
  })

  it('条目多于条数时只映射前面几篇', () => {
    const many = Array.from({ length: 12 }, (_value, index) => entry({ title: `Paper ${String(index)}` }))
    expect(api.rowsOf({ feed: { entry: many } }, { limit: 4 })).toHaveLength(4)
  })

  it('空 feed、没有 feed、条目不是对象时都是空行', () => {
    expect(api.rowsOf({ feed: {} }, {})).toEqual([])
    expect(api.rowsOf({}, {})).toEqual([])
    expect(api.rowsOf(null, {})).toEqual([])
    expect(api.rowsOf({ feed: { entry: [null, 3, entry()] } }, {})).toHaveLength(1)
  })

  it('地址不是 arXiv 页面的条目仍然成行，只是打不开', () => {
    const rows = api.rowsOf({ feed: { entry: [entry({ link: [{ '@_href': 'https://evil.example/x', '@_rel': 'alternate' }] })] } }, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]?.openable).toBe(false)
  })
})

describe('卡片状态', () => {
  it('还没收到数据时是读取中，等过头是读不到', () => {
    expect(api.stateOf({ data: null, failed: false, rowCount: 0 })).toBe('loading')
    expect(api.stateOf({ data: null, failed: true, rowCount: 0 })).toBe('failed')
  })

  it('收到数据之后按有没有行分空与正常，失败标记不再起作用', () => {
    expect(api.stateOf({ data: { feed: {} }, failed: false, rowCount: 0 })).toBe('empty')
    expect(api.stateOf({ data: { feed: {} }, failed: true, rowCount: 0 })).toBe('empty')
    expect(api.stateOf({ data: { feed: {} }, failed: false, rowCount: 3 })).toBe('ready')
  })
})

describe('加入工作台', () => {
  const row = api.rowsOf({ feed: { entry: [entry()] } }, {})[0]

  it('提交日期里的年份读得出来才留下', () => {
    expect(api.yearOfDate('2026-11-06')).toBe(2026)
    expect(api.yearOfDate('')).toBeNull()
    expect(api.yearOfDate('nope')).toBeNull()
    expect(api.yearOfDate('0999-01-01')).toBeNull()
    expect(api.yearOfDate('3001-01-01')).toBeNull()
    expect(api.yearOfDate(2026)).toBeNull()
  })

  it('只有能打开的 arXiv 行才转成待读文献，摘要不进入理解', () => {
    expect(api.recordOf(row)).toEqual({
      kind: 'literature',
      title: 'A Paper',
      url: 'https://arxiv.org/abs/2611.08850v1',
      venue: 'arXiv',
      stage: 'queued',
      authors: 'Alice, Bob',
      year: 2026,
      arxivId: '2611.08850',
      arxivVersion: 'v1',
      format: 'preprint',
    })
    expect(api.recordOf({ title: 'A Paper', url: 'https://evil.example/x', openable: false })).toBeNull()
    expect(api.recordOf({ title: '  ', url: 'https://arxiv.org/abs/1' })).toBeNull()
    expect(api.recordOf(null)).toBeNull()
  })

  it('同一来源地址的活跃与归档文献算已在工作台，回收站里的不算', () => {
    const url = 'https://arxiv.org/abs/2611.08850v1'
    expect(api.alreadyAdded([{ url }], url)).toBe(true)
    expect(api.alreadyAdded([{ url, archived: true }], url)).toBe(true)
    expect(api.alreadyAdded([{ url, deletedAt: '2026-11-01T00:00:00.000Z' }], url)).toBe(false)
    expect(api.alreadyAdded([{ url: 'https://arxiv.org/abs/2' }], url)).toBe(false)
    expect(api.alreadyAdded(null, url)).toBe(false)
  })
})

describe('订阅', () => {
  it('查询条件优先用 query，留空时按分类组成 cat:<分类>', () => {
    expect(api.queryOf({ query: 'cat:cs.LG' })).toBe('cat:cs.LG')
    expect(api.queryOf({ query: '  ' })).toBe('cat:eess.SP')
    expect(api.queryOf({ query: '', category: 'physics.optics' })).toBe('cat:physics.optics')
    expect(api.queryOf({ category: 'cat:cs.AI' })).toBe('cat:cs.AI')
    expect(api.queryOf({})).toBe(`cat:${api.DEFAULT_CATEGORY}`)
  })

  it('名称去掉两边空白，来源现在只有 arXiv', () => {
    expect(api.nameOf({ name: '  信号处理新稿  ' })).toBe('信号处理新稿')
    expect(api.nameOf({ name: 42 })).toBe('')
    expect(api.sourceOf({ source: 'arxiv' })).toBe('arxiv')
    expect(api.sourceOf({ source: 'other' })).toBe('arxiv')
  })

  it('换订阅只看来源与查询条件', () => {
    expect(api.subscriptionKey({ query: 'cat:cs.LG' })).toBe(api.subscriptionKey({ query: 'cat:cs.LG', title: '另一个标题' }))
    expect(api.subscriptionKey({ query: 'cat:cs.LG' })).not.toBe(api.subscriptionKey({ query: 'cat:cs.AI' }))
  })
})

describe('查重', () => {
  it('DOI 去掉地址前缀、doi: 前缀与大小写', () => {
    expect(api.normalizeDoi('https://doi.org/10.1000/XYZ')).toBe('10.1000/xyz')
    expect(api.normalizeDoi('doi: 10.1000/XYZ.')).toBe('10.1000/xyz')
    expect(api.normalizeDoi('  10.1000/xyz  ')).toBe('10.1000/xyz')
    expect(api.normalizeDoi('not-a-doi')).toBe('')
    expect(api.normalizeDoi(null)).toBe('')
  })

  it('arXiv 主 id 去掉网址前缀、.pdf 与版本号', () => {
    expect(api.arxivMainId('https://arxiv.org/abs/2401.12345v2')).toBe('2401.12345')
    expect(api.arxivMainId('https://arxiv.org/pdf/2401.12345v2.pdf')).toBe('2401.12345')
    expect(api.arxivMainId('https://arxiv.org/abs/2401.12345?context=cs')).toBe('2401.12345')
    expect(api.arxivMainId('hep-th/9901001v2')).toBe('hep-th/9901001')
    expect(api.arxivMainId('2401.12345')).toBe('2401.12345')
    expect(api.arxivMainId('nope')).toBe('')
  })

  it('arXiv 版本号单独读出来，地址里没有时是空串', () => {
    expect(api.arxivVersionOf('https://arxiv.org/abs/2401.12345v2')).toBe('v2')
    expect(api.arxivVersionOf('https://arxiv.org/pdf/2401.12345v3.pdf')).toBe('v3')
    expect(api.arxivVersionOf('https://arxiv.org/abs/2401.12345')).toBe('')
  })

  it('条目里的 DOI 先看 arxiv:doi，再看 doi', () => {
    expect(api.doiOf({ 'arxiv:doi': '10.1000/xyz' })).toBe('10.1000/xyz')
    expect(api.doiOf({ doi: '10.1000/abc' })).toBe('10.1000/abc')
    expect(api.doiOf({})).toBe('')
  })

  it('条目里的 arXiv id 与版本：先看 id，再看链接', () => {
    expect(api.arxivOf({ id: 'http://arxiv.org/abs/2401.12345v4' })).toEqual({ id: '2401.12345', version: 'v4' })
    expect(api.arxivOf(entry())).toEqual({ id: '2611.08850', version: 'v1' })
    expect(api.arxivOf({})).toEqual({ id: '', version: '' })
  })

  it('DOI 相同、arXiv 主 id 相同、地址相同都算确定重复', () => {
    const paper = { title: 'A Paper', url: 'https://arxiv.org/abs/2401.12345v2', doi: '10.1000/xyz', arxivId: '2401.12345' }
    expect(api.duplicatesOf([{ id: '1', doi: '10.1000/XYZ' }], paper).map((match) => match.reason)).toEqual(['doi'])
    expect(api.duplicatesOf([{ id: '2', arxivId: '2401.12345v1' }], paper).map((match) => match.reason)).toEqual(['arxiv'])
    expect(api.duplicatesOf([{ id: '3', url: 'https://arxiv.org/abs/2401.12345v1' }], paper).map((match) => match.reason)).toEqual(['url'])
  })

  it('标题相近只作候选，够短或差得远的标题不算', () => {
    const paper = { title: 'Sparse Array Interpolation for Wideband Angular Estimation', url: 'https://arxiv.org/abs/2401.12345v2' }
    const similar = [{ id: '4', title: 'Sparse array interpolation for wideband angular estimation.' }]
    expect(api.duplicatesOf(similar, paper).map((match) => match.reason)).toEqual(['title'])
    expect(api.duplicatesOf([{ id: '5', title: 'Deep Learning for Weather Forecasting' }], paper)).toEqual([])
    expect(api.duplicatesOf([{ id: '6', title: 'Sparse Arrays' }], paper)).toEqual([])
  })

  it('回收站里的不算重复，归档的仍然算', () => {
    const paper = { title: 'A Paper', url: 'https://arxiv.org/abs/2401.12345v2' }
    expect(api.duplicatesOf([{ id: '7', url: paper.url, archived: true }], paper)).toHaveLength(1)
    expect(api.duplicatesOf([{ id: '8', url: paper.url, deletedAt: '2026-11-01T00:00:00.000Z' }], paper)).toEqual([])
    expect(api.duplicatesOf(null, paper)).toEqual([])
  })
})

describe('重复预览', () => {
  const paper = {
    title: 'Sparse Array Interpolation for Wideband Angular Estimation',
    authors: 'Mei Lin',
    venue: 'arXiv',
    year: 2026,
    doi: '10.1000/xyz',
    arxivId: '2611.08701',
    arxivVersion: 'v2',
    url: 'https://arxiv.org/abs/2611.08701v2',
    format: 'preprint',
  }

  it('逐项对比两边字段，只有订阅这一边有值时标成缺失', () => {
    const record = { title: paper.title, url: paper.url, authors: 'Mei Lin' }
    const rows = api.comparisonOf(record, paper)
    const byLabel = new Map(rows.map((row) => [row.label, row]))
    expect(byLabel.get('fieldDoi')).toMatchObject({ current: '', next: '10.1000/xyz', missing: true })
    expect(byLabel.get('fieldYear')).toMatchObject({ current: '', next: '2026', missing: true })
    expect(byLabel.get('fieldTitle')).toMatchObject({ current: paper.title, next: paper.title, missing: false })
  })

  it('补字段只补现有记录缺的，标题与地址不动', () => {
    const record = { title: paper.title, url: paper.url, authors: 'Mei Lin' }
    expect(api.missingPatchOf(record, paper)).toEqual({
      venue: 'arXiv',
      year: 2026,
      doi: '10.1000/xyz',
      arxivId: '2611.08701',
      arxivVersion: 'v2',
      format: 'preprint',
    })
    expect(api.missingPatchOf({ ...record, venue: 'arXiv', year: 2025, doi: '10.1000/other', format: 'published' }, paper)).toEqual({
      arxivId: '2611.08701',
      arxivVersion: 'v2',
    })
  })
})

describe('样例', () => {
  it('s 与 l 两个尺寸族都有样例，分类与条数在 props 里', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/paper-feed/samples.json', import.meta.url), 'utf8')) as Record<string, { props?: Record<string, unknown>, data?: unknown }>
    expect(Object.keys(samples).sort()).toEqual(['l', 's'])
    for (const sample of Object.values(samples)) {
      const rows = api.rowsOf(sample.data, sample.props ?? {})
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.openable)).toBe(true)
    }
  })
})
