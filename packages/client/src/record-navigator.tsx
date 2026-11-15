import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { DomainRecord, RecordRef, RecordsView } from '@dsh-scholar-board/contracts'
import { RECORD_KINDS, recordReferences } from '@dsh-scholar-board/contracts'
import { registerClientCapability } from './capabilities'
import { callInstanceCapability } from './snapshot'
import { isChinese } from './copy'

interface Entry { ref: RecordRef, caller: string, scroll: number }
const labels: Record<string, string> = {
  title: '标题', topics: '汇报要点', feedback: '反馈', openQuestions: '未决问题', question: '研究问题',
  goal: '目标', hypothesis: '假设', judgment: '当前判断', text: '内容', actionId: '行动项',
  nextStep: '下一步', blockers: '阻碍', blockedNote: '阻碍说明', doneNote: '完成说明', authors: '作者', venue: '刊会',
  year: '年份', understanding: '个人理解', questions: '问题', environment: '环境', seed: '随机种子', conclusion: '结论',
  summary: '需求摘要', notes: '笔记', note: '说明', category: '类别', teacher: '教师', schedule: '课次', code: '代码 / 课程编号',
  stage: '阶段', status: '状态', method: '做法', date: '日期', due: '期限', url: '来源地址',
  plan: '方案', repository: '仓库', commit: '提交', datasets: '数据集', checkpoints: '检查点', config: '配置',
  evaluation: '评估集合', startedAt: '开始时间', endedAt: '结束时间', failure: '失败原因', artifacts: '产物',
  parameters: '参数', metrics: '指标', chapters: '章节', results: '成果', experiments: '待补实验', milestones: '节点',
  figures: '图表', submissions: '投稿轮次', revisions: '修回意见', tasks: '负责事项', deliverables: '交付物', communications: '沟通', issues: '问题',
  work: '作业与考试', term: '学期', label: '名称', name: '名称', value: '数值', unit: '单位', version: '版本',
  decision: '结果', submittedAt: '投稿日期', decidedAt: '决定日期', change: '改动', materials: '材料', start: '开始', end: '结束',
}

/** 来源中的结构化条目按字段显示，不把参数、图表或章节藏在实现格式里。 */
function RecordValue({ value, zh }: { value: unknown, zh: boolean }): ReactNode {
  if (value === undefined || value === null) return zh ? '未知' : 'Unknown'
  if (Array.isArray(value)) return <ul>{value.map((entry, index) => <li key={index}><RecordValue value={entry} zh={zh} /></li>)}</ul>
  if (typeof value === 'object') return <dl>{Object.entries(value).filter(([key]) => key in labels).map(([key, entry]) =>
    <div key={key}><dt>{zh ? labels[key] : key}</dt><dd><RecordValue value={entry} zh={zh} /></dd></div>)}</dl>
  return String(value)
}

/**
 * 看板页内的记录来源详情；使用发起卡片的公开能力读取，目标无需有卡片。
 *
 * @param props - 插件自己的页面锚点。
 * @returns 详情浮层或空节点。
 */
export function RecordNavigator({ anchor }: { anchor: HTMLElement | null }): ReactNode {
  const [stack, setStack] = useState<Entry[]>([])
  const [record, setRecord] = useState<DomainRecord | null>(null)
  const [outgoing, setOutgoing] = useState<DomainRecord[]>([])
  const [incoming, setIncoming] = useState<DomainRecord[]>([])
  const [offset, setOffset] = useState<number | undefined>()
  const [failure, setFailure] = useState('')
  const [loading, setLoading] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const entry = stack.at(-1)
  const activeEntry = useRef(entry)
  activeEntry.current = entry
  const zh = isChinese()
  const t = (cn: string, en: string): string => zh ? cn : en
  const close = (): void => {
    setStack([])
    previousFocus.current?.focus()
  }
  useEffect(() => registerClientCapability('widget-board:records.open', {
    available: () => true,
    call(call) {
      if (call.preview || call.detached) throw new Error('记录详情需要打开看板页面')
      const value = call.args as Partial<RecordRef> | null
      if (!value || !RECORD_KINDS.includes(value.kind as RecordRef['kind']) || typeof value.id !== 'string' || !value.id || value.id.length > 64
        || Object.keys(value).some(key => key !== 'kind' && key !== 'id')) throw new Error('记录地址不合法')
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setStack([{ ref: { kind: value.kind as RecordRef['kind'], id: value.id }, caller: call.instance.id, scroll: 0 }])
      return { opened: true }
    },
  }), [])
  useLayoutEffect(() => {
    if (!entry || !anchor) return
    const update = (): void => setRect(anchor.getBoundingClientRect())
    update()
    const observer = new ResizeObserver(update)
    observer.observe(anchor)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [entry, anchor])
  useEffect(() => {
    if (!entry) return
    panel.current?.focus()
    const controller = new AbortController()
    let live = true
    const read = async (query: object): Promise<RecordsView> => await callInstanceCapability(entry.caller, 'widget-board:records.read', query, controller.signal) as RecordsView
    setLoading(true)
    setFailure('')
    setRecord(null)
    setOutgoing([])
    setIncoming([])
    setOffset(undefined)
    void (async () => {
      const data = await read({ ids: [entry.ref.id], includeArchived: true, includeTrashed: true })
      if (!live) return
      const found = data.records.find(row => row.id === entry.ref.id && row.kind === entry.ref.kind) ?? null
      setRecord(found)
      if (found) {
        const refs = recordReferences(found)
        const resolved: DomainRecord[] = []
        let cursor: number | undefined = 0
        while (refs.length && cursor !== undefined) {
          const page = await read({ ids: [...new Set(refs.map(ref => ref.id))], includeArchived: true, includeTrashed: true, offset: cursor })
          resolved.push(...page.records)
          if (page.nextOffset !== undefined && page.nextOffset <= cursor) throw new Error('分页没有前进')
          cursor = page.nextOffset
        }
        const back = await read({ references: entry.ref, includeArchived: true, includeTrashed: true })
        if (!live) return
        setOutgoing(resolved)
        setIncoming(back.records)
        setOffset(back.nextOffset)
      }
      if (live) {
        setLoading(false)
        requestAnimationFrame(() => { if (body.current) body.current.scrollTop = entry.scroll })
      }
    })().catch((error: unknown) => {
      if (live) { setFailure(String(error instanceof Error ? error.message : error)); setLoading(false) }
    })
    return () => { live = false; controller.abort() }
  }, [entry, generation])
  if (!entry) return null
  const go = (ref: RecordRef): void => setStack(current => [
    ...current.slice(0, -1), { ...entry, scroll: body.current?.scrollTop ?? 0 }, { ref: { kind: ref.kind, id: ref.id }, caller: entry.caller, scroll: 0 },
  ])
  const badge = (value: DomainRecord): string => value.deletedAt ? t(' · 回收站', ' · Trash') : value.archived ? t(' · 已归档', ' · Archived') : ''
  const row = (ref: RecordRef, value?: DomainRecord): ReactNode => <li key={`${ref.kind}:${ref.id}`}>
    <button type="button" onClick={() => go(ref)}>{value ? `${value.title}${badge(value)}` : t('来源缺失', 'Source missing')}</button>
  </li>
  const box = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : { inset: 0 }
  return <div className="dsh-scholar-board__record-layer" style={box}>
    <div className="dsh-scholar-board__record-backdrop" onClick={close} />
    <div className="dsh-scholar-board__record-panel" role="dialog" aria-modal="true" aria-label={t('记录来源详情', 'Record source details')} tabIndex={-1} ref={panel}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close() }
        if (event.key === 'Tab') {
          const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])]
          const first = nodes[0]
          const last = nodes.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header><strong>{t('记录来源详情', 'Record source details')}</strong><div>
        {stack.length > 1 ? <button type="button" onClick={() => setStack(current => current.slice(0, -1))}>{t('返回', 'Back')}</button> : null}
        <button type="button" onClick={close}>{t('关闭', 'Close')}</button>
      </div></header>
      <div className="dsh-scholar-board__record-body" ref={body}>
        {loading ? <p role="status">{t('读取中…', 'Loading…')}</p> : null}
        {failure ? <p role="alert">{t('读取失败：', 'Read failed: ')}{failure} <button type="button" onClick={() => setGeneration(value => value + 1)}>{t('重试', 'Retry')}</button></p> : null}
        {!loading && !failure && !record ? <p>{t('来源缺失；原关联仍保留。', 'Source missing; the original link is retained.')}</p> : null}
        {record && !failure && !loading ? <>
          <h2>{record.title}{badge(record)}</h2>
          <dl>{Object.entries(record).filter(([key, value]) => key in labels && value !== undefined).map(([key, value]) =>
            <div key={key}><dt>{zh ? labels[key] : key}</dt><dd><RecordValue value={value} zh={zh} /></dd></div>)}</dl>
          {record.materials?.length ? <><h3>{t('材料', 'Materials')}</h3><ul>{record.materials.map(material => <li key={material.id}><a href={material.url} target="_blank" rel="noopener noreferrer">{material.title}</a></li>)}</ul></> : null}
          <h3>{t('关联与来源', 'Relations and sources')}</h3>
          <ul>{recordReferences(record).map(ref => row(ref, outgoing.find(value => value.kind === ref.kind && value.id === ref.id)))}</ul>
          <h3>{t('引用本记录', 'Incoming references')}</h3><ul>{incoming.map(value => row(value, value))}</ul>
          {offset !== undefined ? <button type="button" onClick={() => {
            const current = entry
            void callInstanceCapability(entry.caller, 'widget-board:records.read', { references: entry.ref, includeArchived: true, includeTrashed: true, offset }).then(value => {
              const page = value as RecordsView
              if (current !== activeEntry.current) return
              setIncoming(rows => [...rows, ...page.records.filter(record => !rows.some(row => row.id === record.id))])
              setOffset(page.nextOffset)
            }, error => { if (current === activeEntry.current) setFailure(String(error instanceof Error ? error.message : error)) })
          }}>{t('更多引用', 'More references')}</button> : null}
          <button type="button" onClick={() => setGeneration(value => value + 1)}>{t('重新读取', 'Reload')}</button>
        </> : null}
      </div>
    </div>
  </div>
}
