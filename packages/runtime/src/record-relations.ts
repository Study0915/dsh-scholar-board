import type { RecordKind, RecordRef, RecordsView, WidgetHandles } from '@dsh-scholar-board/contracts'
import { RELATION_KINDS, RECORDS_LIMITS } from '@dsh-scholar-board/contracts'

/** 编辑器里的关联字段，随原表单一起保存和恢复草稿。 */
export interface RecordRelations {
  value(): RecordRef[]
  load(refs: unknown): void
  refresh(): void
  dispose(): void
}

/** 组件提供自己的节点与编辑上下文，访问仍使用公开能力。 */
export interface RecordRelationsOptions {
  container: HTMLElement
  current(): { id?: string, kind: RecordKind, deletedAt?: string } | null
  onChange(refs: RecordRef[]): void
  /** 只允许选这些记录类型；省略时是所有类型。 */
  kinds?: readonly RecordKind[]
  /** 这一节的标题；省略时是「关联与来源」。 */
  title?: string
}

const names = ['组会', '行动项', '小论文', '文献', '研究', '毕业论文', '项目', '课程', '事务', '课题', '运行', '模板']
const english = ['Meeting', 'Action', 'Manuscript', 'Literature', 'Research', 'Thesis', 'Project', 'Course', 'Chore', 'Topic', 'Run', 'Template']

/**
 * 安装统一关联选择器；所有宿主读取集中在这里，用户组件也可使用。
 *
 * @param api - 运行时公开能力。
 * @param options - 编辑器节点和草稿变更回调。
 * @returns 关联字段控制器。
 */
export function createRecordRelations(api: WidgetHandles & { readonly lang: string }, options: RecordRelationsOptions): RecordRelations {
  const zh = api.lang.toLowerCase().startsWith('zh')
  const label = (cn: string, en: string): string => zh ? cn : en
  const legacy = options.container.querySelector('[data-role="related"]')?.closest('fieldset')
  if (legacy instanceof HTMLElement) legacy.hidden = true
  const host = document.createElement('section')
  const actions = options.container.querySelector('[data-action="save"]')?.parentElement
  if (actions) actions.before(host)
  else options.container.append(host)
  host.classList.add('w-record-relations')
  const title = document.createElement('h3')
  title.textContent = options.title ?? label('关联与来源', 'Relations and sources')
  const selected = document.createElement('ul')
  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = label('搜索关联记录', 'Search records')
  search.setAttribute('aria-label', search.placeholder)
  const kind = document.createElement('select')
  kind.setAttribute('aria-label', label('记录类型', 'Record type'))
  const all = document.createElement('option')
  all.value = ''
  all.textContent = label('全部类型', 'All types')
  kind.append(all)
  const allowed = options.kinds ?? RELATION_KINDS
  for (const id of allowed) {
    const index = RELATION_KINDS.indexOf(id)
    if (index < 0) continue
    const option = document.createElement('option')
    option.value = id
    option.textContent = (zh ? names : english)[index] ?? id
    kind.append(option)
  }
  const filters = document.createElement('div')
  filters.className = 'w-record-relations__filters'
  const find = document.createElement('button')
  find.type = 'button'
  find.textContent = label('查找', 'Find')
  filters.append(search, kind, find)
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  const candidates = document.createElement('ul')
  const more = document.createElement('button')
  more.type = 'button'
  more.textContent = label('读取下一页', 'Load next page')
  more.hidden = true
  const sources = document.createElement('button')
  sources.type = 'button'
  sources.textContent = label('查看本记录与反向引用', 'View this record and incoming links')
  host.append(title, selected, sources, filters, status, candidates, more)
  let refs: RecordRef[] = []
  let nextOffset: number | undefined
  let epoch = 0
  let querySequence = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lifetime = new AbortController()
  const cache = new Map<string, { title: string, archived?: boolean, deletedAt?: string, kind: RecordKind }>()
  const key = (ref: RecordRef): string => `${ref.kind}:${ref.id}`
  const readonly = (): boolean => options.current()?.deletedAt !== undefined
  const fail = (error: unknown): void => { status.textContent = label('读取失败，可重试：', 'Read failed; retry: ') + String(error instanceof Error ? error.message : error) }
  const open = (ref: RecordRef): void => {
    api.call('widget-board:records.open', { kind: ref.kind, id: ref.id }).catch(fail)
  }
  const button = (text: string, click: () => void): HTMLButtonElement => {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = text
    node.addEventListener('click', click)
    return node
  }
  const describe = (ref: RecordRef): string => {
    const record = cache.get(key(ref))
    if (record === undefined) return label('来源缺失', 'Source missing')
    return record.title + (record.deletedAt ? label(' · 回收站', ' · Trash') : record.archived ? label(' · 已归档', ' · Archived') : '')
  }
  const renderSelected = (loading = false): void => {
    selected.replaceChildren()
    for (const ref of refs) {
      const row = document.createElement('li')
      const entry = button(loading ? label('读取来源中…', 'Loading source…') : describe(ref), () => open(ref))
      const remove = button(label('移除关联', 'Remove link'), () => {
        refs = refs.filter(item => key(item) !== key(ref))
        renderSelected()
        options.onChange(refs.slice())
        for (const check of candidates.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
          if (check.dataset.record === key(ref)) check.checked = false
        }
      })
      remove.disabled = readonly()
      row.append(entry, remove)
      selected.append(row)
    }
    sources.hidden = options.current()?.id === undefined
  }
  const read = async (query: object): Promise<RecordsView> => {
    const value = await api.call('widget-board:records.read', query, { signal: lifetime.signal }) as RecordsView
    if (!value || !Array.isArray(value.records) || typeof value.truncated !== 'boolean') throw new Error(label('记录响应不完整', 'Incomplete records response'))
    if (value.truncated && (!Number.isInteger(value.nextOffset) || (value.nextOffset ?? 0) <= 0)) throw new Error(label('记录分页信息缺失', 'Record pagination is missing'))
    for (const record of value.records) cache.set(key(record), record)
    return value
  }
  const resolveSelected = async (): Promise<void> => {
    const currentEpoch = epoch
    renderSelected(true)
    if (refs.length === 0) { renderSelected(); return }
    try {
      const data = await read({ ids: refs.map(ref => ref.id), includeArchived: true, includeTrashed: true })
      if (currentEpoch !== epoch) return
      // 即便所选条数不多，也可能先到消息字节预算；不能把未返回的那一页误报缺失。
      let offset = data.nextOffset
      while (offset !== undefined) {
        const page = await read({ ids: refs.map(ref => ref.id), includeArchived: true, includeTrashed: true, offset })
        if (currentEpoch !== epoch) return
        if (page.nextOffset !== undefined && page.nextOffset <= offset) throw new Error('分页没有前进')
        offset = page.nextOffset
      }
      renderSelected()
    } catch (error) {
      if (currentEpoch !== epoch) return
      selected.replaceChildren()
      const note = document.createElement('li')
      note.textContent = label('来源读取失败，关联仍保留', 'Sources could not be read; links are retained')
      selected.append(note)
      fail(error)
    }
  }
  const lookup = async (offset = 0): Promise<void> => {
    const currentEpoch = epoch
    const sequence = ++querySequence
    status.textContent = label('读取中…', 'Loading…')
    more.hidden = true
    find.disabled = true
    try {
      const data = await read({ search: search.value, ...(kind.value ? { kind: kind.value } : {}), includeArchived: true, offset })
      if (currentEpoch !== epoch || sequence !== querySequence) return
      candidates.replaceChildren()
      const ownId = options.current()?.id
      for (const record of data.records) {
        if (record.id === ownId) continue
        const row = document.createElement('li')
        const check = document.createElement('input')
        check.type = 'checkbox'
        check.dataset.record = key(record)
        check.checked = refs.some(ref => key(ref) === key(record))
        check.disabled = readonly()
        const text = document.createElement('label')
        text.append(check, document.createTextNode(describe(record)))
        check.addEventListener('change', () => {
          if (check.checked && refs.length >= RECORDS_LIMITS.related) {
            check.checked = false
            status.textContent = label('关联数量已达上限', 'Link limit reached')
            return
          }
          refs = refs.filter(ref => key(ref) !== key(record))
          if (check.checked) refs.push({ kind: record.kind, id: record.id })
          renderSelected()
          options.onChange(refs.slice())
        })
        row.append(text, button(label('查看', 'View'), () => open(record)))
        candidates.append(row)
      }
      nextOffset = data.nextOffset
      more.hidden = nextOffset === undefined
      status.textContent = data.records.length ? label('关联随本条记录保存', 'Links save with this record') : label('没有匹配记录', 'No matching records')
    } catch (error) {
      if (currentEpoch === epoch && sequence === querySequence) fail(error)
    } finally {
      if (currentEpoch === epoch && sequence === querySequence) find.disabled = false
    }
  }
  find.addEventListener('click', () => { void resolveSelected(); void lookup() })
  kind.addEventListener('change', () => { void lookup() })
  search.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => { void lookup() }, 250)
  })
  more.addEventListener('click', () => { if (nextOffset !== undefined) void lookup(nextOffset) })
  sources.addEventListener('click', () => {
    const current = options.current()
    if (current?.id) open({ kind: current.kind, id: current.id })
  })
  return {
    value: () => refs.map(ref => ({ ...ref })),
    load(value) {
      epoch += 1
      lifetime.abort()
      lifetime = new AbortController()
      cache.clear()
      const seen = new Set<string>()
      refs = (Array.isArray(value) ? value : []).filter((ref): ref is RecordRef => {
        if (!ref || !RELATION_KINDS.includes(ref.kind) || typeof ref.id !== 'string') return false
        if (!allowed.includes(ref.kind)) return false
        if (seen.has(key(ref))) return false
        seen.add(key(ref))
        return true
      }).map(ref => ({ kind: ref.kind, id: ref.id }))
      candidates.replaceChildren()
      status.textContent = ''
      more.hidden = true
      find.disabled = false
      void resolveSelected()
    },
    refresh: () => { void resolveSelected() },
    dispose() { lifetime.abort(); clearTimeout(timer); host.replaceChildren() },
  }
}
