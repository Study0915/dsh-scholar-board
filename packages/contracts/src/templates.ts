/**
 * 实验模板（S13）：把通信方向的常用字段做成可复用的清单。
 *
 * 模板也是共享记录的一种，占用工作区的条数与字节上限，随记录一起导出、导入与备份；它不属于任何一次
 * 运行，也不执行字段里的任何内容。内置模板在代码里定义，个人模板是 `template` 记录。
 */
import type { MaterialRef, RecordBase, RecordRef } from './records'

/** 模板字段的取值类型；首批只收文字、数字与选项。 */
export type TemplateFieldType = 'text' | 'number' | 'option'

/** 字段进入记录的位置：输入项进参数或配置，观测项进指标。 */
export type TemplateFieldGroup = 'input' | 'metric'

/** 一个模板字段：键、显示名、类型、单位、说明、适用条件与建议选项。 */
export interface TemplateField {
  key: string
  label: string
  type: TemplateFieldType
  group: TemplateFieldGroup
  unit?: string
  note?: string
  when?: string
  options?: string[]
}

/** 个人模板记录：名称在 `title`，方向与字段定义在这里。 */
export interface TemplateRecord extends RecordBase {
  kind: 'template'
  title: string
  direction: string
  fields: TemplateField[]
  /** 模板说明材料的链接；不参与关联。 */
  materials?: MaterialRef[]
  related?: RecordRef[]
}

/** 应用模板时保存到记录里的一项值。 */
export interface TemplateValue {
  key: string
  label: string
  value: string
}

/** 记录所用的模板 id、版本与应用时的字段快照；模板以后改动不影响它。 */
export interface TemplateSnapshot {
  id: string
  version: number
  values: TemplateValue[]
}

/** 内置模板的版本与字段；不落盘，随代码发布。 */
export interface BuiltinTemplate {
  id: string
  title: string
  direction: string
  version: number
  fields: readonly TemplateField[]
}

/** 模板字段与快照的上限。 */
export const TEMPLATE_LIMITS = {
  fields: 48,
  keyLength: 64,
  labelLength: 80,
  unitLength: 32,
  noteLength: 200,
  options: 20,
  optionLength: 60,
  values: 48,
  valueLength: 2000,
} as const

/** 字段可以进入的两个位置。 */
export const TEMPLATE_FIELD_GROUPS: readonly TemplateFieldGroup[] = ['input', 'metric']

/** 字段可以取的类型。 */
export const TEMPLATE_FIELD_TYPES: readonly TemplateFieldType[] = ['text', 'number', 'option']

/**
 * 内置字段的简写：键与显示名相同，默认是输入项。
 *
 * @param key - 稳定键。
 * @param label - 显示名。
 * @param rest - 类型、单位、说明与建议选项。
 * @returns 一个字段。
 */
function field(key: string, label: string, rest: Partial<TemplateField> = {}): TemplateField {
  return { key, label, type: 'text', group: 'input', ...rest }
}

/** 三个通信方向的内置模板；无线扩展留到后续批次。 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: 'signal-processing',
    title: '通用信号处理',
    direction: '信号处理',
    version: 1,
    fields: [
      field('sampleRate', '采样率', { type: 'number', unit: 'Hz' }),
      field('bandwidth', '带宽', { type: 'number', unit: 'Hz' }),
      field('signalModel', '信号模型', { note: '写出调制、脉冲形状或随机过程模型' }),
      field('noiseModel', '噪声模型'),
      field('snrDefinition', 'SNR 定义', { note: '说明 SNR 按符号、采样点还是带宽归一化' }),
      field('synchronization', '同步与估计误差'),
      field('quantization', '量化'),
      field('monteCarlo', 'Monte Carlo 次数', { type: 'number' }),
      field('threshold', '阈值'),
      field('evaluationSet', '评价集合'),
      field('ber', 'BER', { type: 'number', group: 'metric' }),
      field('evm', 'EVM', { group: 'metric', unit: '%' }),
      field('estimationError', '估计误差', { group: 'metric' }),
    ],
  },
  {
    id: 'optical-detection',
    title: '光通信与低比特检测',
    direction: '光通信',
    version: 1,
    fields: [
      field('modulation', '调制', { type: 'option', options: ['BPSK', 'QPSK', '16QAM', '64QAM'] }),
      field('symbolRate', '符号率', { type: 'number', unit: 'GBaud' }),
      field('linkCondition', '链路与器件条件', { note: '光纤、放大器、探测器与滤波器条件' }),
      field('receiver', '接收方式'),
      field('quantizationBits', '量化位数', { type: 'number', unit: 'bit' }),
      field('referenceQuality', '参考质量'),
      field('targetCondition', '目标条件', { type: 'option', options: ['强目标', '弱目标'] }),
      field('timingError', '时延误差'),
      field('thresholdCalibration', '阈值校准'),
      field('evaluationSet', '评估集合'),
      field('ber', 'BER', { type: 'number', group: 'metric' }),
      field('evm', 'EVM', { group: 'metric' }),
      field('osnr', 'OSNR', { type: 'number', unit: 'dB', group: 'metric' }),
      field('falseAlarm', '虚警率', { type: 'number', group: 'metric' }),
      field('detectionProbability', '检测概率', { type: 'number', group: 'metric' }),
    ],
  },
  {
    id: 'semantic-asr',
    title: '语义通信与 ASR',
    direction: '语义通信',
    version: 1,
    fields: [
      field('datasetSplit', '数据集划分', { note: '训练、验证与测试的划分和来源' }),
      field('preprocessing', '预处理'),
      field('modelCheckpoint', '模型与检查点'),
      field('budget', '预算'),
      field('seed', '种子'),
      field('channel', '信道'),
      field('decoding', '解码规则'),
      field('textNormalization', '文本归一化'),
      field('wer', 'WER', { group: 'metric', unit: '%' }),
      field('cer', 'CER', { group: 'metric', unit: '%' }),
      field('semanticScore', '语义指标', { group: 'metric' }),
    ],
  },
]

/**
 * 按 id 找内置模板。
 *
 * @param id - 模板 id。
 * @returns 内置模板；没有时是 `undefined`。
 */
export function builtinTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find(template => template.id === id)
}
