# dsh-scholar-board

[English](README.en.md) · [在线演示](https://study0915.github.io/dsh-scholar-board/)

DeepSeek Harness 的学术看板插件。一块可拖拽、缩放的卡片看板，加上一组为通信方向硕博准备的科研记录卡：组会、行动项、小论文、文献、研究记录、毕业论文、横向项目、课程与杂事都在同一页，卡片之间互相引用，记录由宿主统一保存。

<p align="center">
  <img src="docs/images/scholar-light.png" alt="浅色下的学术看板：组会汇报、投稿倒数、日历、学术入口、待办、里程碑与文献追踪" width="49%">
  <img src="docs/images/scholar-dark.png" alt="深色下的学术看板" width="49%">
</p>

## 功能

| 卡片 | 记什么 |
|---|---|
| 组会记录 | 汇报要点、讨论反馈、未决问题与材料；反馈可生成行动项并保留来源，新组会可从上次会议准备，提纲可复制为 Markdown |
| 行动项 | 状态、可选期限、阻碍与完成说明；按近期、逾期、无期限与受阻筛选，完成项留档 |
| 小论文 | 研究问题、阶段与阶段历史、下一步、阻碍、目标刊会与投稿期限；图表目录、逐轮投稿与修回事项让反馈追到改动与证据 |
| 文献阅读 | 待读、在读、已理解三档，记作者、刊会、年份、来源地址与自己的理解；订阅摘要不会自动变成理解 |
| 研究记录 | 推导、仿真、实验的研究问题、环境、随机种子、参数与指标（带单位）、结论与结果材料 |
| 毕业论文 | 章节进度、成果来源、待补实验与学位节点；成果只记来源记录 id，来源缺失直接标出 |
| 横向项目 | 需求摘要、个人负责事项、交付物版本、沟通结论、验收节点与待确认问题；默认模板不收合同金额、报价与付款节点 |
| 课程 | 按学期分组的课程、作业考试与学习笔记；近期事项把各门课未完成、有日期的作业考试按日期排在一起 |
| 其他事务 | 用自定义类别整理课程与论文之外的杂事，按期限查看，可筛逾期、七天内与无期限，完成后归档 |
| 科研总览 | 近期行动项、最近组会与活跃稿件放在一页；行动项可就地完成，来源会议可以就地展开 |

另有 **文献追踪** 卡：按 arXiv 分类订阅新稿，一行一篇，标题、作者、提交日期与一行摘要；点一行打开 abs 页，点「加入工作台」把它变成一条待读文献。

## 记录怎么工作

- 记录由宿主共享保存。同一份记录可以出现在多张卡片和多个视图里，移除卡片不删除记录。
- 列表可搜索，按活跃、归档与回收站切换；回收站里的记录三十天后自动清除。
- 详情就地编辑，输入时自动存草稿；保存失败保留输入，修订冲突可以载入最新记录。
- 跨卡片关联只存前向引用，来源缺失会直接标出，不补写结论。
- 设置页的「记录备份」导出 `.dshrecords`；导入前预览条数，每条记录分配新 id，包内关联保留，已有记录不覆盖。

<p align="center">
  <img src="docs/images/records-light.png" alt="浅色下的科研记录看板：组会记录、文献阅读、行动项、小论文、研究记录与科研总览" width="49%">
  <img src="docs/images/records-study-light.png" alt="浅色下的学业与项目看板：毕业论文、横向项目、课程与其他事务" width="49%">
</p>

## 看板本身

- 多块看板标签，卡片自由拖动、缩放与整理；第一次打开时已铺好「学术看板」：组会汇报的翻面组卡、投稿倒数、日历、学术入口、待办、项目里程碑、文献阅读清单，以及按 arXiv 分类订阅的文献追踪。
- 组件库从底部上拉，内置组件与你自己写的组件同一种格式：`widget.json`、`index.html`、`style.css`，需要脚本时加 `main.js`。
- 组件运行在独立沙箱 iframe 里：严格 CSP，没有网络与 cookie，与宿主只经 MessagePort 通信；授权绑在组件内容的哈希上，改一个字节就要重新允许。
- 源码编辑按需加载 CodeMirror，支持草稿与真实沙箱预览；更新全部实例前需要明确选择并核对版本。
- 会话里的 agent 可以列出组件、写组件、放卡、推数据；`widget_show` 能在回答里当场画一张。默认只露出 `widget_catalog`，其余工具经它的 `expose` 点名后出现。
- 其他插件可以注册组件、数据源、动作、宿主能力与市场。

细节见 [组件编写](docs/widgets.md) 与 [提供方接口](docs/provider.md)。

<p align="center">
  <img src="docs/images/board-light.png" alt="浅色下的组件画廊" width="88%">
</p>

## 安装

需要 Node 22 或更高、dsh 0.2.1-rc.1 或更高。

```sh
dsh plugin --profile web add github:Study0915/dsh-scholar-board
```

`web` 换成你启动的 profile。pnpm 拦下依赖的构建脚本时，按它提示的 `allowBuilds` 允许后重试；仓库里不带 `lib/`，从 GitHub 安装时包会在安装时自己构建一次。

从本仓库开发：

```sh
npm install
npm run build
dsh plugin --profile web add .
```

## 开发

```sh
npm install
npm run verify   # lint、ADR 与 CHANGELOG 检查、类型与构建、单元测试、真实宿主冒烟、尺寸矩阵
```

产品范围见 [产品规划](docs/scholar-product.md)，任务与完成条件见 [实施计划](docs/PLAN-scholar.md)，结构与跨模块不变量见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 状态

S00–S08 已按计划完成，组会 → 行动项 → 小论文 → 科研总览的主路径可用。范围不含多人协作、云同步、长文编辑器与实验执行。旧版校园事务卡继续可用，支持 CSV/ICS 导入导出与看板内提醒。

## 许可与致谢

MIT。本项目基于 [Nwflower/dsh-widget-board](https://github.com/Nwflower/dsh-widget-board)（MIT，Copyright (c) 2026 Nwflower）二次开发，由 Study0915 独立维护，与上游无从属关系；分叉点为上游 master 与上游 PR #11–#14 的叠加改动（2026-11-04 快照）。上游项目与全部第三方依赖的版权、许可声明见 [LICENSE](LICENSE) 与 [THIRD_PARTY.md](THIRD_PARTY.md)；内置示例组件与市场原型中的 `nwflower.*` 组件由 Nwflower 编写，按 MIT 保留署名。
