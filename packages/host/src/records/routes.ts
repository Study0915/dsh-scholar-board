/**
 * 领域记录的导出与导入路由（D36）：记录与看板布局分开备份。
 *
 * 导出回一个 gzip 的 `.dshrecords`；导入先预览条数与分布，确认之后整包一次写入。三条路由都只做
 * HTTP 适配，格式校验、id 重映射与容量判断在 `exchange.ts` 与记录存储里。
 */
import { isRecord } from '../guards'
import { readBody, readJson } from '../body'
import { Refusal } from '../refusal'
import { json } from '../response'
import type { Route } from '../routes'
import { exportFileName, exportRecords, importRecords, previewRecords } from './exchange'
import type { ExportScope } from './exchange'
import type { RecordsStore } from './store'

/** 导出请求体很小：只有勾选范围。 */
const EXPORT_BODY_LIMIT = 4 * 1024

/** 导入包的上限；解压后的上限在 exchange 里另有一道。 */
export const IMPORT_PACKAGE_LIMIT = 32 * 1024 * 1024

/**
 * 读导出范围：默认只含活跃记录。
 *
 * @param value - 请求体。
 * @returns 归一后的范围。
 */
function scopeOf(value: unknown): ExportScope {
  const body = isRecord(value) ? value : {}
  const kinds = Array.isArray(body.kinds)
    ? body.kinds.filter((kind): kind is 'meeting' | 'action' | 'manuscript' | 'literature' | 'research' | 'thesis' => kind === 'meeting' || kind === 'action' || kind === 'manuscript' || kind === 'literature' || kind === 'research' || kind === 'thesis')
    : undefined
  return {
    includeArchived: body.includeArchived === true,
    includeTrashed: body.includeTrashed === true,
    ...(kinds === undefined || kinds.length === 0 ? {} : { kinds }),
  }
}

/**
 * 记录导出与导入的三条路由。
 *
 * @param store - 记录存储。
 * @returns 路由表。
 */
export function recordsRoutes(store: RecordsStore): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/records\/export$/,
      limit: EXPORT_BODY_LIMIT,
      async handle(_context, request, response) {
        const scope = scopeOf(await readJson(request, EXPORT_BODY_LIMIT))
        const now = Date.now()
        const bytes = exportRecords(store, scope, now)
        response.writeHead(200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${exportFileName(now)}"`,
          'content-length': String(bytes.length),
          'cache-control': 'no-store',
        })
        response.end(bytes)
      },
    },
    {
      method: 'POST',
      pattern: /^\/records\/import\/preview$/,
      limit: IMPORT_PACKAGE_LIMIT,
      async handle(_context, request, response) {
        json(response, 200, previewRecords(await readBody(request, IMPORT_PACKAGE_LIMIT)))
      },
    },
    {
      method: 'POST',
      pattern: /^\/records\/import$/,
      limit: IMPORT_PACKAGE_LIMIT,
      async handle(_context, request, response) {
        const bytes = await readBody(request, IMPORT_PACKAGE_LIMIT)
        if (bytes.length === 0) throw new Refusal(400, '导入请求里没有文件内容')
        json(response, 200, { imported: await importRecords(store, bytes, Date.now()) })
      },
    },
  ]
}
