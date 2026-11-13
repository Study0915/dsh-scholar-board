/**
 * 研究记录卡的判定：做法、缺失内容的说法、参数与指标、回收倒计时、视图过滤与材料地址。
 *
 * `research-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片
 * 真正在用的实现，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/research-records/research-model.js'
import '../../widgets/research-records/copy.js'

interface ResearchModel {
  KIND: string
  METHODS: string[]
  MAX_ENTRIES: number
  UNIT_LENGTH: number
  methodOf(record: unknown): string
  methodKey(method: unknown): string
  textOf(record: unknown, field: string): string
  shownText(record: unknown, field: string, unknown: unknown): string
  summaryOf(record: unknown, unknown: unknown): string
  labelledOf(record: unknown, field: string, label: unknown, unknown: unknown): string
  entriesOf(record: unknown, field: string): Array<Record<string, unknown>>
  entryLine(entry: unknown): string
  entriesLine(record: unknown, field: string, unknown: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  viewRows(records: unknown, view: string, method?: string): Array<Record<string, unknown>>
  cleanEntries(rows: unknown): Array<Record<string, unknown>> | null
  materialValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { ResearchRecords: ResearchModel }).ResearchRecords
const copy = (globalThis as unknown as { ResearchRecordsCopy: Record<string, unknown> }).ResearchRecordsCopy

/** 一条研究记录。 */
function note(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    kind: 'research',
    title: '不同种子下的干扰对齐仿真',
    method: 'simulation',
    question: '种子变化会不会让误码率曲线翻转',
    environment: 'Ubuntu 24.04 / numpy 2.1',
    seed: '11, 42, 97',
    parameters: [
      { name: 'snr', value: '0–20', unit: 'dB' },
      { name: 'users', value: '8' },
    ],
    metrics: [{ name: 'ber', value: '3.2e-4' }],
    conclusion: '种子只影响小样本段的抖动，趋势一致',
    updatedAt: '2026-11-10T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('做法与缺失内容', () => {
  it('只认三种做法，不认识的值按仿真算', () => {
    expect(model.KIND).toBe('research')
    expect(model.METHODS).toEqual(['derivation', 'simulation', 'experiment'])
    expect(model.methodKey('derivation')).toBe('methodDerivation')
    expect(model.methodKey('simulation')).toBe('methodSimulation')
    expect(model.methodKey('experiment')).toBe('methodExperiment')
    expect(model.methodOf(note({ method: 'experiment' }))).toBe('experiment')
    expect(model.methodOf(note({ method: 'field' }))).toBe('simulation')
    expect(model.methodOf(null)).toBe('simulation')
  })

  it('摘要优先结论，没有结论时用研究问题，都没有时说明未知', () => {
    expect(model.summaryOf(note(), '未知')).toBe('种子只影响小样本段的抖动，趋势一致')
    expect(model.summaryOf(note({ conclusion: undefined }), '未知')).toBe('种子变化会不会让误码率曲线翻转')
    expect(model.summaryOf(note({ conclusion: '', question: '' }), '未知')).toBe('未知')
    expect(model.summaryOf(null, '未知')).toBe('未知')
  })

  it('环境与种子缺失时显式写未知，不猜测也不留白', () => {
    expect(model.labelledOf(note(), 'environment', '环境', '未知')).toBe('环境：Ubuntu 24.04 / numpy 2.1')
    expect(model.labelledOf(note({ environment: '  ' }), 'environment', '环境', '未知')).toBe('环境：未知')
    expect(model.shownText(note({ seed: undefined }), 'seed', '未知')).toBe('未知')
    expect(model.textOf(note({ seed: ' 11 ' }), 'seed')).toBe('11')
  })
})

describe('参数与指标', () => {
  it('只挑名称与数值都有的条目', () => {
    expect(model.entriesOf(note(), 'parameters')).toHaveLength(2)
    expect(model.entriesOf(note({ parameters: [{ name: 'snr' }, null, { name: ' ', value: '1' }, { name: 'users', value: '8' }] }), 'parameters')).toHaveLength(1)
    expect(model.entriesOf(note({ metrics: 'ber' }), 'metrics')).toEqual([])
    expect(model.entriesOf(null, 'metrics')).toEqual([])
  })

  it('一行条目写成名称、数值与单位，没有单位不补', () => {
    expect(model.entryLine({ name: 'snr', value: '0–20', unit: 'dB' })).toBe('snr 0–20 dB')
    expect(model.entryLine({ name: 'users', value: '8' })).toBe('users 8')
    expect(model.entryLine({ name: 'users', value: '8', unit: '  ' })).toBe('users 8')
    expect(model.entryLine(null)).toBe('')
  })

  it('一组条目最多列三条，一条都没有时说明未知', () => {
    expect(model.entriesLine(note(), 'parameters', '未知')).toBe('snr 0–20 dB · users 8')
    const many = { parameters: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' }, { name: 'd', value: '4' }] }
    expect(model.entriesLine(many, 'parameters', '未知')).toBe('a 1 · b 2 · c 3')
    expect(model.entriesLine(note({ metrics: [] }), 'metrics', '未知')).toBe('未知')
  })

  it('保存前整行留空会丢掉，半填或单位过长时拒绝', () => {
    expect(model.cleanEntries([
      { name: 'snr', value: '0–20', unit: ' dB ' },
      { name: '', value: '', unit: '' },
      { name: 'users', value: '8' },
    ])).toEqual([
      { name: 'snr', value: '0–20', unit: 'dB' },
      { name: 'users', value: '8' },
    ])
    expect(model.cleanEntries([{ name: 'snr', value: '' }])).toBeNull()
    expect(model.cleanEntries([{ name: '', value: '8' }])).toBeNull()
    expect(model.cleanEntries([{ name: 'snr', value: '1', unit: 'x'.repeat(model.UNIT_LENGTH + 1) }])).toBeNull()
    expect(model.cleanEntries([])).toEqual([])
    expect(model.cleanEntries(null)).toEqual([])
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    note({ id: 'derivation-old', method: 'derivation', updatedAt: '2026-10-01T00:00:00.000Z' }),
    note({ id: 'simulation-new', method: 'simulation', updatedAt: '2026-11-10T00:00:00.000Z' }),
    note({ id: 'experiment', method: 'experiment', updatedAt: '2026-11-05T00:00:00.000Z' }),
    note({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    note({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    note({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]

  it('活跃视图没有归档与回收站，按最近更新从新到旧', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['simulation-new', 'experiment', 'derivation-old'])
  })

  it('活跃里按做法筛', () => {
    expect(model.viewRows(rows, 'active', 'derivation').map((row) => row.id)).toEqual(['derivation-old'])
    expect(model.viewRows(rows, 'active', 'experiment').map((row) => row.id)).toEqual(['experiment'])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, note()], 'active')).toHaveLength(1)
  })
})

describe('回收倒计时、地址与文案', () => {
  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(note({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(note({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(note({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(note(), now)).toBeNull()
  })

  it('材料只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.materialValid('https://example.com/result.csv', '结果表')).toBe(true)
    expect(model.materialValid('http://example.com', '结果表')).toBe(true)
    expect(model.materialValid('file:///etc/passwd', '结果表')).toBe(false)
    expect(model.materialValid('javascript:alert(1)', '结果表')).toBe(false)
    expect(model.materialValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('最近 {n} 条 · 共 {total} 条', { n: 3, total: 8 })).toBe('最近 3 条 · 共 8 条')
  })
})

describe('样例与清单', () => {
  it('s 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/research-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/research-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('research-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
    ])
    expect(manifest.scripts).toContain('research-model.js')
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
