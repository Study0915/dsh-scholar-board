/**
 * 成员卡的判定：稳定 id、称呼重复、停用保留、范围与文案。
 *
 * `member-model.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的实现。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/member-records/member-model.js'
import '../../widgets/member-records/copy.js'

interface MemberModel {
  KIND: string
  TITLE_LENGTH: number
  ROLE_LENGTH: number
  NOTE_LENGTH: number
  TRASH_DAYS: number
  textOf(value: unknown): string
  nameOf(record: unknown): string
  roleOf(record: unknown): string
  noteOf(record: unknown): string
  enabledOf(record: unknown): boolean
  statusKey(enabled: unknown): string
  viewRows(records: unknown, view: string): Array<Record<string, unknown>>
  summaryOf(record: unknown): string
  daysLeft(record: unknown, now?: number): number | null
  cleanTitle(value: unknown): string | null
  cleanRole(value: unknown): string | null
  cleanNote(value: unknown): string | null
  fill(text: string, values: Record<string, unknown>): string
}

const model = (globalThis as unknown as { MemberRecords: MemberModel }).MemberRecords
const copy = (globalThis as unknown as { MemberRecordsCopy: Record<string, { zh: string, en: string }> }).MemberRecordsCopy

/** 一条成员记录；默认启用。 */
function member(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm1',
    kind: 'member',
    title: '张老师',
    role: '指导教师',
    enabled: true,
    updatedAt: '2026-11-12T08:00:00.000Z',
    archived: false,
    ...overrides,
  }
}

describe('称呼、角色与启用状态', () => {
  it('称呼为空时退回 id，角色与备注取整理后的文字', () => {
    expect(model.KIND).toBe('member')
    expect(model.nameOf(member())).toBe('张老师')
    expect(model.nameOf(member({ title: '  李同学 ' }))).toBe('李同学')
    expect(model.nameOf(member({ title: '', id: 'm9' }))).toBe('m9')
    expect(model.nameOf(null)).toBe('')
    expect(model.roleOf(member({ role: '  数据  ' }))).toBe('数据')
    expect(model.noteOf(member({ note: '周末不看消息' }))).toBe('周末不看消息')
  })

  it('停用只是标记，缺字段的旧记录按启用处理', () => {
    expect(model.enabledOf(member())).toBe(true)
    expect(model.enabledOf({ enabled: undefined })).toBe(true)
    expect(model.enabledOf(member({ enabled: false }))).toBe(false)
    expect(model.statusKey(false)).toBe('disabled')
    expect(model.statusKey(true)).toBe('enabled')
  })

  it('角色与备注合成一行摘要', () => {
    expect(model.summaryOf(member())).toBe('指导教师')
    expect(model.summaryOf(member({ role: '数据', note: '周末不看消息' }))).toBe('数据 · 周末不看消息')
    expect(model.summaryOf(member({ role: '', note: '' }))).toBe('')
  })
})

describe('范围、排序与回收站倒计时', () => {
  it('活跃范围保留停用成员，归档与回收站分开', () => {
    const rows = [
      member({ id: 'm1', title: '乙' }),
      member({ id: 'm2', title: '甲', enabled: false }),
      member({ id: 'm3', title: '丙', archived: true }),
      member({ id: 'm4', title: '丁', deletedAt: '2026-11-10T00:00:00.000Z' }),
      { id: 'x', kind: 'project', title: '项目' },
    ]
    expect(model.viewRows(rows, 'active').map((record) => record.id)).toEqual(['m2', 'm1'])
    expect(model.viewRows(rows, 'archived').map((record) => record.id)).toEqual(['m3'])
    expect(model.viewRows(rows, 'trash').map((record) => record.id)).toEqual(['m4'])
  })

  it('同名成员仍在，排序按称呼再按 id', () => {
    const rows = [member({ id: 'b', title: '张老师' }), member({ id: 'a', title: '张老师' }), member({ id: 'c', title: '李同学' })]
    expect(model.viewRows(rows, 'active').map((record) => record.id)).toEqual(['c', 'a', 'b'])
  })

  it('回收站倒计时从删除日期算起，最多三十天', () => {
    const now = Date.parse('2026-11-12T00:00:00.000Z')
    expect(model.daysLeft(member(), now)).toBe(null)
    expect(model.daysLeft(member({ deletedAt: '2026-11-10T00:00:00.000Z' }), now)).toBe(28)
    expect(model.daysLeft(member({ deletedAt: '2020-01-01T00:00:00.000Z' }), now)).toBe(0)
    expect(model.daysLeft(member({ deletedAt: '坏日期' }), now)).toBe(null)
  })
})

describe('保存前的整理与文案', () => {
  it('称呼必填，角色与备注留空时省略', () => {
    expect(model.cleanTitle('  张老师 ')).toBe('张老师')
    expect(model.cleanTitle('   ')).toBe(null)
    expect(model.cleanTitle('x'.repeat(model.TITLE_LENGTH + 1))).toBe(null)
    expect(model.cleanRole('')).toBe(null)
    expect(model.cleanRole(' 数据 ')).toBe('数据')
    expect(model.cleanRole('x'.repeat(model.ROLE_LENGTH + 1))).toBe(null)
    expect(model.cleanNote('  ')).toBe(null)
    expect(model.cleanNote(' 周末不看消息 ')).toBe('周末不看消息')
    expect(model.cleanNote('x'.repeat(model.NOTE_LENGTH + 1))).toBe(null)
  })

  it('两条文案的占位符都能替换', () => {
    for (const entry of Object.values(copy)) {
      for (const language of [entry.zh, entry.en]) {
        expect(model.fill(language, { n: 2, total: 5, percent: 40 })).not.toMatch(/\{[a-z]+\}/i)
      }
    }
    expect(model.fill('{n} 位', { n: 3 })).toBe('3 位')
  })
})

describe('样例与清单', () => {
  it('m 与 l 两个尺寸族都有样例', () => {
    const samples = JSON.parse(readFileSync(new URL('../../widgets/member-records/samples.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(Object.keys(samples).sort()).toEqual(['l', 'm'])
  })

  it('清单声明记录能力，文案键与 copy.js 一致', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/member-records/widget.json', import.meta.url), 'utf8')) as {
      id: string
      source: string
      capabilities: string[]
      scripts: string[]
      text: Record<string, unknown>
    }
    expect(manifest.id).toBe('member-records')
    expect(manifest.source).toBe('widget-board:records')
    expect(manifest.capabilities).toEqual([
      'widget-board:records.read',
      'widget-board:records.write',
      'widget-board:records.open',
    ])
    expect(manifest.scripts).toEqual(['member-model.js', 'copy.js', 'view.js', 'editor.js', 'main.js'])
    expect(Object.keys(manifest.text).sort()).toEqual(Object.keys(copy).sort())
  })
})
