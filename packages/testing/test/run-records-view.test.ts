/**
 * 运行记录卡的判定：状态、方案、时间、条目、数据集、结果、复制与视图过滤。
 *
 * `run-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的实现。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/run-records/run-model.js'
import '../../widgets/run-records/copy.js'

interface RunModel {
  KIND: string
  STATUSES: string[]
  RESULT_KINDS: string[]
  MAX_ENTRIES: number
  MAX_DATASETS: number
  MAX_RESULTS: number
  UNIT_LENGTH: number
  RESULT_TEXT_LENGTH: number
  RESULT_METHOD_LENGTH: number
  RESULT_DISPERSION_LENGTH: number
  statusOf(record: unknown): string
  statusKey(status: unknown): string
  textOf(record: unknown, field: string): string
  shownText(record: unknown, field: string, unknown: unknown): string
  labelledOf(record: unknown, field: string, label: unknown, unknown: unknown): string
  planIdOf(record: unknown): string
  planLabelOf(record: unknown, plansById: unknown, unknown: unknown, missing: unknown): string
  entriesOf(record: unknown, field: string): Array<Record<string, unknown>>
  entryLine(entry: unknown): string
  entriesLine(record: unknown, field: string, unknown: unknown): string
  datasetRows(record: unknown): Array<Record<string, unknown>>
  datasetLine(dataset: unknown): string
  datasetsLine(record: unknown, unknown: unknown): string
  resultKindOf(result: unknown): string
  resultKindKey(kind: unknown): string
  resultRows(record: unknown): Array<Record<string, unknown>>
  resultSourcesOf(result: unknown): string[]
  resultsLine(record: unknown, unknown: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  timeValid(value: unknown): boolean
  timeLine(record: unknown): string
  viewRows(records: unknown, view: string, status?: string): Array<Record<string, unknown>>
  cleanEntries(rows: unknown): Array<Record<string, unknown>> | null
  cleanDatasets(rows: unknown, stamp: string): Array<Record<string, unknown>> | null
  cleanResults(rows: unknown, stamp: string): Array<Record<string, unknown>> | null
  duplicateAsPlanned(record: unknown, title: string): Record<string, unknown>
  duplicateTitle(record: unknown): string
  newRunTitle(now?: number): string
  artifactValid(url: unknown, title: unknown): boolean
  openableUrl(url: unknown): boolean
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { RunRecords: RunModel }).RunRecords
const copy = (globalThis as unknown as { RunRecordsCopy: Record<string, unknown> }).RunRecordsCopy

/** 一条运行记录。 */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    kind: 'run',
    title: '种子 11 的干扰对齐仿真',
    status: 'running',
    plan: { kind: 'research', id: 'research-1' },
    code: { repository: 'https://example.com/sim', commit: 'abc1234' },
    datasets: [
      { id: 'ds1', name: '合成信道', split: 'train', version: 'v1' },
      { id: 'ds2', name: '真实信道', split: 'test' },
    ],
    checkpoints: [{ name: 'epoch-120', value: '820', unit: 's', definition: '第 120 轮检查点' }],
    config: [{ name: 'batch', value: '64' }],
    environment: 'Ubuntu 24.04 / PyTorch 2.5',
    seed: '11',
    evaluation: '误码率与吞吐',
    metrics: [{ name: 'ber', value: '3.1e-4', definition: '误码率' }],
    startedAt: '2026-11-15T08:00:00.000Z',
    endedAt: '2026-11-15T10:00:00.000Z',
    artifacts: [{ id: 'a1', url: 'https://example.com/log', title: '训练日志' }],
    failure: '第 240 轮出现 nan',
    note: '重跑前先检查学习率',
    results: [
      { id: 'r1', kind: 'single', text: '种子 11 收敛到 3.1e-4', method: '固定 64 用户' },
      { id: 'r2', kind: 'aggregate', text: '三个种子的中位数', sources: ['run-2', 'run-3'], sampleSize: 3, method: '中位数', dispersion: 'IQR' },
      { id: 'r3', kind: 'aggregate', text: '与文献对比后手工汇总', manual: true },
    ],
    updatedAt: '2026-11-15T10:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('状态与时间', () => {
  it('只认五个状态，不认识的值按计划中算', () => {
    expect(model.KIND).toBe('run')
    expect(model.STATUSES).toEqual(['planned', 'running', 'succeeded', 'failed', 'cancelled'])
    expect(model.statusOf(run({ status: 'succeeded' }))).toBe('succeeded')
    expect(model.statusOf(run({ status: 'done' }))).toBe('planned')
    expect(model.statusOf(null)).toBe('planned')
  })

  it('状态各有一句说法', () => {
    expect(model.statusKey('planned')).toBe('statusPlanned')
    expect(model.statusKey('running')).toBe('statusRunning')
    expect(model.statusKey('succeeded')).toBe('statusSucceeded')
    expect(model.statusKey('failed')).toBe('statusFailed')
    expect(model.statusKey('cancelled')).toBe('statusCancelled')
    expect(model.statusKey('other')).toBe('statusPlanned')
  })

  it('起止时间可缺；只有一个时只写那一个', () => {
    expect(model.timeLine(run())).toBe('2026-11-15 08:00 → 2026-11-15 10:00')
    expect(model.timeLine(run({ endedAt: undefined }))).toBe('2026-11-15 08:00')
    expect(model.timeLine(run({ startedAt: undefined, endedAt: undefined }))).toBe('')
    expect(model.timeLine(null)).toBe('')
  })

  it('时间允许空着，填了要能解析', () => {
    expect(model.timeValid('')).toBe(true)
    expect(model.timeValid(null)).toBe(true)
    expect(model.timeValid('2026-11-15T08:00')).toBe(true)
    expect(model.timeValid('不是时间')).toBe(false)
  })
})

describe('方案与缺失内容', () => {
  it('方案的 id 与说法：找得到用标题，找不到说明来源缺失', () => {
    expect(model.planIdOf(run())).toBe('research-1')
    expect(model.planIdOf(run({ plan: undefined }))).toBe('')
    const plans = { 'research-1': { id: 'research-1', title: '干扰对齐仿真' } }
    expect(model.planLabelOf(run(), plans, '未指定方案', '来源缺失')).toBe('干扰对齐仿真')
    expect(model.planLabelOf(run(), {}, '未指定方案', '来源缺失')).toBe('来源缺失')
    expect(model.planLabelOf(run({ plan: undefined }), plans, '未指定方案', '来源缺失')).toBe('未指定方案')
  })

  it('环境缺失时显式写未知，不猜测也不留白', () => {
    expect(model.labelledOf(run(), 'environment', '环境', '未知')).toBe('环境：Ubuntu 24.04 / PyTorch 2.5')
    expect(model.labelledOf(run({ environment: '  ' }), 'environment', '环境', '未知')).toBe('环境：未知')
    expect(model.shownText(run({ seed: undefined }), 'seed', '未知')).toBe('未知')
    expect(model.textOf(run({ seed: ' 11 ' }), 'seed')).toBe('11')
  })

  it('条目与数据集只挑有名称与内容的行', () => {
    expect(model.entriesOf(run(), 'metrics')).toHaveLength(1)
    expect(model.entriesOf(run({ metrics: [{ name: 'ber' }, null, { name: ' ', value: '1' }] }), 'metrics')).toEqual([])
    expect(model.entryLine({ name: 'ber', value: '3.1e-4', unit: 'BER' })).toBe('ber 3.1e-4 BER')
    expect(model.entryLine({ name: 'batch', value: '64' })).toBe('batch 64')
    expect(model.entriesLine(run({ metrics: [] }), 'metrics', '未知')).toBe('未知')
    expect(model.datasetRows(run())).toHaveLength(2)
    expect(model.datasetRows(run({ datasets: [{ name: ' ' }, null] }))).toEqual([])
    expect(model.datasetLine({ name: '合成信道', split: 'train', version: 'v1' })).toBe('合成信道 · train · v1')
    expect(model.datasetsLine(run(), '未知')).toBe('合成信道 · train · v1 · 真实信道 · test')
    expect(model.datasetsLine(run({ datasets: [] }), '未知')).toBe('未知')
  })
})

describe('条目、数据集与结果的保存整理', () => {
  it('整行留空会丢掉，半填或单位过长时拒绝', () => {
    expect(model.cleanEntries([
      { name: 'batch', value: '64' },
      { name: '', value: '', unit: '', definition: '' },
      { name: 'lr', value: '1e-4', definition: ' 学习率 ' },
    ])).toEqual([
      { name: 'batch', value: '64' },
      { name: 'lr', value: '1e-4', definition: '学习率' },
    ])
    expect(model.cleanEntries([{ name: 'batch', value: '' }])).toBeNull()
    expect(model.cleanEntries([{ name: '', value: '64' }])).toBeNull()
    expect(model.cleanEntries([{ name: 'x', value: '1', unit: 'x'.repeat(model.UNIT_LENGTH + 1) }])).toBeNull()
    expect(model.cleanEntries([])).toEqual([])
    expect(model.cleanEntries(null)).toEqual([])
  })

  it('数据集要有名称，id 保留或补一个稳定的', () => {
    expect(model.cleanDatasets([
      { id: 'ds1', name: '合成信道', split: ' train ', version: 'v1' },
      { name: '', split: '', version: '' },
      { name: '真实信道' },
    ], '1700')).toEqual([
      { id: 'ds1', name: '合成信道', split: 'train', version: 'v1' },
      { id: 'dataset-1700-2', name: '真实信道' },
    ])
    expect(model.cleanDatasets([{ split: 'train' }], '1')).toBeNull()
    expect(model.cleanDatasets([{ name: 'x' }], '1')).toEqual([{ id: 'dataset-1-0', name: 'x' }])
    expect(model.cleanDatasets([], '1')).toEqual([])
    expect(model.cleanDatasets(null, '1')).toEqual([])
  })

  it('结果保留 id；汇总缺来源要标记手工，手工与来源不能同时有', () => {
    expect(model.cleanResults([
      { id: 'r1', kind: 'single', text: ' 收敛 ', method: ' 固定 64 用户 ' },
      { id: 'r2', kind: 'aggregate', text: '中位数', sources: ['run-2', 'run-2', 'run-3'], sampleSize: '3', dispersion: 'IQR' },
      { id: 'r3', kind: 'aggregate', text: '手工汇总', manual: true },
      { kind: 'single', text: '' },
    ], '9')).toEqual([
      { id: 'r1', kind: 'single', text: '收敛', method: '固定 64 用户' },
      { id: 'r2', kind: 'aggregate', text: '中位数', sources: ['run-2', 'run-3'], sampleSize: 3, dispersion: 'IQR' },
      { id: 'r3', kind: 'aggregate', text: '手工汇总', manual: true },
    ])
    expect(model.cleanResults([{ kind: 'aggregate', text: 'x' }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'aggregate', text: 'x', manual: true, sources: ['run-2'] }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'single', text: 'x', sampleSize: -1 }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'single', text: 'x', sampleSize: 1.5 }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'single', text: 'x'.repeat(model.RESULT_TEXT_LENGTH + 1) }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'single', text: 'x', method: 'm'.repeat(model.RESULT_METHOD_LENGTH + 1) }], '1')).toBeNull()
    expect(model.cleanResults([{ kind: 'single', text: 'x', dispersion: 'd'.repeat(model.RESULT_DISPERSION_LENGTH + 1) }], '1')).toBeNull()
    expect(model.cleanResults([], '1')).toEqual([])
    expect(model.cleanResults(null, '1')).toEqual([])
  })

  it('结果整理不认识的类型按单次算，新结果按时刻补 id', () => {
    expect(model.resultKindOf({ kind: 'aggregate' })).toBe('aggregate')
    expect(model.resultKindOf({ kind: 'other' })).toBe('single')
    expect(model.resultKindKey('aggregate')).toBe('resultAggregate')
    expect(model.resultKindKey('single')).toBe('resultSingle')
    expect(model.cleanResults([{ kind: 'other', text: 'x' }], '7')).toEqual([{ id: 'result-7-0', kind: 'single', text: 'x' }])
    expect(model.resultSourcesOf({ sources: ['run-2', '', 3] })).toEqual(['run-2'])
    expect(model.resultRows(run())).toHaveLength(3)
    expect(model.resultRows(run({ results: [{ text: ' ' }, null] }))).toEqual([])
    expect(model.resultsLine(run(), '未知')).toBe('3 条（单次 1 / 汇总 2）')
    expect(model.resultsLine(run({ results: [] }), '未知')).toBe('未知')
  })
})

describe('视图过滤与排序', () => {
  const rows = [
    run({ id: 'planned-old', status: 'planned', updatedAt: '2026-10-01T00:00:00.000Z' }),
    run({ id: 'running-new', status: 'running', updatedAt: '2026-11-10T00:00:00.000Z' }),
    run({ id: 'failed', status: 'failed', updatedAt: '2026-11-05T00:00:00.000Z' }),
    run({ id: 'archived', archived: true, updatedAt: '2026-11-06T00:00:00.000Z' }),
    run({ id: 'trashed', deletedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' }),
    run({ id: 'trashed-archived', archived: true, deletedAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' }),
  ]

  it('活跃视图没有归档与回收站，按最近更新从新到旧', () => {
    expect(model.viewRows(rows, 'active').map((row) => row.id)).toEqual(['running-new', 'failed', 'planned-old'])
  })

  it('活跃里按状态筛', () => {
    expect(model.viewRows(rows, 'active', 'planned').map((row) => row.id)).toEqual(['planned-old'])
    expect(model.viewRows(rows, 'active', 'failed').map((row) => row.id)).toEqual(['failed'])
    expect(model.viewRows(rows, 'active', 'succeeded')).toEqual([])
  })

  it('归档视图只有归档，回收站视图包括归档过的回收记录', () => {
    expect(model.viewRows(rows, 'archived').map((row) => row.id)).toEqual(['archived'])
    expect(model.viewRows(rows, 'trash').map((row) => row.id)).toEqual(['trashed', 'trashed-archived'])
  })

  it('不是数组时不抛错，读成空列表', () => {
    expect(model.viewRows(null, 'active')).toEqual([])
    expect(model.viewRows([null, 42, run()], 'active')).toHaveLength(1)
  })
})

describe('回收倒计时、复制与地址', () => {
  it('回收倒计时按三十天算，读不出来的时间不给倒计时', () => {
    const now = Date.parse('2026-11-10T00:00:00.000Z')
    expect(model.daysLeft(run({ deletedAt: '2026-11-01T00:00:00.000Z' }), now)).toBe(21)
    expect(model.daysLeft(run({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(30)
    expect(model.daysLeft(run({ deletedAt: '不是时间' }), now)).toBeNull()
    expect(model.daysLeft(run(), now)).toBeNull()
  })

  it('复制成计划中的运行：留配置与来源，不带状态、观测、结果、时间与产物', () => {
    const copyRecord = model.duplicateAsPlanned(run(), '副本')
    expect(copyRecord).toEqual({
      kind: 'run',
      title: '副本',
      status: 'planned',
      plan: { kind: 'research', id: 'research-1' },
      code: { repository: 'https://example.com/sim', commit: 'abc1234' },
      datasets: [
        { id: 'ds1', name: '合成信道', split: 'train', version: 'v1' },
        { id: 'ds2', name: '真实信道', split: 'test' },
      ],
      checkpoints: [{ name: 'epoch-120', value: '820', unit: 's', definition: '第 120 轮检查点' }],
      config: [{ name: 'batch', value: '64' }],
      environment: 'Ubuntu 24.04 / PyTorch 2.5',
      seed: '11',
      evaluation: '误码率与吞吐',
      note: '重跑前先检查学习率',
    })
    expect(copyRecord.metrics).toBeUndefined()
    expect(copyRecord.results).toBeUndefined()
    expect(copyRecord.startedAt).toBeUndefined()
    expect(copyRecord.endedAt).toBeUndefined()
    expect(copyRecord.failure).toBeUndefined()
    expect(copyRecord.artifacts).toBeUndefined()
    expect(model.duplicateAsPlanned(null, '副本')).toEqual({ kind: 'run', title: '副本', status: 'planned' })
  })

  it('复制标题加标记并截断，新建的默认标题带时刻', () => {
    expect(model.duplicateTitle(run())).toBe('种子 11 的干扰对齐仿真（计划副本）')
    expect(model.duplicateTitle(run({ title: 'x'.repeat(200) }))).toHaveLength(200)
    expect(model.duplicateTitle(null)).toContain('（计划副本）')
    const at = new Date(2026, 10, 15, 8, 5)
    expect(model.newRunTitle(at.getTime())).toBe('运行 2026-11-15 08:05')
  })

  it('产物只收 http/https 的完整地址，说明不能为空', () => {
    expect(model.artifactValid('https://example.com/log.txt', '训练日志')).toBe(true)
    expect(model.artifactValid('file:///etc/passwd', '训练日志')).toBe(false)
    expect(model.artifactValid('javascript:alert(1)', '训练日志')).toBe(false)
    expect(model.artifactValid('https://example.com', '  ')).toBe(false)
    expect(model.openableUrl('https://example.com/run/42')).toBe(true)
    expect(model.openableUrl('')).toBe(false)
  })

  it('文案占位符全部替换', () => {
    expect(model.fill('{n} 份产物 · 共 {total}', { n: 3, total: 8 })).toBe('3 份产物 · 共 8')
  })
})

describe('样例与清单', () => {
  it('m 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/run-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/run-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('run-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.draft',
      'widget-board:records.open',
    ])
    expect(manifest.scripts).toContain('run-model.js')
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
