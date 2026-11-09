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
  rowsOf(data: unknown, props: unknown): Row[]
  stateOf(state: { data: unknown, failed: boolean, rowCount: number }): string
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
