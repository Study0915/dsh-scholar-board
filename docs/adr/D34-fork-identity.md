# D34. 分叉身份：独立发布与署名义务

## 背景

上游 Nwflower/dsh-widget-board 自 2026-10-17 起无活动，本仓库的四项贡献（上游 PR #11–#14）长期未获回应。维护者决定基于上游 master 与四项贡献的叠加改动，以新名字 dsh-scholar-board 独立发布，并演化为面向通信方向硕博的学术工作台。上游采用 MIT 许可，允许修改与再分发，条件是保留版权与许可声明。

## 决定

- 插件身份是 `dsh-scholar-board`：根包名、`PACKAGE_NAME`、子包 scope `@dsh-scholar-board/*`、cordis 插件行（`ui-scholar-board`）、样式类名与 `data-dsh-scholar-board-*` 语义属性、提供方标识与 user-agent 全部使用新名。代码里不再出现旧名，历史文档（CHANGELOG 已发布段落、ADR 背景引用）除外。
- 分发走 GitHub 直装（`dsh plugin add github:Study0915/dsh-scholar-board`），安装时由 `prepare` 构建；npm 发布留待以后单独决定。
- 署名义务：LICENSE 保留上游版权行并追加维护者版权行；双语 README 顶部声明出处、分叉点与独立维护关系；THIRD_PARTY.md 盘点全部随产物分发的依赖（含构建内联的 devDependencies），逐项写名称、版本、许可证与来源。上游作者编写的示例组件与市场原型 `nwflower.*` 条目保留原作者与原仓库地址，不改名冒领。
- 发布仓库的历史经 mailmap 重写，维护者身份只用 GitHub noreply 邮箱；真实姓名与个人邮箱不进任何公开仓库内容。
- 上游 PR 保持开放；上游若合并贡献，差异手动同步，分叉点记录在 README。

## 后果

- 新插件与上游插件的存储、授权、提供方注册互不相干，可同时安装。
- 皮肤插件定位用的语义属性随新名改变；为旧名写的皮肤不适用于本插件。
- 每次新增随产物分发的依赖，必须同步 THIRD_PARTY.md；构建内联的库按运行时依赖对待，不因写在 devDependencies 而漏报。

## 重审条件

上游恢复活跃并愿意合并贡献时，重审独立发布与回贡的边界；增加 npm 发布时，重审分发渠道那一条。