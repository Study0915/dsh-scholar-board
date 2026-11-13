/**
 * 设置页里的「记录备份」一栏（D36）：导出 `.dshrecords`，导入前先预览再确认。
 *
 * 导出与导入各走一条宿主路由；下载由页面自己发起，导入的文件在这边读成字节送上去。导入给每条
 * 记录分配新 id，不覆盖已有记录；失败与容量拒绝原样显示宿主的原因。
 */
import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { t } from './copy'

/** 宿主回的导入预览。 */
interface ImportPreview {
  total: number
  byKind: { meeting: number, action: number, manuscript: number, literature: number }
  active: number
  archived: number
  trashed: number
  bytes: number
}

/** 选好但还没确认的那一份。 */
interface PendingImport {
  name: string
  bytes: ArrayBuffer
  preview: ImportPreview
}

/**
 * 文案里的 `{name}` 替换。
 *
 * @param text - 一条文案。
 * @param values - 占位符的值。
 * @returns 替换之后的文字。
 */
function fill(text: string, values: Record<string, string | number>): string {
  let out = text
  for (const [key, value] of Object.entries(values)) out = out.split(`{${key}}`).join(String(value))
  return out
}

/**
 * 一次失败的响应读成一句原因。
 *
 * @param response - 宿主的响应。
 * @param fallback - 响应不是 JSON 时的说法。
 * @returns 错误。
 */
async function failureOf(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null
  return new Error(typeof body?.error === 'string' && body.error !== '' ? body.error : fallback)
}

/**
 * 记录备份一栏。
 *
 * @returns 设置页里的一节。
 */
export function RecordsExchange(): ReactNode {
  const [includeArchived, setIncludeArchived] = useState(false)
  const [includeTrashed, setIncludeTrashed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportRecords = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    setNotice(null)
    fetch('api/widget-board/records/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeArchived, includeTrashed }),
    }).then(async (response) => {
      if (!response.ok) throw await failureOf(response, t('recordsExporting'))
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'records.dshrecords'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice(fill(t('recordsExportDone'), { name }))
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => { setBusy(false) })
  }, [busy, includeArchived, includeTrashed])

  const chooseFile = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    setBusy(true)
    setFailure(null)
    setNotice(null)
    setPending(null)
    file.arrayBuffer().then(async (bytes) => {
      const response = await fetch('api/widget-board/records/import/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/gzip' },
        body: bytes,
      })
      if (!response.ok) throw await failureOf(response, t('recordsFileError'))
      const preview = await response.json() as ImportPreview
      setPending({ name: file.name, bytes, preview })
    }, () => { throw new Error(t('recordsFileError')) })
      .catch((error: Error) => {
        setFailure(fill(t('recordsImportInvalid'), { reason: error.message }))
        if (fileRef.current !== null) fileRef.current.value = ''
      })
      .finally(() => { setBusy(false) })
  }, [])

  const confirmImport = useCallback((): void => {
    if (busy || pending === null) return
    setBusy(true)
    setFailure(null)
    fetch('api/widget-board/records/import', {
      method: 'POST',
      headers: { 'content-type': 'application/gzip' },
      body: pending.bytes,
    }).then(async (response) => {
      if (!response.ok) throw await failureOf(response, t('recordsImporting'))
      const result = await response.json() as { imported?: unknown }
      const count = typeof result.imported === 'number' ? result.imported : 0
      setNotice(fill(t('recordsImportDone'), { n: count }))
      setPending(null)
      if (fileRef.current !== null) fileRef.current.value = ''
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => { setBusy(false) })
  }, [busy, pending])

  const cancelImport = useCallback((): void => {
    setPending(null)
    if (fileRef.current !== null) fileRef.current.value = ''
  }, [])

  return (
    <section className="dsh-scholar-board__records-backup" data-dsh-scholar-board-records-backup="" aria-label={t('recordsBackup')}>
      <h3 className="dsh-scholar-board__provider-health-title">{t('recordsBackup')}</h3>
      <p className="dsh-scholar-board__board-settings-notice">{t('recordsBackupNote')}</p>
      <div className="dsh-scholar-board__records-backup-actions">
        <label className="dsh-scholar-board__records-backup-check">
          <input type="checkbox" checked={includeArchived} disabled={busy} onChange={(event) => { setIncludeArchived(event.target.checked) }} />
          {t('recordsIncludeArchived')}
        </label>
        <label className="dsh-scholar-board__records-backup-check">
          <input type="checkbox" checked={includeTrashed} disabled={busy} onChange={(event) => { setIncludeTrashed(event.target.checked) }} />
          {t('recordsIncludeTrashed')}
        </label>
        <button type="button" className="dsh-scholar-board__board-settings-action" disabled={busy} onClick={exportRecords}>
          {busy ? t('recordsExporting') : t('recordsExport')}
        </button>
        <label className="dsh-scholar-board__board-settings-action">
          {t('recordsImport')}
          <input ref={fileRef} type="file" accept=".dshrecords,application/gzip" hidden disabled={busy} onChange={chooseFile} />
        </label>
      </div>
      {pending === null
        ? null
        : (
          <div className="dsh-scholar-board__records-backup-preview" data-dsh-scholar-board-records-preview="">
            <p className="dsh-scholar-board__board-settings-notice">
              {fill(t('recordsImportPreview'), {
                total: pending.preview.total,
                meeting: pending.preview.byKind.meeting,
                action: pending.preview.byKind.action,
                manuscript: pending.preview.byKind.manuscript,
                literature: pending.preview.byKind.literature,
                kb: Math.max(1, Math.round(pending.preview.bytes / 1024)),
                active: pending.preview.active,
                archived: pending.preview.archived,
                trashed: pending.preview.trashed,
              })}
            </p>
            <div className="dsh-scholar-board__records-backup-actions">
              <button type="button" className="dsh-scholar-board__board-settings-action" disabled={busy} onClick={confirmImport}>
                {busy ? t('recordsImporting') : t('recordsImportConfirm')}
              </button>
              <button type="button" className="dsh-scholar-board__board-settings-action" disabled={busy} onClick={cancelImport}>
                {t('renameCancel')}
              </button>
            </div>
          </div>
        )}
      {notice === null ? null : <p className="dsh-scholar-board__board-settings-notice" role="status">{notice}</p>}
      {failure === null
        ? null
        : <p className="dsh-scholar-board__board-settings-notice dsh-scholar-board__board-settings-notice--error" role="status">{failure}</p>}
    </section>
  )
}
