/**
 * 模板字段落进记录（S13）：内置模板的形状，以及把勾选字段分成输入项、观测项与专用位置。
 *
 * 这里判定的是运行卡与研究卡共用的那一份纯计算：值为空不写、同名就地替换、单位与说明跟着走。
 */
import { describe, expect, it } from 'vitest'
import { BUILTIN_TEMPLATES, TEMPLATE_LIMITS, builtinTemplate } from '@dsh-scholar-board/contracts'
import type { ResearchEntry, TemplateField } from '@dsh-scholar-board/contracts'
import { templateApplication, templateCurrent, templateValuesOf } from '../src/template-apply'

/** 一个字段。 */
function field(key: string, label: string, rest: Partial<TemplateField> = {}): TemplateField {
  return { key, label, type: 'text', group: 'input', ...rest }
}

describe('内置模板', () => {
  it('三个方向各有稳定 id、版本与至少一个字段', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual(['signal-processing', 'optical-detection', 'semantic-asr'])
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.version).toBeGreaterThanOrEqual(1)
      expect(template.fields.length).toBeGreaterThan(0)
      expect(template.fields.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.fields)
    }
  })

  it('每个模板里字段键唯一，显示名与类型都合法', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const keys = template.fields.map((entry) => entry.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const entry of template.fields) {
        expect(entry.label).not.toBe('')
        expect(['text', 'number', 'option']).toContain(entry.type)
        expect(['input', 'metric']).toContain(entry.group)
        if (entry.type === 'option') expect(Array.isArray(entry.options) && entry.options.length > 0).toBe(true)
      }
    }
  })

  it('按 id 找得到，找不到时明确没有', () => {
    expect(builtinTemplate('optical-detection')?.direction).toBe('光通信')
    expect(builtinTemplate('missing')).toBeUndefined()
  })
})

describe('模板应用', () => {
  it('输入项与观测项分开，单位与说明跟着条目走', () => {
    const fields = [
      field('sampleRate', '采样率', { type: 'number', unit: 'Hz' }),
      field('ber', 'BER', { type: 'number', group: 'metric', unit: '%', note: '误码率定义' }),
    ]
    const applied = templateApplication(fields, { 采样率: '2000', BER: '3.2e-4' })
    expect(applied.inputs).toEqual([{ name: '采样率', value: '2000', unit: 'Hz' }])
    expect(applied.metrics).toEqual([{ name: 'BER', value: '3.2e-4', unit: '%', definition: '误码率定义' }])
    expect(applied.seed).toBeNull()
  })

  it('种子、评估集合与环境落到专用位置，不重复进条目', () => {
    const fields = [field('seed', '种子'), field('evaluationSet', '评估集合'), field('environment', '环境')]
    const applied = templateApplication(fields, { 种子: '11, 42', 评估集合: 'test-clean', 环境: 'Ubuntu 24.04' })
    expect(applied.inputs).toEqual([])
    expect(applied.seed).toBe('11, 42')
    expect(applied.evaluation).toBe('test-clean')
    expect(applied.environment).toBe('Ubuntu 24.04')
  })

  it('值为空不写入，避免模板里用不到的项变成半填行', () => {
    const applied = templateApplication([field('sampleRate', '采样率'), field('ber', 'BER', { group: 'metric' })], { 采样率: '  ', BER: '' })
    expect(applied.inputs).toEqual([])
    expect(applied.metrics).toEqual([])
  })

  it('同名条目就地替换，其余保持原样', () => {
    const existing: ResearchEntry[] = [{ name: '采样率', value: '1000' }, { name: '带宽', value: '20' }]
    const applied = templateApplication([field('sampleRate', '采样率')], { 采样率: '2000' }, { inputs: existing })
    expect(applied.inputs).toEqual([{ name: '采样率', value: '2000' }, { name: '带宽', value: '20' }])
  })

  it('已有值按显示名汇总，空输入框不算已填', () => {
    const current = templateCurrent(
      [[{ name: '采样率', value: '1000' }], [{ name: 'BER', value: '1e-3' }]],
      { 种子: '  ', 环境: 'Ubuntu 24.04' },
    )
    expect(current).toEqual({ 采样率: '1000', BER: '1e-3', 环境: 'Ubuntu 24.04' })
  })

  it('快照里的值按显示名取，缺项不补占位', () => {
    expect(templateValuesOf({ id: 'signal-processing', version: 1, values: [{ key: 'sampleRate', label: '采样率', value: '2000' }] })).toEqual({ 采样率: '2000' })
    expect(templateValuesOf({ id: 'x', version: 1, values: [] })).toEqual({})
  })
})
