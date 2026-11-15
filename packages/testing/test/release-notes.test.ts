/**
 * 发布说明取段（发布管线）：打包的版本可能已经作为待发布改动写进 CHANGELOG，这时不能再插一段，
 * 否则 CHANGELOG 里多一个只有占位说明的空段，发布说明也取到空段。这里对着两种 CHANGELOG 内容
 * 验证取舍：已有这一版就沿用原文，没有才按正常发布收条目。
 */
import { describe, expect, it } from 'vitest'
import { findSection, releaseNotesPlan } from '../../../scripts/release-notes.mjs'

const CHANGELOG = `# 变更记录

## [Unreleased]

## [0.5.0] - 2026-11-15

[中文](#cn-0.5.0) | [English](#en-0.5.0)

<h3 id="cn-0.5.0">新增功能</h3>

- 一条已有的改动。

## [0.1.6] - 2026-11-14

- 旧的一版。
`

describe('发布说明', () => {
  it('已有这一版时沿用原文，不改 CHANGELOG', () => {
    const plan = releaseNotesPlan(CHANGELOG, '0.5.0', 0)
    expect(plan.reuse).toBe(true)
    expect(plan.section).toContain('一条已有的改动。')
    expect(plan.section).not.toContain('旧的一版。')
  })

  it('没有这一版时按正常发布收条目', () => {
    const plan = releaseNotesPlan(CHANGELOG, '0.6.0', 0)
    expect(plan.reuse).toBe(false)
    expect(plan.section).toBeUndefined()
  })

  it('已有这一版但还有待发布条目时拒绝打包，不丢条目', () => {
    expect(() => releaseNotesPlan(CHANGELOG, '0.5.0', 2)).toThrow(/已经有 0\.5\.0 的段/)
  })

  it('段只到下一个版本标题为止', () => {
    expect(findSection(CHANGELOG, '0.5.0')?.endsWith('一条已有的改动。')).toBe(true)
    expect(findSection(CHANGELOG, '9.9.9')).toBeUndefined()
  })
})