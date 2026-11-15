/**
 * 模板字段落进记录（S13）：把选中的字段分成参数、指标与几个专用位置。
 *
 * 只做纯计算，不碰记录存储：研究卡把输入项放进参数，运行卡放进配置；两边都把观测项放进指标。
 * 值为空的字段不写入，避免模板里用不到的项变成半填行挡住保存。
 */
import type { ResearchEntry, TemplateField, TemplateSnapshot } from '@dsh-scholar-board/contracts'

/** 应用结果：输入项、观测项与专用位置的值。 */
export interface TemplateApplication {
  inputs: ResearchEntry[]
  metrics: ResearchEntry[]
  seed: string | null
  evaluation: string | null
  environment: string | null
}

const SEED = new Set(['seed', 'seeds', 'randomseed', 'random-seed', 'random_seed', '种子', '随机种子'])
const EVALUATION = new Set(['evaluation', 'evaluationset', 'evaluation-set', 'evaluation_set', '评估集合', '评价集合', '评测集'])
const ENVIRONMENT = new Set(['environment', 'env', '环境'])

/**
 * 字段落在哪个专用位置。
 *
 * @param field - 模板字段。
 * @returns 专用位置；普通输入项时是 `null`。
 */
function roleOf(field: TemplateField): 'seed' | 'evaluation' | 'environment' | null {
  const key = field.key.trim().toLowerCase()
  const label = field.label.trim().toLowerCase()
  if (SEED.has(key) || SEED.has(label)) return 'seed'
  if (EVALUATION.has(key) || EVALUATION.has(label)) return 'evaluation'
  if (ENVIRONMENT.has(key) || ENVIRONMENT.has(label)) return 'environment'
  return null
}

/**
 * 记录里已有的值，按显示名索引；预览据此默认保留同名值。
 *
 * @param lists - 已有的条目列表，例如参数与指标。
 * @param extras - 专用输入框的值，按显示名索引；空串不算已填。
 * @returns 显示名到值的映射。
 */
export function templateCurrent(lists: readonly (readonly ResearchEntry[])[], extras: Record<string, string> = {}): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rows of lists) {
    for (const row of rows) {
      if (row !== null && typeof row === 'object' && typeof row.name === 'string' && row.name !== '') {
        values[row.name] = typeof row.value === 'string' ? row.value : ''
      }
    }
  }
  for (const [label, value] of Object.entries(extras)) {
    if (value.trim() !== '') values[label] = value
  }
  return values
}

/**
 * 应用时快照里的值，按显示名索引。
 *
 * @param snapshot - 面板给出的快照。
 * @returns 显示名到值的映射。
 */
export function templateValuesOf(snapshot: TemplateSnapshot): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of Array.isArray(snapshot.values) ? snapshot.values : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.label === 'string') {
      values[entry.label] = typeof entry.value === 'string' ? entry.value : ''
    }
  }
  return values
}

/**
 * 把选中的模板字段换算成记录里的条目。
 *
 * 同名条目就地替换，其余保持原样；这样勾选「已填写」的字段是替换，不会出现两份同名值。
 *
 * @param fields - 用户勾选并应用的字段。
 * @param current - 应用时的值，按显示名索引。
 * @param existing - 记录里已有的输入项与观测项。
 * @returns 合并后的输入项、观测项与专用位置。
 */
export function templateApplication(
  fields: readonly TemplateField[],
  current: Record<string, string>,
  existing: { inputs?: readonly ResearchEntry[]; metrics?: readonly ResearchEntry[] } = {},
): TemplateApplication {
  const inputs = Array.isArray(existing.inputs) ? existing.inputs.slice() : []
  const metrics = Array.isArray(existing.metrics) ? existing.metrics.slice() : []
  let seed: string | null = null
  let evaluation: string | null = null
  let environment: string | null = null
  for (const field of fields) {
    const value = (current[field.label] ?? '').trim()
    if (value === '') continue
    const role = field.group === 'metric' ? null : roleOf(field)
    if (role === 'seed') { seed = value; continue }
    if (role === 'evaluation') { evaluation = value; continue }
    if (role === 'environment') { environment = value; continue }
    const entry: ResearchEntry = { name: field.label, value }
    if (field.unit !== undefined && field.unit !== '') entry.unit = field.unit
    if (field.note !== undefined && field.note !== '') entry.definition = field.note
    const target = field.group === 'metric' ? metrics : inputs
    const at = target.findIndex(row => row.name === field.label)
    if (at >= 0) target[at] = entry
    else target.push(entry)
  }
  return { inputs, metrics, seed, evaluation, environment }
}
