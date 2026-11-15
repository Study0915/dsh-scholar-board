/**
 * 材料引用的纯函数：网页与本地路径各走各的校验，卡片与宿主读同一份判定。
 *
 * 本地路径只是文本：不解析、不展开、不据此检查磁盘，也不交给 `widget.open` 或 shell。
 * 旧记录只有 `url`，读的时候按网页材料处理。
 */
import type { MaterialKind, MaterialRef } from './records'
import { RECORDS_LIMITS } from './records'
import { isOpenableUrl } from './bridge'

/** 材料的两种来源，顺序与界面一致。 */
export const MATERIAL_KINDS: readonly MaterialKind[] = ['web', 'local']

/**
 * 一条材料是网页还是本地路径。
 *
 * @param material - 材料引用。
 * @returns 显式的 `kind`；未填时按有没有 `url` 判成网页或本地，都没有时按网页处理。
 */
export function materialKindOf(material: Pick<MaterialRef, 'kind' | 'url' | 'path'>): MaterialKind {
  if (material.kind === 'web' || material.kind === 'local') return material.kind
  if (typeof material.path === 'string' && material.path.trim() !== '' && !isOpenableUrl(material.url)) return 'local'
  return 'web'
}

/**
 * 一行本地路径的文本是否可用：非空、去掉首尾空白、不含控制字符、不超过上限。
 *
 * 以协议开头的文本不收：那份材料该记成网页。Windows 盘符、POSIX 与 `~` 开头的路径都按文本接受，
 * 不要求当前设备上真的存在。
 *
 * @param value - 外来值。
 * @returns 可以存成 `path` 时为真。
 */
export function isLocalPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text === '' || text.length > RECORDS_LIMITS.materialPathLength) return false
  if (/[\u0000-\u001F\u007F]/.test(text)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return false
  return true
}

/**
 * 材料引用缺哪些必填内容；空数组表示这一条能存。
 *
 * 网页要能打开的 http/https 地址，本地要一行路径，两者只填一个。
 *
 * @param material - 材料引用。
 * @returns 一句问题说明；没有问题时是 `null`。
 */
export function materialProblem(material: Pick<MaterialRef, 'kind' | 'url' | 'path'>): string | null {
  const kind = materialKindOf(material)
  const hasUrl = material.url !== undefined && material.url !== ''
  const hasPath = material.path !== undefined && material.path.trim() !== ''
  if (kind === 'web') {
    if (hasPath) return '网页材料不要再填本地路径'
    return isOpenableUrl(material.url) ? null : '网页材料要填 http/https 的完整地址'
  }
  if (hasUrl) return '本地材料不要再填网页地址'
  return isLocalPath(material.path) ? null : '本地材料要填一行路径'
}