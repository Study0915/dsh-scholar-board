/**
 * 第一次启动的三块看板（D17）：精选的「我的看板」、面向科研日常的「学术看板」与按类别排开的「组件画廊」。
 *
 * 清单只写在这个文件里：「我的看板」逐张写明组件、位置与内容，宽屏四列时第一屏放得下，它也是看板
 * 被删光后补上的那一块（D21）；「学术看板」组合现有组件给出文献、组会与项目的空态骨架，不虚构日期与
 * 里程碑；画廊把每个内置组件各铺一张，按类别分行，同一行的卡片同高。清单里的组件不在内置组件库里时
 * 抛出，不静默少铺（D11）。
 */
import type { Arrangement, Board, BoardInstance, CardLayout } from '@dsh-scholar-board/contracts'
import { POSITION_STEP_REM } from '@dsh-scholar-board/model'
import type { WidgetRecord } from './library'
import { defaultBoxOf, emptyBoard, instanceOf, withGroupAdded } from './state'

/** 精选看板的标题。 */
export const MY_BOARD_TITLE = '我的看板'

/** 学术看板的标题。 */
export const SCHOLAR_BOARD_TITLE = '学术看板'

/** 画廊看板的标题。 */
export const GALLERY_BOARD_TITLE = '组件画廊'

/**
 * 一张卡写进看板时带的内容；没写的项保持组件自己的默认。
 *
 * `source` 只在要改绑定时写：省略表示沿用组件声明的默认数据源，空串表示显式解绑——卡片只有种子
 * 写进去的那份内容，不去读、也不订阅任何源。
 */
interface CardContent {
  props?: Record<string, unknown>
  data?: unknown
  source?: string
}

/** 精选看板上的一个位置：一张卡，或一组正反两面的翻面卡（D19）；组卡的两面可各写一份内容。 */
type MyBoardEntry =
  | ({ widget: string, layout: CardLayout } & CardContent)
  | { group: { front: string, back: string }, layout: CardLayout, frontContent?: CardContent, backContent?: CardContent }

/**
 * 「我的看板」：第一行三张，第二行三张，日历组与余额卡占第三行；第四列的热力图排在清单最后。
 *
 * 看板按容器宽度在一到四列之间取列数，1440 宽的窗口加侧栏只有三列：第四列的卡片放在清单最后，
 * 三列时它们按 D16 的规则落到第三列的底部，前面的卡片不被推乱；四列时热力图上补第一行右端。
 * 行高第一行 18rem，第二行 14rem，第三行 22rem，纵向位置是上一行的 y 加高度再留 2rem。
 *
 * 日历组占第三行左侧两列：正面月历要这么高才写得下农历行，背面今日运势分到同一个盒子。
 */
const MY_BOARD: readonly MyBoardEntry[] = [
  { widget: 'board-hero', layout: { x: 0, y: 0, w: 2, h: 18 } },
  { widget: 'weather', layout: { x: 2, y: 0, w: 1, h: 18 } },
  { widget: 'pomodoro', layout: { x: 0, y: 20, w: 1, h: 14 } },
  { widget: 'todo', layout: { x: 1, y: 20, w: 1, h: 14 } },
  { widget: 'clock', layout: { x: 2, y: 20, w: 1, h: 14 } },
  { group: { front: 'calendar', back: 'fortune' }, layout: { x: 0, y: 36, w: 2, h: 22 } },
  { widget: 'dsh-balance', layout: { x: 2, y: 36, w: 1, h: 22 } },
  { widget: 'heatmap', layout: { x: 3, y: 0, w: 1, h: 18 } },
]

/**
 * 「学术看板」：三列四行，行高 22、22、22、18、22rem 里依次排开，行间留 2rem。
 *
 * 第一行组会汇报组卡（正面要点、翻面笔记）加投稿倒数；第二行日历、学术入口与待办；第三行项目里程碑
 * 与阅读清单；第四行文献追踪占满三列——它一行一篇，宽一些才写得下标题、作者与日期。倒数不写日期、
 * 里程碑与清单留空条目：种子只搭骨架，真实的截止日期与进展由用户自己填，不虚构事实。导航里的地址
 * 都是公开站点，不含任何个人信息。
 *
 * 五个写了内容的实例（组卡两面、学术入口、里程碑、阅读清单）都把数据源显式解绑：它们画的是清单里
 * 这份内容，交给 `repo.links`、`git.log`、`sessions.list` 或一份仓库文档去填会换成别的东西。文献追踪
 * 不写 `source`，接上组件自己的 `http` 源按默认分类读 arXiv；其余卡片同样照旧接默认源。
 */
const SCHOLAR_BOARD: readonly MyBoardEntry[] = [
  {
    group: { front: 'markdown', back: 'markdown' },
    layout: { x: 0, y: 0, w: 2, h: 22 },
    frontContent: {
      source: '',
      props: { title: '组会汇报 · 要点', kicker: '本周' },
      data: { markdown: '## 本周进展\n\n- （进展一）\n\n## 下周计划\n\n- （计划一）\n\n## 需要讨论\n\n- （问题一）\n' },
    },
    backContent: {
      source: '',
      props: { title: '组会汇报 · 笔记', kicker: '翻面' },
      data: { markdown: '## 讨论记录\n\n- （记录要点）\n\n## 文献与链接\n\n- （标题 + 链接）\n' },
    },
  },
  { widget: 'countdown', layout: { x: 2, y: 0, w: 1, h: 22 }, props: { name: '下一投稿截止', note: '在卡片设置里填一个真实的目标日期' } },
  { widget: 'calendar', layout: { x: 0, y: 24, w: 1, h: 22 } },
  {
    widget: 'links',
    layout: { x: 1, y: 24, w: 1, h: 22 },
    source: '',
    props: { title: '学术入口', kicker: '导航' },
    data: {
      items: [
        { title: 'arXiv', url: 'https://arxiv.org', note: '预印本主站' },
        { title: 'arXiv · eess.SP', url: 'https://arxiv.org/list/eess.SP/recent', note: '信号处理新稿' },
        { title: 'arXiv · physics.optics', url: 'https://arxiv.org/list/physics.optics/recent', note: '光学新稿' },
        { title: 'Optica Publishing', url: 'https://opg.optica.org', note: 'Optica 期刊主页' },
        { title: 'IEEE Xplore', url: 'https://ieeexplore.ieee.org', note: '电气电子文献' },
      ],
    },
  },
  { widget: 'todo', layout: { x: 2, y: 24, w: 1, h: 22 } },
  { widget: 'timeline', layout: { x: 0, y: 48, w: 2, h: 18 }, source: '', props: { title: '项目里程碑', kicker: '科研 · 横向' }, data: { items: [] } },
  { widget: 'list', layout: { x: 2, y: 48, w: 1, h: 18 }, source: '', props: { title: '文献阅读清单', kicker: '本周' }, data: { items: [] } },
  { widget: 'paper-feed', layout: { x: 0, y: 68, w: 3, h: 22 } },
]

/** 画廊按三列排：1440 宽的窗口加侧栏只有三列，更宽时右边留空，也比三列窗口里卡片被推乱好。 */
const GALLERY_COLUMNS = 3

/** 画廊的类别，按显示的先后；每个类别里的组件也按这里的先后，相邻的几个正好排满一行。 */
const GALLERY_CATEGORIES: readonly { title: string, widgets: readonly string[] }[] = [
  { title: '数据展示', widgets: ['stat', 'gauge', 'progress', 'chart', 'heatmap', 'session-usage', 'table', 'kv', 'list', 'timeline', 'image', 'markdown', 'json', 'diff', 'dsh-balance', 'github-issues', 'paper-feed', 'meeting-records', 'action-items'] },
  { title: '工具', widgets: ['board-hero', 'clock', 'calendar', 'fortune', 'year-progress', 'weather', 'pomodoro', 'todo', 'links', 'countdown', 'light-switch'] },
  { title: '动效模板', widgets: ['flip-card', 'holographic-card', 'magnetic-card'] },
]

/** 没有列进任何类别的内置组件放在最后，按 id 排。 */
const OTHER_CATEGORY = '其他'

/**
 * 画廊里需要写入内容的卡：这两个组件没有数据时画的是一份自带的样例，样例里有像故障的状态。
 * 表格与键值的行来自 data，所以写 data。
 */
const GALLERY_CONTENT: Readonly<Record<string, CardContent>> = {
  table: {
    data: {
      columns: [
        { key: 'name', label: '服务' },
        { key: 'state', label: '状态' },
        { key: 'latency', label: '延迟', align: 'right' },
      ],
      rows: [
        { name: '宿主', state: '在线', latency: '12 ms' },
        { name: '组件库', state: '在线', latency: '4 ms' },
        { name: '事件推送', state: '在线', latency: '8 ms' },
        { name: '数据源', state: '就绪', latency: '21 ms' },
      ],
    },
  },
  kv: {
    data: {
      items: [
        { key: '插件', value: 'dsh-scholar-board', note: '组件看板' },
        { key: '宿主', value: 'DeepSeek Harness' },
        { key: '看板', value: 3, note: '我的看板 · 学术看板 · 组件画廊' },
        { key: '来源', value: '内置 · 用户 · 插件' },
      ],
    },
  },
}

/** 画廊里相邻两行之间留的纵向空隙，落在 2rem 的位置档上（D16）。 */
const ROW_GAP_REM = POSITION_STEP_REM

/**
 * 取内置组件的记录。
 *
 * @param records - 已校验的组件。
 * @param id - 组件 id。
 * @returns 记录。
 * @throws {Error} 内置组件库里没有这个组件。
 */
function builtinRecord(records: Map<string, WidgetRecord>, id: string): WidgetRecord {
  const record = records.get(id)
  if (record === undefined || record.source !== 'builtin') {
    throw new Error(`默认看板的清单里有内置组件 ${id}，但内置组件库里没有它（D17）`)
  }
  return record
}

/**
 * 一张带内容的卡。
 *
 * @param record - 组件记录。
 * @param layout - 卡片的盒子。
 * @param content - 要写入的 props、数据与数据源。
 * @returns 卡片。
 */
function cardOf(record: WidgetRecord, layout: CardLayout, content: CardContent): BoardInstance {
  // 清单点名了数据源就按它建卡：空串是显式解绑，`??` 只在没写时才回落到组件的默认源。
  const source = content.source ?? record.manifest.source
  const instance = instanceOf(record, [], {
    ...(source === undefined ? {} : { source }),
    ...(content.props === undefined ? {} : { props: content.props }),
    layout,
  })
  return content.data === undefined ? instance : { ...instance, data: content.data }
}

/**
 * 一串实例的整齐偏好（D33）：清单的次序就是第一屏的阅读顺序，期望盒子取实例写下的大小。
 *
 * 组卡占一格，单元 id 是正面那张实例的 id；与运行时 `arrangementUnitsOf` 的同一条规则在这里按
 * 构造顺序直接算出来，种子不需要先落盘再读一遍。
 *
 * @param instances - 按阅读顺序铺好的实例。
 * @returns 整齐模式的偏好。
 */
function alignedArrangementOf(instances: readonly BoardInstance[]): Arrangement {
  const order: string[] = []
  const boxes: Record<string, { w: number, h: number }> = {}
  for (const instance of instances) {
    const id = instance.group === undefined || instance.group.side === 'front' ? instance.id : undefined
    if (id === undefined || order.includes(id)) continue
    order.push(id)
    boxes[id] = { w: instance.layout.w, h: instance.layout.h }
  }
  return { mode: 'aligned', aligned: { order, boxes } }
}

/**
 * 给组卡的一面贴上清单写的内容；没写的项保持 instanceOf 给出的默认。
 *
 * 两面各贴一份：一面的 `source` 不牵动另一面。空串要能传下去，所以按「有没有写」判断，不看真假值。
 */
function withContent(instance: BoardInstance, content: CardContent = {}): BoardInstance {
  return {
    ...instance,
    ...(content.source === undefined ? {} : { source: content.source }),
    ...(content.props === undefined ? {} : { props: content.props }),
    ...(content.data === undefined ? {} : { data: content.data }),
  }
}

/**
 * 按清单铺一块看板：单卡走 cardOf，组卡先建组再给两面贴内容。
 *
 * @param title - 看板标题。
 * @param records - 已校验的组件。
 * @param entries - 按阅读顺序写好的清单。
 * @returns 看板。
 */
function boardOf(title: string, records: Map<string, WidgetRecord>, entries: readonly MyBoardEntry[]): Board {
  const instances: BoardInstance[] = []
  for (const entry of entries) {
    if ('group' in entry) {
      const front = builtinRecord(records, entry.group.front)
      const back = builtinRecord(records, entry.group.back)
      const [frontInstance, backInstance] = withGroupAdded(emptyBoard(title), front, back, { layout: entry.layout }).board.instances as [BoardInstance, BoardInstance]
      instances.push(withContent(frontInstance, entry.frontContent), withContent(backInstance, entry.backContent))
    } else {
      instances.push(cardOf(builtinRecord(records, entry.widget), entry.layout, entry))
    }
  }
  return { ...emptyBoard(title), instances, arrangement: alignedArrangementOf(instances) }
}

/**
 * 精选看板。
 *
 * @param records - 已校验的组件。
 * @returns 看板。
 */
function myBoard(records: Map<string, WidgetRecord>): Board {
  return boardOf(MY_BOARD_TITLE, records, MY_BOARD)
}

/**
 * 学术看板。
 *
 * @param records - 已校验的组件。
 * @returns 看板。
 */
function scholarBoard(records: Map<string, WidgetRecord>): Board {
  return boardOf(SCHOLAR_BOARD_TITLE, records, SCHOLAR_BOARD)
}

/**
 * 画廊看板：每个类别从新的一行开始，卡片按默认宽度排满三列再换行，同一行的卡片取这一行里最高的一档。
 *
 * @param records - 已校验的组件。
 * @returns 看板。
 */
function galleryBoard(records: Map<string, WidgetRecord>): Board {
  const listed = new Set(GALLERY_CATEGORIES.flatMap((category) => category.widgets))
  const others = [...records.values()]
    .filter((record) => record.source === 'builtin' && !listed.has(record.manifest.id))
    .map((record) => record.manifest.id)
    .sort((left, right) => left.localeCompare(right))
  const categories = others.length === 0 ? GALLERY_CATEGORIES : [...GALLERY_CATEGORIES, { title: OTHER_CATEGORY, widgets: others }]
  const instances: BoardInstance[] = []
  let y = 0
  for (const category of categories) {
    let row: { record: WidgetRecord, x: number, w: number, h: number }[] = []
    let column = 0
    const flush = (): void => {
      if (row.length === 0) return
      const height = Math.max(...row.map((cell) => cell.h))
      for (const cell of row) {
        const id = cell.record.manifest.id
        instances.push(cardOf(cell.record, { x: cell.x, y, w: cell.w, h: height }, GALLERY_CONTENT[id] ?? {}))
      }
      y += height + ROW_GAP_REM
      row = []
      column = 0
    }
    for (const id of category.widgets) {
      const record = builtinRecord(records, id)
      const box = defaultBoxOf(record)
      const w = Math.min(box.w, GALLERY_COLUMNS)
      if (column + w > GALLERY_COLUMNS) flush()
      row.push({ record, x: column, w, h: box.h })
      column += w
    }
    flush()
  }
  return { ...emptyBoard(GALLERY_BOARD_TITLE), instances, arrangement: alignedArrangementOf(instances) }
}

/**
 * 默认看板：第一次启动排第一的「我的看板」。
 *
 * 看板被删光时补上这一块（D21）；只有内置组件会铺卡，用户与插件来源的组件从添加面板加入，
 * 装了插件不该顺带改变别人的看板（D17）。
 *
 * @param records - 已校验的组件。
 * @returns 默认看板。
 * @throws {Error} 清单里的内置组件不在组件库里。
 */
export function defaultBoard(records: Map<string, WidgetRecord>): Board {
  return myBoard(records)
}

/**
 * 第一次启动的看板：默认看板排第一，「学术看板」排第二，「组件画廊」排第三。
 *
 * @param records - 已校验的组件。
 * @returns 三块新看板，按标签的次序。
 * @throws {Error} 清单里的内置组件不在组件库里。
 */
export function seedBoards(records: Map<string, WidgetRecord>): [Board, Board, Board] {
  return [defaultBoard(records), scholarBoard(records), galleryBoard(records)]
}
