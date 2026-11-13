# 学术工作台记录契约与操作规格（S00）

状态：设计稿，待用户评审。决策日期 2026-11-10。本文是 [PLAN-scholar.md](PLAN-scholar.md) S00 的产出，字段与状态转换供 S02 起写成回归；交互稿浅深色由用户核对后才算通过。范围见 [产品规划](scholar-product.md)，术语见 [领域术语](scholar-domain.md)，体验口径见 [体验验收](scholar-experience.md)。持久化方向见 D36，宿主权威与修订号沿用 D5，数据源与授权沿用 D6，能力沿用 D24、D32，打开链接沿用 D26。

本文只定义契约，不代表功能已经实现。引用的宿主代码行号是设计时的现状证据，实施时以当时文件为准。

## 已确认的产品决定

2026-11-10 由用户拍板三项，写入本规格后不再隐含：

| 问题 | 决定 |
|---|---|
| 回收站保留与工作区总量 | 回收站 30 天后自动清除；工作区记录上限 10000 条，接近时提醒，到顶阻止新建并提示整理 |
| 用户组件写记录是否要人工授权 | 不需要。记录能力与数据源不声明 permission，与 `widget-board:usage`、`widget-board:data.read` 同类；每次写入记下来源组件便于追查 |
| 首批材料引用地址类型 | 仅 http/https，复用 D26 的 `widget.open`；本地文件路径留到第二批另立规格 |

## 记录身份与生命周期

- 每条记录一个稳定不透明 id（UUID，与卡片实例同生成方式），永不复用。删除卡片不触碰记录；记录独立于任何卡片存在。
- 每条记录带自己的 `revision`，每次成功写入加一。更新必须带 `expectedRevision`，宿主在写入队列内再核一次，过期回 `409 { code: 'stale-revision', revision, record }`（沿用 `content/routes.ts:240` 的形状）。创建不带 expectedRevision。
- `createdAt`、`updatedAt` 由宿主记录，UTC ISO 字符串，组件不可写。`schemaVersion` 标记记录形状版本，首批为 1。
- 每条记录有 `kind`（meeting、action、manuscript、literature）、`archived` 布尔与可选 `deletedAt`。三者组合出生命周期状态：

| 状态 | 判据 | 默认列表 |
|---|---|---|
| 活跃 | `archived=false` 且无 `deletedAt` | 显示 |
| 归档 | `archived=true` 且无 `deletedAt` | 收起，可恢复 |
| 回收站 | 有 `deletedAt` | 只在回收站显示，30 天内可恢复 |
| 已永久删除 | 不在存储中 | 不显示 |

- 归档与回收站都可恢复：恢复清除对应标记，回到先前状态。永久删除仅界面可做，明确范围确认后移除该条，不级联（见关联一节）。

## 字段规格

通用项：所有记录都有 `id`、`kind`、`schemaVersion`、`revision`、`createdAt`、`updatedAt`、`archived`、可选 `deletedAt`、可选 `lastEditedBy`。`lastEditedBy = { widget, instance }` 由宿主在每次写入时填，记来源组件与卡片，组件不可伪造。

容量与空值通则：

- 标题必填，按 Unicode 码点计不超过 200（与 `boardTitleLength` 同一计法）。正文类短文本只受单条字节上限约束。
- 单条记录序列化后不超过 64 KiB（与卡片 state 预算同量级，`limits.ts:9-18`）。
- 可选字段缺席表示「未填」，不用空串冒充有值。可选日期缺席表示「未知」，不伪造倒计时（产品规划行动项一节）。
- 日期与时刻沿用 campus 的两种形状（`packages/model/src/campus` 的 due）：`{ kind: 'date', date: 'YYYY-MM-DD', timeZone }` 表示某一天，按该时区次日零点判逾期；`{ kind: 'instant', at: '<UTC ISO 以 Z 结尾>', timeZone }` 表示一个时刻。夏令时重复时刻要求显式 offset。时区用 IANA 名。

### 组会记录 meeting

| 字段 | 形状 | 必填 | 说明 |
|---|---|---|---|
| title | string ≤200 | 是 | 会议标题 |
| date | `{ kind:'date', date, timeZone }` | 否 | 会议日期，未知留空 |
| topics | string | 否 | 汇报要点，短文本 Markdown |
| feedback | string | 否 | 讨论反馈 |
| openQuestions | string | 否 | 未决问题 |
| related | `Ref[]` | 否 | 关联稿件；课题留到后续批次 |
| materials | `MaterialRef[]` | 否 | 材料引用 |
| derivedFrom | record id | 否 | 从上次记录准备新提纲时保留来源 |

`related` 首批只含 `{ kind: 'manuscript', id }`。会议可同时关联多篇稿件。从反馈创建行动项时，行动项的 `source` 指向本会议 id。

### 行动项 action

| 字段 | 形状 | 必填 | 说明 |
|---|---|---|---|
| title | string ≤200 | 是 | 事项标题 |
| status | 枚举 | 是 | todo、doing、blocked、done、cancelled |
| due | date 或 instant | 否 | 可选期限，无期限不倒计时 |
| source | `{ kind:'meeting'\|'manuscript', id }` | 否 | 生成来源 |
| related | `Ref[]` | 否 | 关联会议与稿件 |
| blockedNote | string | 否 | 阻碍说明 |
| doneNote | string | 否 | 完成说明 |
| materials | `MaterialRef[]` | 否 | 完成时附的结果材料 |

状态中文：待办 todo、进行中 doing、受阻 blocked、完成 done、取消 cancelled。取消、完成与删除是三件事：取消改 status，删除进回收站。完成项可查历史。

### 小论文 manuscript

| 字段 | 形状 | 必填 | 说明 |
|---|---|---|---|
| title | string ≤200 | 是 | 稿件标题 |
| question | string | 否 | 研究问题 |
| stage | 枚举 | 是 | 见下 |
| stageHistory | `{ stage, at, note? }[]` | 是 | 阶段变更历史，宿主维护，可回退 |
| nextStep | string | 否 | 下一步 |
| blockers | string | 否 | 阻碍 |
| target | string | 否 | 目标期刊或会议 |
| due | date 或 instant | 否 | 可选投稿期限 |
| related | `Ref[]` | 否 | 关联会议、行动项；研究记录后续批次 |
| materials | `MaterialRef[]` | 否 | 正文与代码材料 |

阶段枚举：构思 idea、实验 experiment、写作 writing、内审 internal-review、已投稿 submitted、修回 revision、已接收 accepted、归档 archived。阶段可退回，拒稿、撤稿、转投记入 `stageHistory` 的 note。首批不显示完成百分比；通信研究可选检查模板（问题与假设、系统模型等）作为可选字段留到 S04/S05，不强制填写。

### 文献 literature

S05 补齐。文献记录的是「我读到了什么、读懂了什么」，不是订阅条目本身：

| 字段 | 形状 | 必填 | 说明 |
|---|---|---|---|
| title | string ≤200 | 是 | 文献标题 |
| authors | string | 否 | 作者，一行原样记录 |
| venue | string | 否 | 期刊或会议 |
| year | integer 1000–3000 | 否 | 出版年份，未知留空 |
| url | string | 否 | 来源地址，只收 http/https，经 `isOpenableUrl` 校验（D26） |
| stage | 枚举 | 是 | 待读 queued、在读 reading、已理解 understood |
| understanding | string | 否 | 自己的理解，不是订阅摘要 |
| questions | string | 否 | 仍未想清的问题 |
| related | `Ref[]` | 否 | 关联稿件；课题留到后续批次 |
| materials | `MaterialRef[]` | 否 | 笔记、幻灯片或复现代码的链接 |

- 阅读阶段由用户维护；订阅获取、加入工作台与完成阅读是不同事实（领域术语）。从文献追踪卡加入工作台时只带入标题、作者、刊会、年份与来源地址，阶段从待读开始，摘要不写入 `understanding`。
- 同一来源地址的活跃或归档文献视为已在工作台；回收站里的记录不挡重新加入。
- `related` 只含 `{ kind: 'manuscript', id }`。理解与问题是短文本，搜索会一并匹配。

### 材料引用 MaterialRef

材料引用是内嵌在记录里的对象，首批不作为独立存储记录：

| 字段 | 形状 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是 | 记录内局部键，用于列表渲染 |
| url | string | 是 | http/https，经 `isOpenableUrl` 校验（D26） |
| title | string ≤200 | 是 | 链接说明 |
| note | string | 否 | 备注 |

保存引用不表示已复制、备份或读懂材料（领域术语）。材料随所属记录导出为文本，不复制文件（首批仅 http/https）。

### 数组与总量上限

| 项 | 上限 |
|---|---|
| 单条 related | 100 |
| 单条 materials | 64 |
| 单条 stageHistory | 200 |
| 单条序列化字节 | 64 KiB |
| 工作区记录条数 | 10000 |
| 工作区记录总字节 | 16 MiB |

条数与总字节任一先到即视为到顶：到 90% 提醒，到顶阻止新建并提示整理，不静默丢弃。回收站里的记录计入条数与字节，避免靠删除绕过上限。

## 关联与引用

- 关联只存指向方的前向 id，反向引用由宿主现算，不双写。例如行动项的 `source` 存会议 id，会议详情里的「生成的行动项」由扫描 `source==本会议` 得出。单一存储文件让这份推导总是一致。
- 引用失效须可见：被指向的记录不在存储中（含已永久删除）时，引用方保留该 id，界面显示「来源缺失」。删除来源记录不级联删除事项或材料（产品规划行动项一节）。
- 回收站里的来源记录：引用方仍可显示其标题并标注「已在回收站」，恢复后照常。
- 移除卡片不删除记录；重新添加同类卡片仍按 id 找到原记录。组件不得读写其他实例的私有 state，记录是独立的共享存储（D36）。

## 存储与写入

- 新增宿主级存储 `$DSH_HOME/widget-board/records.json`，形状 `{ version: 1, records: Record[] }`。首批整份一份文件：记录高度互链，单文件让关联、反向引用与跨视图一致只需一次原子写入，不留跨文件崩溃窗口。campus 的每卡 state 不动，静态种子与待办继续可用。
- 写入走与看板相同的串行队列＋临时文件改名（`workspace.ts:146-151,196-210`），失败不阻断后续。更新在队列内核 expectedRevision，成功 revision+1、updatedAt 刷新、lastEditedBy 填写。
- 版本迁移沿用 readBoard 模式（`state.ts:312-332`）：读盘认旧 schemaVersion，在内存补齐，下一次保存才写新形状；不合法保留原文件并报错。首批无旧记录可迁，schemaVersion=1。
- 不从自由文本自动推断业务记录；迁移提供预览、用户选择与失败恢复（产品规划记录与材料一节）。
- 重审条件：当记录条数或单份体积使整份写入成为瓶颈时，按 D21 拆成每条一份并维护关联索引，届时重新核定反向引用与跨文件一致性。这条与 D5→D21 的演化同路。

## 草稿与保存反馈

- 记录编辑草稿复用 drafts 存储（`drafts/store.ts`），target 联合新增 `{ kind: 'record', recordId? }`，表单存 `form`。新建草稿无 recordId。沿用 ≤20 份、16 MiB、临时文件改名、目录级串行。
- 保存状态可见：保存中、已保存、失败、冲突分别呈现（体验验收编辑一节）。失败保留草稿，不伪装成功。冲突回 409 时界面保留草稿并给出重载当前记录或继续编辑的选择。
- 关闭未保存内容提示；保存完成后返回原筛选、滚动位置与关联上下文。
- 跨视图一致：写入成功后宿主推 records 数据源订阅者与变更通知，所有卡片与详情按同一份存储更新。

## 归档、回收站与永久删除

- 归档：`archived=true`，从默认列表收起，可恢复。
- 移入回收站：`deletedAt=now`，只在回收站显示，30 天内可恢复。
- 自动清除：读盘与写入时清除 `deletedAt` 早于 30 天的记录。这是已确认的保留期，回收站界面显示条数与「30 天后自动清除」。
- 永久删除：仅界面，明确范围确认后移除该条；不级联删除引用它的记录或材料。能力面不暴露永久删除。
- 到顶（条数或字节）阻止新建，提示先整理回收站或归档。

## 共享访问契约

复用现有能力、数据源与订阅机制，不新增桥消息。提供方沿用看板自己的 `widget-board`（与 `widget-board:usage`、`data.read`、`media.read` 一致，`usage.ts:538`、`data-read.ts`、`index.ts:184`）。

### 能力

| 能力 id | 用途 | 输入要点 | 返回 |
|---|---|---|---|
| `widget-board:records.read` | 读记录 | `{ kind?, ids?, includeArchived?, includeTrashed?, search?, source? }` | `{ records, quota, total, truncated }` |
| `widget-board:records.write` | 写记录 | `{ op, ... }`，op ∈ create、update、archive、restore、trash | `{ record, revision }` |
| `widget-board:records.draft` | 记录编辑草稿 | `{ op, draftId?, recordId?, form? }`，op ∈ save、load、remove | 保存的 `{ draftId, updatedAt }`、读到的 `{ draft }` 或 `{ removed }` |

- 两项都不声明 permission，因此免授权（决定二，D6 无声明即不问人）。调用仍走 `POST /instance/<id>/call` 的既有校验链：组件在库→manifest.capabilities 声明→注册表解析→input 校验→执行→output 校验（`capabilities.ts:61-113`），body ≤64KB，超时与并发沿用提供方上限。
- `records.write` 的 update 必带 expectedRevision；create 不带。op=trash 移入回收站，可恢复；永久删除不在 op 集合里。每次写入宿主填 lastEditedBy。
- 一次读取最多给出 200 条、序列化后约 192 KB（消息上限 320 KB 的一部分），`total` 是筛选后的全部条数，`truncated` 表示只给了一部分；`quota` 带条数、字节与九成提醒。默认只给活跃记录。`source` 用来读「某场会议生成的行动项」这类反向引用，由宿主在查询时现算，不双写。
- 记录编辑草稿复用 `drafts` 存储的 record 目标；`draftId` 由组件保存在卡片实例状态里，跨刷新与重启保留，保存成功、放弃或移入回收站时删除。
- 元数据经 `capability-metadata.ts:78-100` 投影到 init，组件不必先发一次注定失败的调用（D32）。

### 数据源与订阅

- 新增数据源 `widget-board:records`，声明 read 与 subscribe，不声明 permission。卡片以 `source: 'widget-board:records'` 绑定，props 选 kind 与 filter，渲染对应的记录列表。数据源默认只推活跃记录（不含归档与回收站），props.kind 缺省时内置记录组件按自己的 id 取类型；归档与回收站视图由卡片按需走 `records.read`，免得每张卡一直拿着整份回收站。
- read 返回与订阅推送同一形状，按消费组件的 manifest.data 校验（`instance-operations.ts:81-109`）。subscribe 由宿主在任一记录变化时按订阅身份重算并推送；订阅身份含 props（`subscriptions.ts:87-95`），不同卡片各取各的视图。
- 订阅生命周期沿用现状：viewers>0、卡可见、组件在库才订阅，离开即退订（`subscriptions.ts:209-257`）。宿主不代读初值，由 subscribe 自推。

### 内置与用户组件等价

- 内置卡片与用户/市场组件都在 manifest 声明 `capabilities: ['widget-board:records.read','widget-board:records.write']` 或绑定 `source: 'widget-board:records'`，获得同一份访问。沙箱不变（D3），组件经 `widget.call` 与数据源访问，永远碰不到其他实例的私有 state。
- 免授权不等于无约束：input/output schema、字节与条数上限、修订冲突、lastEditedBy 追查都照旧。

## 导出与导入

- 现有 `.dshboard`（format2，`package.ts:154-188`）不变，不自动获得领域记录备份能力（产品规划）。
- 新增独立记录导出格式 `.dshrecords`：gzip JSON，`{ format: 1, exportedAt, scope: { includeArchived, includeTrashed, kinds? }, records: [...] }`。默认只导出活跃记录，归档与回收站由用户勾选。材料是内嵌 URL，随文本导出，不复制文件（决定三）。
- 实现走设置页的「记录备份」一栏与三条宿主路由：`POST /records/export` 回 gzip 文件，`POST /records/import/preview` 回条数、类型与生命周期分布，`POST /records/import` 整包一次写入。导入包按 gzip 读入，解压后超过 64 MiB 拒绝。
- 导入校验 format、schema 与配额；提供预览与用户选择。ID 冲突策略：包内每条记录 id 重映射为新 UUID，并把所有前向引用 id 经同一映射表重写，保留关联（沿用 `board-package.ts:114-130` 的全量重映射思路）；不覆盖无关的已有记录。指向包外且不存在 id 的引用保留为悬空，显示「来源缺失」。
- 可选按内容哈希去重（campus 合并的 duplicateKey 先例，`item-import` merge）；更新保留旧 id 与 createdAt。导入在写入队列内原子提交，核配额与修订，过期 409。
- 导出前明确包含范围；演示、截图、测试与分享用合成资料（产品规划私有材料一节）。

## 材料地址

- 首批仅 http/https，经 `isOpenableUrl` 判定（非空、≤2048 字符、可解析、协议白名单），由 `widget.open(url)` 请宿主开新标签页（D26）。不加 allow-popups，组件零导航能力。
- 不遍历个人磁盘，不自动抓取远地址校验可达性。失效提示分两种：记录引用悬空显示「来源缺失」；外部 URL 原样展示地址与说明，由人判断是否失效， malformed 地址在写入时即拒。
- 本地文件路径、宿主代开本地文件留到第二批，另立路径校验与授权规格。

## 状态转换回归清单

供 S02 起写成回归（字段与状态转换可写成回归是 S00 完成条件之一）：

- 行动项 status：todo↔doing↔blocked；任意→done；任意→cancelled；done/cancelled 可重开→todo。cancelled 与删除（trash）分别处理。
- 稿件 stage：idea→experiment→writing→internal-review→submitted→revision→accepted→archived；允许回退（如 submitted→writing），每次变更追加 stageHistory；archived 可恢复。
- 生命周期：活跃→归档→恢复活跃；活跃/归档→回收站→恢复先前状态；回收站→永久删除（仅界面）或 30 天自动清除。
- 引用：删除来源记录后引用方保留 id 并显示来源缺失；恢复来源后引用复原；移除卡片不影响记录。
- 冲突：两页面并发更新同一记录，后到者带旧 expectedRevision 收 409 与当前记录；草稿保留。
- 容量：到 90% 提醒、到顶阻止新建；回收站计入配额；单条超 64 KiB 拒写。
- 持久化：写入后刷新与重启保留；导出再导入关联完整且不覆盖无关记录。

## 交互稿

端到端路径「新建稿件→写组会要点并关联稿件→记反馈→创建行动项→总览处理→完成附结果材料→回看稿件与会议状态一致」的设计稿随本任务提供，含卡片、详情、编辑、保存反馈、冲突、错误与恢复状态，浅深色可切换。浅深色由用户核对，未核对标 pending（体验验收每项证据第 5 条）。交互要点：

- 常用操作从对应卡片直接进入，新增记录不要求编辑 JSON；列表、摘要、详情用同一名称与状态。
- 编辑保留输入与焦点；保存中/已保存/失败/冲突可见，失败保留草稿；弹窗管理焦点，关闭返回触发处。
- 空态提示下一步；加载、无记录、筛选无结果、读取失败、来源缺失分别呈现。
- 拖动入口与内容按钮互不抢占，提供非拖动操作路径；窄布局保持主要操作可见。

## 未决与重审

- 课题（研究课题）作为关联对象、研究记录、图表目录、投稿轮次与修回逐条回复留到后续批次，首批 related 只含稿件、会议、行动项。
- 本地文件材料、宿主代开与路径校验留到第二批。
- 记录提醒（触发、去重、时区、关页后能力）须独立说明，不承诺系统通知（产品规划行动项一节）。
- 单份存储拆分为每条一份的时机见存储一节重审条件。

## 证据索引

设计时核实的宿主现状（相对 `dsh-widget-board`，实施时以当时文件为准）：

- 存储与串行原子写入：`packages/host/src/workspace.ts:146-151,196-210,237-254`；看板形状与迁移 `packages/host/src/state.ts:104-114,312-332`；预算 `packages/host/src/limits.ts:9-18`。
- 数据源读取与授权：`packages/host/src/instance-operations.ts:81-109`；403 形状 `packages/host/src/permissions.ts:100-114`；授权绑内容哈希 `packages/host/src/grants.ts:142-149`。
- 能力调用链：`packages/host/src/capabilities.ts:61-113`；内置能力先例 `packages/host/src/usage.ts:538`、`packages/host/src/data-read.ts`、`packages/host/src/index.ts:184`；元数据投影 `packages/host/src/capability-metadata.ts:78-100`。
- 订阅：`packages/host/src/subscriptions.ts:87-95,209-257`。
- 结构化记录先例（每卡 state，本文改为共享存储）：`packages/model/src/campus/types.ts:6-26`、日期语义 `packages/model/src/campus/time.ts`。
- 草稿：`packages/host/src/drafts/store.ts`。
- 导入导出与重映射：`packages/host/src/package.ts:154-188`、`packages/host/src/media/board-package.ts:114-130`、`packages/host/src/share.ts:305-373`；campus 合并 `packages/host/src/item-import`。
- 编辑保存冲突：`packages/host/src/content/routes.ts:182-253`。