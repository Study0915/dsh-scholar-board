# 组件编写

组件是看板上的卡片。内置组件、你自己写的、会话里 agent 生成的，都是同一种格式：一个目录，三份文件起步。写完保存，宿主重读组件库，在线页面上的卡片换成新版本。

## 文件

在 `$DSH_HOME/widget-board/widgets/<id>/` 下建一个目录：

```text
widget.json     名字、尺寸、props、数据源、凭据
index.html      画面
style.css       样式，只用运行时套件的令牌
main.js         可选
samples.json    可选，每个尺寸族的样例
scripts         可选，按顺序排在 main.js 之前的额外脚本
styles          可选，接在 style.css 之后的额外样式表
vendor/         可选，随组件发布的第三方库（各自的许可照原样保留）
```

`widget.json` 写名字与尺寸，加 `index.html`、`style.css`，需要脚本时加 `main.js`。组件大到一份样式表放不下时，把 `styles` 列成组件目录里的文件，它们按顺序接在 `style.css` 后面，同一个文档里照常层叠。

## 沙箱

每次运行都在自己的沙箱 iframe 里：严格 CSP，没有网络与 cookie，与宿主只经 MessagePort 桥通信。授权绑在组件内容的哈希上，改一个字节就要重新点一次允许。

组件自己不能导航，也不弹窗。要把链接开出去，用 `widget.open(url)` 交给包着它的页面，写在点击处理里；地址限 `http` 与 `https`。

## 盒子

看板给卡片定尺寸。运行时把内容盒归成两档：`data-box-width` 是 `narrow`、`regular`、`wide`，`data-box-height` 是 `short`、`regular`、`tall`，并给出 `--w-w`、`--w-h`、`--w-cols`。`defaultBox` 是加卡片时的默认盒子，`minBox` 是下限。

## 外观

间距与字号取 `--w-space-*`、`--w-type-*`；状态色取 `--w-tone-ok`、`--w-tone-warn`、`--w-tone-danger`、`--w-tone-idle`，配一行 `.w-sr` 读屏文字。布局原语是 `.w-frame`、`.w-actions`、`.w-scroll`，按档位隐藏用 `.w-hide-short`、`.w-hide-narrow`。

## 动效

翻面、磁吸、全息由运行时套件处理指针与键盘，组件只写画面。最外层加 `.t-flip-card` 与 `data-t-flip`，里面放 `.t-flip-card__inner`，两面各一个 `.t-flip-card__face`，背面再加 `.t-flip-card__back`；磁吸用 `.t-magnetic` 与 `data-t-magnetic`，全息用 `.t-holo` 与 `data-t-holo`。`flip-card`、`magnetic-card`、`holographic-card` 三个内置组件是可复制的示例。

## 数据与调用

`source` 写 `提供方:名字` 时点名插件注册的数据源；数据源声明了 `subscribe` 的，卡片可见时由它持续推数据，其余按 manifest 的 `refresh` 取。要按需再读一个源，把它写进 `sources`，用能力 `widget-board:data.read` 读，读回来的数据不改写卡片。`credentials` 让设置弹窗出现密钥输入框，值由宿主的凭据服务保存，组件读不到。在 manifest 里声明能力后经 `widget.call(id, args)` 调用，参数与结果按 JSON Schema 校验；参数可以整个省略，不声明参数的能力不传也行。握手时还带来 `widget.capabilityMetadata`：每一项能力的标题、说明、参数与结果 schema、权限，以及现在可不可用。内置组件「今日宜休」就是这么拿到的账号：「凭据」里填一个 `GITHUB_TOKEN`，卡上列出自己维护的仓库里还开着的 issue，用户名不用另填；点一行就在新标签页里打开那一条。

要网上的数据就写 `source: "http"` 并在 `request` 里给出地址；地址里的 `{名字}` 在每次读取时换成卡片 props 或 props schema 的默认值，主机必须列进 `permissions.hosts`。默认值里还可以再写 `{别的名字}`，读取时最多展开三层：例如 `query` 的默认值是 `cat:{category}`，旧卡片只存了分类也照旧拼得出查询。返回的 JSON 原样交给卡片。`request.format` 写 `"atom"` 时改读 Atom 接口：宿主把 XML 解析成对象，属性带 `@_` 前缀，`entry`、`author`、`link` 与 `category` 一律是数组；根元素必须是 Atom 命名空间下的 `feed`，带 `DOCTYPE` 的文档拒绝，不写 `format` 时按 JSON 读。内置的「文献追踪」卡按这个方式订阅 arXiv：订阅保存名称、查询条件、来源与分类，一行一篇，点一行打开 abs 页；加入工作台先按 DOI 与 arXiv 主 id 查重，撞上重复时给出双方字段对照，由用户选择保留、补充缺失字段、建立版本关系或仍要加入，批量加入逐条进行并只把需要确认的行留给用户。

记录卡声明 `widget-board:records.read`、`widget-board:records.write`、`widget-board:records.draft` 与 `widget-board:records.open` 后，可用运行时提供的 `widget.createRecordRelations({ container, current, onChange, kinds, title })` 安装统一关联字段：`current()` 返回正在编辑的记录（含 `id`、`kind`，回收站里带 `deletedAt`），`onChange(refs)` 把 `{ kind, id }` 数组交给组件的草稿与保存流程。`kinds` 收窄可选类型（例如只关联文献），`title` 换掉默认的「关联与来源」。返回的 `value()`、`load(refs)`、`refresh()` 与 `dispose()` 负责读取、恢复与释放；选择器自己搜索、筛选和解析来源标题，组件只负责把值写回记录。`records.open` 由看板页接住，目标记录不必先有卡片；组件不在看板页时调用会得到可见的失败说明。

内置的「最近 Token 用量」卡绑定插件注册的 `widget-board:session.usage` 数据源：卡片可见时它先推一份当下的快照，之后每来一条带用量的会话事件再推一份，另有一条 10 秒的节奏；卡片离开视口就停，卡片自己也不计时。改它的 `scope` 会按新窗口退订重订。「今天」与「全部」把 dsh-usage 记下的历史用量与本插件启动之后的事件合在一起，标题旁标出「历史 dsh-usage」；dsh-usage 没装或读不出来时保留实时读数与空态，标成「历史未接入」或「历史不可用」，不拿零值冒充历史。「所选会话」不合并历史，标成「仅实时」。历史只给今天与全部的合计和四项分项，最近一次调用与走势始终来自实时事件：这段时间只有历史用量时，卡片照旧显示总量与分项，不显示最近一次调用。

## 本地图片

在「创建卡片」中选择图片模板，上传不超过 10MiB 的静态 PNG/JPEG/WebP，填写 alt、说明与焦点。宿主会去除元数据并转换为受限 WebP；图片以实例媒体引用保存。组件声明 `widget-board:media.read` 后可用 `await widget.readMedia('background', { signal })` 取得 Blob，创建的对象 URL 由组件在暂停、替换和卸载时释放。

## 提供方

其他插件注册组件、数据源、动作、宿主能力与市场，以及版本与功能清单的约定见 [提供方接口](provider.md)。
