/**
 * 运行比较卡的判定：口径行、指标可比性、差值与选择。
 *
 * `compare-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的实现。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/run-comparison/compare-model.js'
import '../../widgets/run-comparison/copy.js'

interface Cell {
  runId: string
  text: string | null
  unknown?: boolean
  missing?: boolean
  value?: string
  numeric?: number | null
  unit?: string
  definition?: string
}

interface ComparisonRow {
  id?: string
  name?: string
  cells: Cell[]
  status: string
  reason?: string
}

interface DeltaResult {
  ok: boolean
  reason?: string
  difference?: number
  relative?: number | null
  relativeReason?: string
  unit?: string
  baseline?: number
  target?: number
  direction?: string
}

interface CompareModel {
  KIND: string
  ROLES: string[]
  DIRECTIONS: string[]
  LIMIT: number
  DIMENSION_IDS: string[]
  conditionRows(runs: unknown, plans?: unknown): ComparisonRow[]
  metricRows(runs: unknown): ComparisonRow[]
  metricStatus(cells: unknown): { status: string, reason: string }
  differencesOf(rows: ComparisonRow[]): string[]
  unknownsOf(rows: ComparisonRow[]): string[]
  normalizeSelection(value: unknown): Array<{ id: string, role: string }>
  selectionWithRole(value: unknown, id: string, role: string): Array<{ id: string, role: string }>
  directionOf(value: unknown): string
  statKind(record: unknown): string
  statLine(record: unknown): string | null
  seedCount(record: unknown): number
  deltaOf(row: ComparisonRow, baseline: unknown, target: unknown, options: unknown): DeltaResult
}

const model = (globalThis as unknown as { RunComparison: CompareModel }).RunComparison
const copy = (globalThis as unknown as { RunComparisonCopy: Record<string, unknown> }).RunComparisonCopy

/** 一条可比较的运行。 */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'run-1',
    kind: 'run',
    title: '种子 11 的干扰对齐仿真',
    plan: { kind: 'research', id: 'research-1' },
    status: 'succeeded',
    code: { repository: 'https://example.com/sim', commit: 'abc1234' },
    datasets: [{ id: 'd1', name: '合成信道', split: 'test', version: 'v1' }],
    checkpoints: [{ name: 'best', value: '120', unit: 'epoch' }],
    config: [{ name: 'batch', value: '64' }, { name: 'epochs', value: '120' }],
    environment: 'Ubuntu 24.04 / PyTorch 2.5',
    seed: '11',
    evaluation: '阈值校准：偶数帧；评估：奇数帧',
    metrics: [
      { name: 'p_det', value: '0.82', unit: '1', definition: '固定虚警率下的检测概率' },
      { name: 'latency', value: '12', unit: 'ms' },
    ],
    results: [{ id: 'r1', kind: 'single' }],
    ...overrides,
  }
}

/** 取某个指标在比较表里的行。 */
function metricRow(name: string, runs: unknown[]): ComparisonRow {
  const row = model.metricRows(runs).find(candidate => candidate.name === name)
  if (row === undefined) throw new Error(`缺少指标 ${name}`)
  return row
}

describe('运行比较：口径行', () => {
  it('字段完全一致时每行都相同', () => {
    const runs = [run({ id: 'run-1' }), run({ id: 'run-2' })]
    const rows = model.conditionRows(runs, { 'research-1': '干扰对齐仿真' })
    expect(rows.map(row => row.id)).toEqual(['plan', 'datasets', 'environment', 'config', 'checkpoints', 'seed', 'evaluation', 'code', 'statistics'])
    expect(rows.every(row => row.status === 'same')).toBe(true)
    expect(model.differencesOf(rows)).toEqual([])
    expect(model.unknownsOf(rows)).toEqual([])
  })

  it('环境不同与字段缺失分别标出来，配置顺序不影响比较', () => {
    const runs = [
      run({ id: 'run-1' }),
      run({
        id: 'run-2',
        environment: 'Ubuntu 24.04 / PyTorch 2.6',
        config: [{ name: 'epochs', value: '120' }, { name: 'batch', value: '64' }],
        seed: '',
      }),
    ]
    const rows = model.conditionRows(runs, { 'research-1': '干扰对齐仿真' })
    const environment = rows.find(row => row.id === 'environment')
    const seed = rows.find(row => row.id === 'seed')
    const config = rows.find(row => row.id === 'config')
    expect(environment?.status).toBe('different')
    expect(seed?.status).toBe('unknown')
    expect(config?.status).toBe('same')
    expect(model.differencesOf(rows)).toEqual(['environment'])
    expect(model.unknownsOf(rows)).toEqual(['seed'])
  })

  it('方案与代码只有一半时算未知，不猜', () => {
    const runs = [
      run({ id: 'run-1' }),
      run({ id: 'run-2', plan: undefined, code: { repository: 'https://example.com/sim' } }),
    ]
    const rows = model.conditionRows(runs, {})
    expect(rows.find(row => row.id === 'plan')?.status).toBe('unknown')
    expect(rows.find(row => row.id === 'code')?.status).toBe('unknown')
    expect(rows.find(row => row.id === 'code')?.cells[1].unknown).toBe(true)
  })
})

describe('运行比较：指标可比性', () => {
  it('数值与单位一致才算可比，定义冲突单独标出', () => {
    const runs = [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'p_det', value: '0.86', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }] }),
    ]
    expect(metricRow('p_det', runs).status).toBe('comparable')
    const conflict = [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'p_det', value: '0.86', unit: '1', definition: '别的定义' }] }),
    ]
    expect(metricRow('p_det', conflict)).toMatchObject({ status: 'different', reason: 'definition' })
  })

  it('单位缺失、单位不同、没填与文字值都不算可比', () => {
    expect(metricRow('p_det', [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'p_det', value: '0.86' }] }),
    ])).toMatchObject({ status: 'unknown', reason: 'unit' })

    expect(metricRow('latency', [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'latency', value: '11', unit: 's' }] }),
    ])).toMatchObject({ status: 'different', reason: 'unit' })

    expect(metricRow('p_det', [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'latency', value: '11', unit: 'ms' }] }),
    ])).toMatchObject({ status: 'unknown', reason: 'missing' })

    expect(metricRow('p_det', [
      run({ id: 'run-1' }),
      run({ id: 'run-2', metrics: [{ name: 'p_det', value: '高', unit: '1', definition: '固定虚警率下的检测概率' }] }),
    ])).toMatchObject({ status: 'text', reason: 'value' })
  })
})

describe('运行比较：差值', () => {
  it('未确认同口径时不算差值', () => {
    const baseline = run({ id: 'run-1' })
    const target = run({ id: 'run-2', metrics: [{ name: 'p_det', value: '0.86', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }] })
    const row = metricRow('p_det', [baseline, target])
    expect(model.deltaOf(row, baseline, target, { confirmed: false })).toEqual({ ok: false, reason: 'unconfirmed' })
  })

  it('确认后按指定方向给出差值与相对变化', () => {
    const baseline = run({ id: 'run-1' })
    const target = run({ id: 'run-2', metrics: [{ name: 'p_det', value: '0.86', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }] })
    const row = metricRow('p_det', [baseline, target])
    const forward = model.deltaOf(row, baseline, target, { confirmed: true, direction: 'target-minus-baseline' })
    expect(forward.ok).toBe(true)
    expect(forward.difference).toBeCloseTo(0.04, 10)
    expect(forward.relative).toBeCloseTo(0.04 / 0.82, 10)
    expect(forward.unit).toBe('1')
    const backward = model.deltaOf(row, baseline, target, { confirmed: true, direction: 'baseline-minus-target' })
    expect(backward.difference).toBeCloseTo(-0.04, 10)
  })

  it('零基线只给绝对差值，不给相对变化', () => {
    const baseline = run({
      id: 'run-1',
      metrics: [{ name: 'ber', value: '0', unit: '1' }],
    })
    const target = run({
      id: 'run-2',
      metrics: [{ name: 'ber', value: '1e-3', unit: '1' }],
    })
    const row = metricRow('ber', [baseline, target])
    const delta = model.deltaOf(row, baseline, target, { confirmed: true })
    expect(delta.ok).toBe(true)
    expect(delta.difference).toBeCloseTo(0.001, 10)
    expect(delta.relative).toBeNull()
    expect(delta.relativeReason).toBe('zero-baseline')
  })

  it('汇总、多组种子与统计方式不明时不混算', () => {
    const baseline = run({ id: 'run-1' })
    const aggregate = run({
      id: 'run-2',
      results: [{ id: 'r2', kind: 'aggregate', method: '中位数', sampleSize: 3, dispersion: 'IQR' }],
      metrics: [{ name: 'p_det', value: '0.85', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }],
    })
    expect(model.deltaOf(metricRow('p_det', [baseline, aggregate]), baseline, aggregate, { confirmed: true })).toEqual({ ok: false, reason: 'aggregate' })

    const multiSeed = run({
      id: 'run-3',
      seed: '11, 42, 97',
      metrics: [{ name: 'p_det', value: '0.84', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }],
    })
    expect(model.deltaOf(metricRow('p_det', [baseline, multiSeed]), baseline, multiSeed, { confirmed: true })).toEqual({ ok: false, reason: 'aggregate' })

    const unknown = run({
      id: 'run-4',
      seed: '',
      results: undefined,
      metrics: [{ name: 'p_det', value: '0.83', unit: '1', definition: '固定虚警率下的检测概率' }, { name: 'latency', value: '11', unit: 'ms' }],
    })
    expect(model.deltaOf(metricRow('p_det', [baseline, unknown]), baseline, unknown, { confirmed: true })).toEqual({ ok: false, reason: 'statistics' })
  })

  it('单位不同时不计算差值', () => {
    const baseline = run({ id: 'run-1' })
    const target = run({
      id: 'run-2',
      metrics: [{ name: 'latency', value: '11000', unit: 'us' }, { name: 'p_det', value: '0.86', unit: '1', definition: '固定虚警率下的检测概率' }],
    })
    const row = metricRow('latency', [baseline, target])
    expect(model.deltaOf(row, baseline, target, { confirmed: true })).toEqual({ ok: false, reason: 'unit' })
  })
})

describe('运行比较：选择与统计口径', () => {
  it('最多八条，基线最多一条', () => {
    const selection = model.normalizeSelection([
      { id: 'a', role: 'baseline' },
      { id: 'b', role: 'baseline' },
      { id: 'a', role: 'other' },
      { id: '', role: 'other' },
      { id: 'c', role: 'unknown' },
      { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' },
    ])
    expect(selection).toHaveLength(8)
    expect(selection.filter(item => item.role === 'baseline')).toHaveLength(1)
    expect(selection[0]).toEqual({ id: 'a', role: 'baseline' })
    expect(selection[1]).toEqual({ id: 'b', role: 'other' })
    expect(model.selectionWithRole(selection, 'c', 'baseline').filter(item => item.role === 'baseline')).toEqual([{ id: 'c', role: 'baseline' }])
  })

  it('统计口径按结果与种子判断，不把多组种子当单次值', () => {
    expect(model.statKind(run())).toBe('single')
    expect(model.statKind(run({ seed: '11, 42' }))).toBe('aggregate')
    expect(model.statKind(run({ seed: '', results: [{ id: 'r1', kind: 'aggregate', method: '均值', sampleSize: 3 }] }))).toBe('aggregate')
    expect(model.statKind(run({ seed: '', results: [] }))).toBe('unknown')
    expect(model.seedCount(run({ seed: '11，42；97' }))).toBe(3)
    expect(model.statLine(run({ results: [{ id: 'r1', kind: 'aggregate', method: '中位数', sampleSize: 3, dispersion: 'IQR' }] }))).toContain('n=3')
  })
})

describe('运行比较：清单', () => {
  it('清单声明只读能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/run-comparison/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('run-comparison')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual(['widget-board:records.read', 'widget-board:records.open'])
    expect(manifest.scripts).toContain('compare-model.js')
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})