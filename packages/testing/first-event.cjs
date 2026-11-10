'use strict'
/** 读取宿主以空行分隔的第一帧；一次网络读取可以拆开一帧，也可以合并多帧（D18）。 */
async function firstEventOf(response) {
  if (response.body === null) throw new Error('变更通知没有响应体')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) throw new Error('变更通知在第一帧完成前结束')
      text += decoder.decode(value, { stream: true })
      const end = text.indexOf('\n\n')
      if (end !== -1) return text.slice(0, end).trim()
    }
  } finally {
    await reader.cancel()
  }
}
module.exports = { firstEventOf }
