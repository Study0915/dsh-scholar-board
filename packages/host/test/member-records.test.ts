/**
 * 分工与交接（S19）：成员稳定 id、同名允许、停用保留分工，评审与交接的校验和备份重映射。
 *
 * 记录读写走真实磁盘；这里判定的是宿主的公开契约，不是某张卡片的私有状态。
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionRecord, MemberRecord, MeetingRecord, ProjectRecord } from '@dsh-scholar-board/contracts'
import { exportRecords, importRecords, previewRecords } from '../src/records/exchange'
import { openRecords } from '../src/records/store'
import type { RecordsStore } from '../src/records/store'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ACTOR = { widget: 'project-records', instance: 'member-card' }
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** 在隔离目录打开一份真实存储。 */
async function open(): Promise<RecordsStore> {
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'member-test-'))
  homes.push(home)
  return await openRecords(join(home, 'records.json'), { now: () => Date.UTC(2026, 10, 16) })
}

/** 一条成员输入。 */
function member(title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'member', title, ...overrides }
}

describe('成员目录', () => {
  it('同名成员各有稳定 id，停用保留已有分工', async () => {
    const store = await open()
    const first = (await store.create(member('张老师', { role: '指导教师' }), ACTOR)).record as MemberRecord
    const second = (await store.create(member('张老师'), ACTOR)).record as MemberRecord
    expect(first.id).not.toBe(second.id)
    expect(first.enabled).toBe(true)

    const project = (await store.create({
      kind: 'project',
      title: '横向项目',
      tasks: [{ id: 't1', title: '搭建仿真', status: 'todo', owner: first.id, collaborators: [second.id] }],
    }, ACTOR)).record as ProjectRecord
    const disabled = (await store.update(first.id, first.revision, { enabled: false }, ACTOR)).record as MemberRecord
    expect(disabled.enabled).toBe(false)
    expect(store.get(project.id)?.tasks?.[0].owner).toBe(first.id)
    expect(store.view({ kind: 'member', includeArchived: true }).records.map((row) => row.id).sort()).toEqual([first.id, second.id].sort())
  })

  it('成员字段按契约校验：称呼必填、启用是布尔、角色与备注有长度上限', async () => {
    const store = await open()
    await expect(store.create(member('   '), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(member('坏状态', { enabled: 'yes' }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(member('长角色', { role: 'x'.repeat(201) }), ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.create(member('长备注', { note: 'x'.repeat(2001) }), ACTOR)).rejects.toMatchObject({ status: 400 })
    const created = (await store.create(member('正常', { role: ' 数据 ', note: ' 周末不看消息 ' }), ACTOR)).record as MemberRecord
    expect(created.role).toBe('数据')
    expect(created.note).toBe('周末不看消息')
  })
})

describe('分工字段与评审交接', () => {
  it('会议参与者、行动项负责人与项目事项分工都按成员 id 保存', async () => {
    const store = await open()
    const owner = (await store.create(member('甲'), ACTOR)).record
    const helper = (await store.create(member('乙'), ACTOR)).record
    const meeting = (await store.create({ kind: 'meeting', title: '组会', participants: [owner.id, helper.id] }, ACTOR)).record as MeetingRecord
    const action = (await store.create({ kind: 'action', title: '补实验', status: 'todo', owner: owner.id, collaborators: [helper.id], confirmers: [owner.id] }, ACTOR)).record as ActionRecord
    expect(meeting.participants).toEqual([owner.id, helper.id])
    expect(action.owner).toBe(owner.id)
    expect(action.collaborators).toEqual([helper.id])
    await expect(store.update(action.id, action.revision, { collaborators: [helper.id, helper.id] }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.update(action.id, action.revision, { owner: 'x'.repeat(65) }, ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('评审记录对象与版本、称呼、意见、决定和后续行动', async () => {
    const store = await open()
    const reviewer = (await store.create(member('评审人'), ACTOR)).record
    const project = (await store.create({
      kind: 'project',
      title: '横向项目',
      reviews: [{
        id: 'rv1',
        target: 'deliverable',
        targetId: 'd1',
        targetVersion: 'v1',
        reviewer: reviewer.id,
        opinion: '缺少基线对比',
        decision: '修改后通过',
        followUp: '补一组对照实验',
      }],
    }, ACTOR)).record as ProjectRecord
    expect(project.reviews?.[0]).toMatchObject({ target: 'deliverable', targetId: 'd1', reviewer: reviewer.id, decision: '修改后通过' })
    await expect(store.update(project.id, project.revision, {
      reviews: [{ id: 'rv2', target: 'deliverable', opinion: '没有对象', decision: '通过' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    await expect(store.update(project.id, project.revision, {
      reviews: [{ id: 'rv2', target: 'project', opinion: '', decision: '通过' }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
  })

  it('交接确认由用户手动记录，未确认时不能写确认时间', async () => {
    const store = await open()
    const receiver = (await store.create(member('接手人'), ACTOR)).record
    const created = (await store.create({
      kind: 'project',
      title: '交接中的项目',
      handovers: [{ id: 'h1', receiver: receiver.id, progress: '仿真已跑通', instructions: '先看 README', confirmed: false }],
    }, ACTOR)).record as ProjectRecord
    expect(created.handovers?.[0].confirmed).toBe(false)
    await expect(store.update(created.id, created.revision, {
      handovers: [{ id: 'h1', confirmed: false, confirmedAt: { kind: 'date', date: '2026-11-16', timeZone: 'Asia/Shanghai' } }],
    }, ACTOR)).rejects.toMatchObject({ status: 400 })
    const confirmed = (await store.update(created.id, created.revision, {
      handovers: [{ id: 'h1', receiver: receiver.id, confirmed: true, confirmedAt: { kind: 'date', date: '2026-11-16', timeZone: 'Asia/Shanghai' } }],
    }, ACTOR)).record as ProjectRecord
    expect(confirmed.handovers?.[0].confirmedAt).toMatchObject({ date: '2026-11-16' })
  })
})

describe('备份与导入', () => {
  it('成员与分工一并导出，导入时成员 id 与所有分工引用一起重映射', async () => {
    const source = await open()
    const first = (await source.create(member('甲'), ACTOR)).record
    const second = (await source.create(member('乙'), ACTOR)).record
    await source.create({ kind: 'meeting', title: '组会', participants: [first.id, second.id] }, ACTOR)
    await source.create({ kind: 'action', title: '补实验', status: 'todo', owner: first.id, collaborators: [second.id] }, ACTOR)
    await source.create({
      kind: 'project',
      title: '横向项目',
      tasks: [{ id: 't1', title: '仿真', status: 'todo', owner: first.id, collaborators: [second.id], confirmers: [first.id] }],
      reviews: [{ id: 'rv1', target: 'project', reviewer: second.id, opinion: '可以', decision: '通过' }],
      handovers: [{ id: 'h1', receiver: first.id, confirmed: true }],
    }, ACTOR)
    const bytes = exportRecords(source, { includeArchived: false, includeTrashed: false }, Date.now())
    expect(previewRecords(bytes).byKind).toMatchObject({ member: 2, meeting: 1, action: 1, project: 1 })

    const target = await open()
    expect(await importRecords(target, bytes, Date.now())).toBe(5)
    const view = target.view({ includeArchived: true, includeTrashed: true })
    const members = view.records.filter((record): record is MemberRecord => record.kind === 'member')
    const importedFirst = members.find((record) => record.title === '甲')
    const importedSecond = members.find((record) => record.title === '乙')
    const importedMeeting = view.records.find((record): record is MeetingRecord => record.kind === 'meeting')
    const importedAction = view.records.find((record): record is ActionRecord => record.kind === 'action')
    const importedProject = view.records.find((record): record is ProjectRecord => record.kind === 'project')
    if (importedFirst === undefined || importedSecond === undefined || importedMeeting === undefined || importedAction === undefined || importedProject === undefined) throw new Error('导入后找不到成员或分工记录')
    expect(importedFirst.id).not.toBe(first.id)
    expect(importedMeeting.participants).toEqual([importedFirst.id, importedSecond.id])
    expect(importedAction.owner).toBe(importedFirst.id)
    expect(importedAction.collaborators).toEqual([importedSecond.id])
    expect(importedProject.tasks?.[0]).toMatchObject({ owner: importedFirst.id, collaborators: [importedSecond.id], confirmers: [importedFirst.id] })
    expect(importedProject.reviews?.[0].reviewer).toBe(importedSecond.id)
    expect(importedProject.handovers?.[0].receiver).toBe(importedFirst.id)
  })

  it('旧包没有成员与分工字段时照常导入', async () => {
    const source = await open()
    await source.create({ kind: 'project', title: '旧包项目', tasks: [{ id: 't1', title: '仿真', status: 'todo' }] }, ACTOR)
    const bytes = exportRecords(source, { includeArchived: false, includeTrashed: false }, Date.now())
    const target = await open()
    expect(await importRecords(target, bytes, Date.now())).toBe(1)
    const imported = target.view().records[0] as ProjectRecord
    expect(imported.title).toBe('旧包项目')
    expect(imported.tasks?.[0].owner).toBeUndefined()
    expect(imported.reviews).toBeUndefined()
    expect(imported.handovers).toBeUndefined()
    expect(target.view({ kind: 'member' }).records).toHaveLength(0)
  })
})
