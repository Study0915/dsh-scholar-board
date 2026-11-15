/**
 * 实验模板面板（S13）：内置模板与个人 `template` 记录的公开入口。
 *
 * 研究卡与运行卡都用这一份：选模板、预览字段、另存为个人模板、编辑与删除。应用之后由调用方把选中的
 * 字段写进记录，并把返回的快照存进 `template`；面板本身不碰记录字段。
 */
import type {
  BuiltinTemplate,
  RecordWriteResult,
  TemplateField,
  TemplateRecord,
  TemplateSnapshot,
  TemplateValue,
  RecordsView,
} from '@dsh-scholar-board/contracts'
import { BUILTIN_TEMPLATES, TEMPLATE_LIMITS } from '@dsh-scholar-board/contracts'
import type { WidgetHandles } from '@dsh-scholar-board/contracts'

/** 面板建立时由卡片提供的坐标与回调。 */
export interface TemplatePanelOptions {
  container: HTMLElement
  /** 记录里已有的值，按字段显示名索引；预览据此默认保留同名值。 */
  current(): Record<string, string>
  /** 用户确认应用：选中的字段与当时的快照。 */
  onApply(snapshot: TemplateSnapshot, fields: TemplateField[]): void
  /** 是否允许新建、编辑与删除个人模板；运行卡只用应用。 */
  manage?: boolean
}

/** 面板对外的动作。 */
export interface TemplatePanel {
  reload(): Promise<void>
  destroy(): void
}

interface Choice {
  id: string
  title: string
  direction: string
  version: number
  fields: TemplateField[]
  builtin: boolean
  revision: number
}

/**
 * 安装模板面板。
 *
 * @param api - 卡片句柄。
 * @param options - 容器、当前值与回调。
 * @returns 重新读取与卸载。
 */
export function createTemplatePanel(api: WidgetHandles & { readonly lang: string }, options: TemplatePanelOptions): TemplatePanel {
  const zh = api.lang.startsWith('zh')
  const label = (cn: string, en: string): string => zh ? cn : en
  const root = document.createElement('details')
  root.className = 'w-template'
  root.open = false
  const summary = document.createElement('summary')
  summary.textContent = label('实验模板', 'Experiment templates')
  const bar = document.createElement('div')
  bar.className = 'w-template__bar'
  const select = document.createElement('select')
  select.setAttribute('aria-label', label('选择模板', 'Choose a template'))
  const apply = button(label('应用', 'Apply'))
  const copy = button(label('另存为个人模板', 'Save as personal'))
  const edit = button(label('编辑', 'Edit'))
  const remove = button(label('删除', 'Delete'))
  const status = document.createElement('p')
  status.className = 'w-template__status'
  status.setAttribute('role', 'status')
  const dialog = document.createElement('dialog')
  dialog.className = 'w-template__dialog'
  root.append(summary, bar, status)
  bar.append(select, apply)
  if (options.manage === true) bar.append(copy, edit, remove)
  options.container.append(root, dialog)
  let choices: Choice[] = []
  let damaged = false

  /**
   * 一个按钮。
   *
   * @param text - 按钮文字。
   * @returns 按钮。
   */
  function button(text: string): HTMLButtonElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = text
    return element
  }

  /**
   * 一句状态。
   *
   * @param text - 要显示的文字。
   * @param tone - 出错时标红。
   */
  function say(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text
    status.dataset.tone = tone
  }

  /**
   * 选中的模板。
   *
   * @returns 当前选择；列表为空时是 `undefined`。
   */
  function selected(): Choice | undefined {
    return choices.find(choice => choice.id === select.value)
  }

  /**
   * 刷新下拉与按钮。
   */
  function fillSelect(keep?: string): void {
    const value = keep ?? select.value
    select.replaceChildren()
    for (const choice of choices) {
      const option = document.createElement('option')
      option.value = choice.id
      option.textContent = choice.builtin ? choice.title : `${choice.title}${label('（个人）', ' (personal)')}`
      select.append(option)
    }
    if (choices.some(choice => choice.id === value)) select.value = value
    const current = selected()
    const personal = current !== undefined && !current.builtin
    apply.disabled = current === undefined
    copy.disabled = current === undefined
    edit.disabled = !personal || options.manage !== true
    remove.disabled = !personal || options.manage !== true
  }

  /**
   * 读取内置模板与个人模板。
   */
  async function reload(): Promise<void> {
    if (damaged) return
    const builtins: Choice[] = BUILTIN_TEMPLATES.map((template: BuiltinTemplate) => ({
      id: template.id,
      title: template.title,
      direction: template.direction,
      version: template.version,
      fields: template.fields.map(field => ({ ...field })),
      builtin: true,
      revision: 0,
    }))
    try {
      const view = await api.call('widget-board:records.read', { kind: 'template' }) as RecordsView
      const personal = Array.isArray(view?.records) ? (view.records as TemplateRecord[]) : []
      choices = builtins.concat(personal.map(record => ({
        id: record.id,
        title: record.title,
        direction: record.direction,
        version: record.revision,
        fields: record.fields.map(field => ({ ...field })),
        builtin: false,
        revision: record.revision,
      })))
      fillSelect()
      say(label(`共 ${String(choices.length)} 个模板。`, `${String(choices.length)} templates.`))
    } catch (error) {
      damaged = true
      choices = builtins
      fillSelect()
      say(`${label('读取个人模板失败', 'Could not read personal templates')}：${messageOf(error)}`, 'error')
    }
  }

  /**
   * 一份可编辑的副本。
   *
   * @param choice - 来源模板。
   * @returns 字段副本。
   */
  function cloneFields(choice: Choice): TemplateField[] {
    return choice.fields.map((field, index) => ({ ...field, key: field.key === '' ? `field-${String(index + 1)}` : field.key }))
  }

  /**
   * 打开预览：已有同名值的字段默认不选，替换由用户勾选。
   *
   * @param choice - 选中的模板。
   */
  function openPreview(choice: Choice): void {
    const now = options.current()
    const values = document.createElement('div')
    values.className = 'w-template__fields'
    const rows = choice.fields.map((field) => {
      const row = document.createElement('div')
      row.className = 'w-template__field'
      const check = document.createElement('input')
      check.type = 'checkbox'
      check.checked = now[field.label] === undefined
      check.setAttribute('aria-label', label(`应用「${field.label}」`, `Apply "${field.label}"`))
      const text = document.createElement('span')
      const unit = field.unit === undefined ? '' : ` (${field.unit})`
      const hint = field.note ?? field.when ?? ''
      text.textContent = `${field.label}${unit}${hint === '' ? '' : ` — ${hint}`}`
      const input = document.createElement('input')
      input.value = now[field.label] ?? ''
      input.maxLength = TEMPLATE_LIMITS.valueLength
      input.setAttribute('aria-label', field.label)
      input.addEventListener('input', () => { check.checked = true })
      row.append(check, text, input)
      if (now[field.label] !== undefined) {
        const kept = document.createElement('em')
        kept.textContent = label('已填写，默认保留', 'Already filled, kept')
        row.append(kept)
      }
      values.append(row)
      return { field, check, input }
    })
    const empty = document.createElement('p')
    empty.textContent = label('这个模板没有字段。', 'This template has no fields.')
    openDialog(label(`应用模板：${choice.title}`, `Apply template: ${choice.title}`), values.children.length === 0 ? empty : values, label('应用', 'Apply'), () => {
      const picked = rows.filter(row => row.check.checked)
      if (picked.length === 0) {
        say(label('没有选择字段。', 'No fields selected.'), 'error')
        return false
      }
      const snapshot: TemplateSnapshot = {
        id: choice.id,
        version: choice.version,
        values: picked.map((row): TemplateValue => ({ key: row.field.key, label: row.field.label, value: row.input.value.trim() })),
      }
      options.onApply(snapshot, picked.map(row => row.field))
      say(label(`已应用 ${String(picked.length)} 个字段。`, `Applied ${String(picked.length)} fields.`))
      return true
    })
  }

  /**
   * 打开字段编辑器；内置模板只能另存为个人模板。
   *
   * @param source - 来源模板。
   * @param creating - 新建个人模板。
   */
  function openEditor(source: Choice, creating: boolean): void {
    const body = document.createElement('div')
    const name = document.createElement('label')
    name.className = 'w-template__meta'
    name.textContent = label('名称', 'Name')
    const title = document.createElement('input')
    title.value = creating ? `${source.title}${label('（个人）', ' (personal)')}` : source.title
    title.maxLength = 80
    name.append(title)
    const direction = document.createElement('label')
    direction.className = 'w-template__meta'
    direction.textContent = label('方向', 'Direction')
    const directionInput = document.createElement('input')
    directionInput.value = source.direction
    directionInput.maxLength = 80
    direction.append(directionInput)
    const list = document.createElement('div')
    list.className = 'w-template__fields'
    const rows: TemplateField[] = cloneFields(source)
    const add = button(label('添加字段', 'Add field'))
    add.addEventListener('click', () => {
      if (rows.length >= TEMPLATE_LIMITS.fields) return
      rows.push({ key: `field-${String(rows.length + 1)}`, label: '', type: 'text', group: 'input' })
      renderRows()
    })
    body.append(name, direction, list, add)
    renderRows()

    /** 画出字段行。 */
    function renderRows(): void {
      list.replaceChildren()
      rows.forEach((field, index) => {
        const row = document.createElement('div')
        row.className = 'w-template__edit'
        const labelInput = input(field.label, label('显示名', 'Label'), 80)
        labelInput.addEventListener('input', () => { field.label = labelInput.value })
        const type = selectOf(['text', 'number', 'option'], field.type, label('类型', 'Type'))
        type.addEventListener('change', () => { field.type = type.value as TemplateField['type'] })
        const group = selectOf(['input', 'metric'], field.group, label('位置', 'Group'))
        group.addEventListener('change', () => { field.group = group.value as TemplateField['group'] })
        const unit = input(field.unit ?? '', label('单位', 'Unit'), 32)
        unit.addEventListener('input', () => {
          const text = unit.value.trim()
          if (text === '') delete field.unit
          else field.unit = text
        })
        const optionsInput = input((field.options ?? []).join(', '), label('建议选项', 'Suggested options'), 200)
        optionsInput.addEventListener('input', () => {
          const values = optionsInput.value.split(',').map(part => part.trim()).filter(part => part !== '')
          if (values.length === 0) delete field.options
          else field.options = values.slice(0, TEMPLATE_LIMITS.options)
        })
        const when = input(field.when ?? '', label('适用条件', 'When'), TEMPLATE_LIMITS.noteLength)
        when.addEventListener('input', () => {
          const text = when.value.trim()
          if (text === '') delete field.when
          else field.when = text
        })
        const drop = button(label('移除', 'Remove'))
        drop.addEventListener('click', () => {
          rows.splice(index, 1)
          renderRows()
        })
        row.append(labelInput, type, group, unit, optionsInput, when, drop)
        list.append(row)
      })
    }

    /**
     * 一行输入。
     *
     * @param value - 初值。
     * @param hint - 无障碍名称。
     * @param max - 最大长度。
     * @returns 输入框。
     */
    function input(value: string, hint: string, max: number): HTMLInputElement {
      const element = document.createElement('input')
      element.value = value
      element.maxLength = max
      element.setAttribute('aria-label', hint)
      return element
    }

    /**
     * 一个下拉。
     *
     * @param values - 可选值。
     * @param current - 初值。
     * @param hint - 无障碍名称。
     * @returns 下拉。
     */
    function selectOf(values: string[], current: string, hint: string): HTMLSelectElement {
      const element = document.createElement('select')
      element.setAttribute('aria-label', hint)
      for (const value of values) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = value
        element.append(option)
      }
      element.value = current
      return element
    }

    openDialog(creating ? label('新建个人模板', 'New personal template') : label(`编辑模板：${source.title}`, `Edit template: ${source.title}`), body, label('保存', 'Save'), () => {
      const fields = rows.map((field, index) => ({
        ...field,
        key: field.key === '' ? `field-${String(index + 1)}` : field.key,
        label: field.label.trim(),
      })).filter(field => field.label !== '')
      if (title.value.trim() === '' || directionInput.value.trim() === '' || fields.length === 0) {
        say(label('名称、方向与至少一个字段都要填写。', 'Name, direction and at least one field are required.'), 'error')
        return false
      }
      const unique = uniqueKeys(fields)
      void saveTemplate({ id: creating ? undefined : source.id, revision: source.revision, title: title.value.trim(), direction: directionInput.value.trim(), fields: unique })
      return true
    })
  }

  /**
   * 键在本模板里唯一。
   *
   * @param fields - 字段。
   * @returns 改过键的副本。
   */
  function uniqueKeys(fields: TemplateField[]): TemplateField[] {
    const seen = new Set<string>()
    return fields.map((field, index) => {
      let key = field.key
      while (seen.has(key)) key = `field-${String(index + 1)}-${String(seen.size + 1)}`
      seen.add(key)
      return { ...field, key }
    })
  }

  /**
   * 写入一条个人模板。
   *
   * @param form - 模板字段与已有修订。
   */
  async function saveTemplate(form: { id?: string; revision: number; title: string; direction: string; fields: TemplateField[] }): Promise<void> {
    try {
      const record = { kind: 'template', title: form.title, direction: form.direction, fields: form.fields }
      const result = form.id === undefined
        ? await api.call('widget-board:records.write', { op: 'create', record }) as RecordWriteResult
        : await api.call('widget-board:records.write', { op: 'update', id: form.id, expectedRevision: form.revision, patch: record }) as RecordWriteResult
      await reload()
      select.value = result.record.id
      fillSelect(result.record.id)
      say(label('模板已保存。', 'Template saved.'))
    } catch (error) {
      say(`${label('保存模板失败', 'Could not save the template')}：${messageOf(error)}`, 'error')
    }
  }

  /**
   * 删除个人模板；记录里已有的快照不受影响。
   *
   * @param choice - 选中的个人模板。
   */
  async function removeTemplate(choice: Choice): Promise<void> {
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(label(`删除模板「${choice.title}」？已有记录里的快照会保留。`, `Delete template "${choice.title}"? Snapshots in existing records are kept.`))) return
    try {
      await api.call('widget-board:records.write', { op: 'trash', id: choice.id, expectedRevision: choice.revision }) as RecordWriteResult
      await reload()
      say(label('模板已删除。', 'Template deleted.'))
    } catch (error) {
      say(`${label('删除模板失败', 'Could not delete the template')}：${messageOf(error)}`, 'error')
    }
  }

  /**
   * 打开一个带确认按钮的对话框。
   *
   * @param title - 标题。
   * @param body - 内容。
   * @param confirmText - 确认按钮文字。
   * @param accept - 确认时调用；返回 false 保持打开。
   */
  function openDialog(title: string, body: Node, confirmText: string, accept: () => boolean): void {
    dialog.replaceChildren()
    const heading = document.createElement('h3')
    heading.textContent = title
    const close = button(label('关闭', 'Close'))
    close.addEventListener('click', () => { dialog.close() })
    const confirm = button(confirmText)
    confirm.className = 'w-template__confirm'
    confirm.addEventListener('click', () => { if (accept()) dialog.close() })
    const actions = document.createElement('div')
    actions.className = 'w-template__actions'
    actions.append(close, confirm)
    dialog.append(heading, body, actions)
    if (!dialog.open) dialog.showModal()
  }

  /** 错误转成一句话。 */
  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  select.addEventListener('change', () => { fillSelect(select.value) })
  apply.addEventListener('click', () => {
    const choice = selected()
    if (choice !== undefined) openPreview(choice)
  })
  copy.addEventListener('click', () => {
    const choice = selected()
    if (choice !== undefined) openEditor(choice, true)
  })
  edit.addEventListener('click', () => {
    const choice = selected()
    if (choice === undefined || choice.builtin) return
    openEditor(choice, false)
  })
  remove.addEventListener('click', () => {
    const choice = selected()
    if (choice === undefined || choice.builtin) return
    void removeTemplate(choice)
  })

  void reload()
  return {
    reload,
    destroy() {
      damaged = true
      root.remove()
      dialog.remove()
    },
  }
}
