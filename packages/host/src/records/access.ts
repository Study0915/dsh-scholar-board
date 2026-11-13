/**
 * 领域记录的公开访问（D24、D32、D36）：两项能力与一个数据源，都不声明权限。
 *
 * 免授权与 `widget-board:usage` 同类：写记录不往外部世界发东西，约束由 schema、容量上限、修订冲突
 * 与 lastEditedBy 承担。内置组件与用户组件走同一条 `widget.call` 与数据源，沙箱不变（D3）。
 */
import type {
  CapabilityRegistration,
  DataSourceRegistration,
  InstanceFace,
  RecordKind,
  RecordQuery,
  RecordWriteResult,
  RecordsView,
} from '@dsh-scholar-board/contracts'
import {
  RECORDS_DRAFT_CAPABILITY,
  RECORDS_PROVIDER,
  RECORDS_READ_CAPABILITY,
  RECORDS_SOURCE,
  RECORDS_WRITE_CAPABILITY,
  RECORDS_LIMITS,
  WIDGET_BOARD_API_VERSION,
} from '@dsh-scholar-board/contracts'
import type { DraftStore } from '../drafts/store'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import type { Registries } from '../sources'
import type { RecordsStore } from './store'

const READ_INPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { enum: ['meeting', 'action', 'manuscript', 'literature'] },
    ids: { type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 64 } },
    includeArchived: { type: 'boolean' },
    includeTrashed: { type: 'boolean' },
    search: { type: 'string', maxLength: RECORDS_LIMITS.searchLength },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id'],
      properties: {
        kind: { enum: ['meeting', 'manuscript'] },
        id: { type: 'string', minLength: 1, maxLength: 64 },
      },
    },
  },
} as const

const WRITE_INPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['op'],
  properties: {
    op: { enum: ['create', 'update', 'archive', 'restore', 'trash'] },
    id: { type: 'string', minLength: 1, maxLength: 64 },
    expectedRevision: { type: 'integer', minimum: 0 },
    record: { type: 'object' },
    patch: { type: 'object' },
  },
} as const

const DRAFT_INPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['op'],
  properties: {
    op: { enum: ['save', 'load', 'remove'] },
    draftId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
    recordId: { type: 'string', minLength: 1, maxLength: 64 },
    form: { type: 'object' },
  },
} as const

/** 内置记录组件按 id 取类型：卡片没写 props.kind 时也读得到自己的那一类。 */
const WIDGET_KINDS: Record<string, RecordKind> = {
  'meeting-records': 'meeting',
  'action-items': 'action',
  'manuscript-records': 'manuscript',
  'literature-records': 'literature',
}

/** 数据源能认的记录类型：props.kind 优先，内置记录组件按 id 取类型。 */
function kindOf(instance: InstanceFace): RecordKind | undefined {
  const kind = instance.props.kind
  if (kind === 'meeting' || kind === 'action' || kind === 'manuscript' || kind === 'literature') return kind
  return WIDGET_KINDS[instance.widget]
}

/**
 * 读一次记录。
 *
 * @param store - 记录存储。
 * @param args - 已经按 input schema 校验过的参数。
 * @returns 记录、用量与截断标记。
 */
function readOf(store: RecordsStore, args: unknown): RecordsView {
  const body = isRecord(args) ? args : {}
  const source = isRecord(body.source) && typeof body.source.id === 'string' && (body.source.kind === 'meeting' || body.source.kind === 'manuscript')
    ? { kind: body.source.kind, id: body.source.id } as const
    : undefined
  const query: RecordQuery = {
    ...(typeof body.kind === 'string' ? { kind: body.kind as RecordKind } : {}),
    ...(Array.isArray(body.ids) ? { ids: body.ids.filter((id): id is string => typeof id === 'string') } : {}),
    ...(body.includeArchived === true ? { includeArchived: true } : {}),
    ...(body.includeTrashed === true ? { includeTrashed: true } : {}),
    ...(typeof body.search === 'string' ? { search: body.search } : {}),
    ...(source === undefined ? {} : { source }),
  }
  return store.view(query)
}

/**
 * 做一次写操作。
 *
 * @param store - 记录存储。
 * @param instance - 发起调用的卡片。
 * @param args - 已经按 input schema 校验过的参数。
 * @returns 写后的记录与修订号。
 * @throws {Refusal} 形状不对、记录不存在、修订号过期、容量到顶或记录在回收站里。
 */
async function writeOf(store: RecordsStore, instance: InstanceFace, args: unknown): Promise<RecordWriteResult> {
  if (!isRecord(args) || typeof args.op !== 'string') throw new Refusal(400, '写记录要写明 op')
  const actor = { widget: instance.widget, instance: instance.id }
  if (args.op === 'create') {
    if (!isRecord(args.record)) throw new Refusal(400, '新建记录要把字段放在 record 里')
    return await store.create(args.record, actor)
  }
  if (typeof args.id !== 'string' || args.id === '') throw new Refusal(400, `${args.op} 要写明记录 id`)
  if (!Number.isInteger(args.expectedRevision) || (args.expectedRevision as number) < 0) {
    throw new Refusal(400, `${args.op} 要写明 expectedRevision`)
  }
  const expected = args.expectedRevision as number
  switch (args.op) {
    case 'update':
      if (!isRecord(args.patch)) throw new Refusal(400, '更新记录要把字段放在 patch 里')
      return await store.update(args.id, expected, args.patch, actor)
    case 'archive':
      return await store.archive(args.id, expected, actor)
    case 'restore':
      return await store.restore(args.id, expected, actor)
    case 'trash':
      return await store.trash(args.id, expected, actor)
    default:
      throw new Refusal(400, `不认识的写操作：${args.op}`)
  }
}

/**
 * 草稿操作：键是草稿 id，由组件存进自己的实例状态，跨刷新保留。
 *
 * @param drafts - 草稿存储。
 * @param args - 已经按 input schema 校验过的参数。
 * @returns 保存的草稿、读到的草稿或删除结果。
 */
async function draftOf(drafts: DraftStore, args: unknown): Promise<unknown> {
  if (!isRecord(args) || typeof args.op !== 'string') throw new Refusal(400, '草稿操作要写明 op')
  if (args.op === 'save') {
    if (!isRecord(args.form)) throw new Refusal(400, '保存草稿要把字段放在 form 里')
    const saved = await drafts.save({
      ...(typeof args.draftId === 'string' ? { draftId: args.draftId } : {}),
      target: { kind: 'record', ...(typeof args.recordId === 'string' ? { recordId: args.recordId } : {}) },
      base: {},
      form: { record: args.form },
    })
    return { draftId: saved.draftId, updatedAt: saved.updatedAt }
  }
  if (typeof args.draftId !== 'string') throw new Refusal(400, `${args.op} 要写明 draftId`)
  if (args.op === 'load') {
    const draft = await drafts.get(args.draftId)
    if (draft === undefined) return { draft: null }
    return {
      draft: {
        draftId: draft.draftId,
        updatedAt: draft.updatedAt,
        ...(draft.target.kind === 'record' && draft.target.recordId !== undefined ? { recordId: draft.target.recordId } : {}),
        form: draft.form?.record ?? null,
      },
    }
  }
  if (args.op === 'remove') {
    return { removed: await drafts.remove(args.draftId) }
  }
  throw new Refusal(400, `不认识的草稿操作：${args.op}`)
}

/**
 * 读能力 `records.read`。
 *
 * @param store - 记录存储。
 * @returns 能力注册项。
 */
function readCapability(store: RecordsStore): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: RECORDS_PROVIDER,
    id: RECORDS_READ_CAPABILITY,
    title: { zh: '读领域记录', en: 'Read domain records' },
    description: {
      zh: '按类型、id 与归档或回收站状态读记录；默认只给活跃记录。',
      en: 'Reads records by kind, ids and archive or trash state; active records only by default.',
    },
    input: READ_INPUT,
    call(_instance, args) {
      return readOf(store, args)
    },
  }
}

/**
 * 写能力 `records.write`。
 *
 * @param store - 记录存储。
 * @returns 能力注册项。
 */
function writeCapability(store: RecordsStore): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: RECORDS_PROVIDER,
    id: RECORDS_WRITE_CAPABILITY,
    title: { zh: '写领域记录', en: 'Write domain records' },
    description: {
      zh: '新建、更新、归档、恢复或移入回收站；更新带 expectedRevision，过期回 409 与当前记录。',
      en: 'Creates, updates, archives, restores or trashes a record; updates carry expectedRevision and a stale one gets 409 with the current record.',
    },
    input: WRITE_INPUT,
    async call(instance, args) {
      return await writeOf(store, instance, args)
    },
  }
}

/**
 * 草稿能力 `records.draft`。
 *
 * @param drafts - 草稿存储。
 * @returns 能力注册项。
 */
function draftCapability(drafts: DraftStore): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: RECORDS_PROVIDER,
    id: RECORDS_DRAFT_CAPABILITY,
    title: { zh: '记录编辑草稿', en: 'Record edit draft' },
    description: {
      zh: '把还没保存的记录字段存成草稿；保存成功或放弃后删除。',
      en: 'Stores unsaved record fields as a draft; remove it after saving or discarding.',
    },
    input: DRAFT_INPUT,
    async call(_instance, args) {
      return await draftOf(drafts, args)
    },
  }
}

/**
 * 数据源 `records`：按卡片的 props.kind 给活跃记录，任一记录变化时重推。
 *
 * 归档与回收站不在这里推：那些视图需要时走 `records.read`，免得每张卡一直拿着整份回收站。
 *
 * @param store - 记录存储。
 * @returns 数据源注册项。
 */
export function recordsSource(store: RecordsStore): DataSourceRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: RECORDS_PROVIDER,
    id: RECORDS_SOURCE,
    read(instance) {
      return store.view({ kind: kindOf(instance) })
    },
    subscribe(instance, emit) {
      const kind = kindOf(instance)
      const push = (): void => { emit(store.view({ kind })) }
      push()
      return store.onChange(push)
    },
  }
}

/**
 * 把记录的能力与数据源注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param store - 记录存储。
 * @param drafts - 草稿存储。
 * @returns 撤下这次注册的函数。
 */
export function registerRecords(sources: Registries, store: RecordsStore, drafts: DraftStore): () => void {
  const disposers = [
    sources.registerCapability(readCapability(store)),
    sources.registerCapability(writeCapability(store)),
    sources.registerCapability(draftCapability(drafts)),
    sources.registerDataSource(recordsSource(store)),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
