import type { MemberRecord, RecordsView, WidgetHandles } from '@dsh-scholar-board/contracts'

/** 一条记录上的分工字段：负责人一位，协作人与待确认人各一组。 */
export interface MemberAssignment {
  owner?: string
  collaborators?: string[]
  confirmers?: string[]
}

/** 组件里的成员目录：读一次、按 id 认人，分工控件也由这里造。 */
export interface MemberDirectory {
  /** 当前读到的成员，含停用；读取失败时保留上一次。 */
  members(): MemberRecord[]
  /** 读一次目录；停用的成员也在，供旧记录显示当时的称呼。 */
  load(): Promise<MemberRecord[]>
  /** 成员 id 的显示称呼；目录里没有时退回 id。 */
  name(id: string | undefined): string
  /** 把成员填进一个 select；保留选中值，目录里找不到的 id 也显示出来。 */
  fill(select: HTMLSelectElement, selected: string | string[] | undefined, placeholder: string): void
  /** 负责人、协作人与待确认人：写回 entry 并回调。 */
  assign(entry: MemberAssignment, onChange: () => void): HTMLElement
}

/**
 * 安装成员目录。宿主读取只在这里写一次，内置与用户组件共用。
 *
 * @param api - 运行时公开能力。
 * @returns 目录控制器。
 */
export function createMemberDirectory(api: WidgetHandles & { readonly lang: string }): MemberDirectory {
  const zh = api.lang.toLowerCase().startsWith('zh')
  const label = (cn: string, en: string): string => zh ? cn : en
  const cache = new Map<string, MemberRecord>()
  let list: MemberRecord[] = []
  const nameOf = (id: string): string => cache.get(id)?.title ?? id
  const optionText = (member: MemberRecord): string => member.enabled === true ? member.title : member.title + label('（停用）', ' (disabled)')
  const optionsOf = (selected: readonly string[]): HTMLOptionElement[] => {
    const options: HTMLOptionElement[] = []
    for (const member of list) {
      const option = document.createElement('option')
      option.value = member.id
      option.textContent = optionText(member)
      option.selected = selected.includes(member.id)
      options.push(option)
    }
    for (const id of selected) {
      if (cache.has(id)) continue
      const option = document.createElement('option')
      option.value = id
      option.textContent = id
      option.selected = true
      options.push(option)
    }
    return options
  }
  const fieldOf = (text: string, select: HTMLSelectElement): HTMLElement => {
    const field = document.createElement('label')
    field.className = 'w-member-assign__field'
    const span = document.createElement('span')
    span.textContent = text
    field.append(span, select)
    return field
  }
  const multiSelect = (selected: readonly string[], aria: string): HTMLSelectElement => {
    const select = document.createElement('select')
    select.multiple = true
    select.size = 2
    select.className = 'w-member-assign__multi'
    select.setAttribute('aria-label', aria)
    select.append(...optionsOf(selected))
    return select
  }
  const chosen = (select: HTMLSelectElement): string[] => {
    const out: string[] = []
    for (const option of select.selectedOptions) if (option.value !== '') out.push(option.value)
    return out
  }
  const assign = (entry: MemberAssignment, onChange: () => void): HTMLElement => {
    const host = document.createElement('div')
    host.className = 'w-member-assign'
    const owner = document.createElement('select')
    owner.className = 'w-member-assign__single'
    owner.setAttribute('aria-label', label('负责人', 'Owner'))
    owner.append(...optionsOf(entry.owner === undefined ? [] : [entry.owner]))
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = label('未指定负责人', 'No owner')
    owner.prepend(empty)
    owner.value = entry.owner ?? ''
    const collaborators = multiSelect(entry.collaborators ?? [], label('协作人', 'Collaborators'))
    const confirmers = multiSelect(entry.confirmers ?? [], label('待确认人', 'Confirmers'))
    const write = (): void => {
      if (owner.value === '') delete entry.owner
      else entry.owner = owner.value
      const collab = chosen(collaborators)
      if (collab.length === 0) delete entry.collaborators
      else entry.collaborators = collab
      const confirm = chosen(confirmers)
      if (confirm.length === 0) delete entry.confirmers
      else entry.confirmers = confirm
      onChange()
    }
    owner.addEventListener('change', write)
    collaborators.addEventListener('change', write)
    confirmers.addEventListener('change', write)
    host.append(
      fieldOf(label('负责人', 'Owner'), owner),
      fieldOf(label('协作人', 'Collaborators'), collaborators),
      fieldOf(label('待确认人', 'Confirmers'), confirmers),
    )
    return host
  }
  return {
    members: () => list.slice(),
    async load() {
      let offset: number | undefined
      const found: MemberRecord[] = []
      do {
        const view = await api.call('widget-board:records.read', {
          kind: 'member',
          includeArchived: true,
          ...(offset === undefined ? {} : { offset }),
        }) as RecordsView
        if (!view || !Array.isArray(view.records)) throw new Error(label('成员目录响应不完整', 'Incomplete member response'))
        for (const record of view.records) {
          if (record.kind !== 'member') continue
          const member = record as MemberRecord
          cache.set(member.id, member)
          found.push(member)
        }
        offset = view.nextOffset
        if (view.records.length === 0) break
      } while (offset !== undefined)
      found.sort((left, right) => left.title.localeCompare(right.title, zh ? 'zh-CN' : 'en'))
      list = found
      return list.slice()
    },
    name: nameOf,
    fill(select, selected, placeholder) {
      const wanted = selected === undefined ? [] : Array.isArray(selected) ? selected : [selected]
      const options = optionsOf(wanted)
      if (select.multiple) {
        select.replaceChildren(...options)
        return
      }
      const empty = document.createElement('option')
      empty.value = ''
      empty.textContent = placeholder
      select.replaceChildren(empty, ...options)
      select.value = wanted.length > 0 ? wanted[0] : ''
    },
    assign,
  }
}
