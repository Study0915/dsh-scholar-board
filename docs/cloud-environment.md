# 云端开发环境（QoderWake）

本文件说明如何在 QoderWake 的 Ubuntu/Debian 云电脑上准备、验证和开发本仓库。云端只读取仓库内文档；工作区的交接文件不随仓库发布。开工前先读 [AGENTS.md](../AGENTS.md)、[ARCHITECTURE.md](../ARCHITECTURE.md) 和 [docs/PLAN-scholar.md](PLAN-scholar.md)。

## 前提

- 已开通并绑定一台 Linux 云电脑，具备 root 或免密 sudo。
- 云电脑能访问 npm registry、GitHub 和浏览器下载源；受限网络可设置 `NPM_REGISTRY` 或事先装好 Chrome。
- 使用 `Study0915` 的 GitHub 身份提交；作者和提交者邮箱使用 GitHub noreply 地址。
- 只向 `Study0915/dsh-scholar-board` 推送和提 PR；上游 `Nwflower/dsh-widget-board` 与 npm 发布不在当前授权内。

## 一键初始化

在仓库根目录执行：

```bash
bash scripts/cloud-bootstrap.sh
source .debug/cloud-env.sh
```

脚本会：

- 安装基础工具、Node 24（已有则跳过）、`npm ci` 依赖、用户级 `pnpm@11` 和 `@deepseek-ai/dsh@0.2.1-rc.1`；
- 检测或安装 Chrome/Chromium、中文字体、GitHub CLI；
- 设置仓库局部 Git 身份 `Study0915` + GitHub noreply 地址；
- 把 `core.hooksPath` 指向 [scripts/githooks/pre-push](../scripts/githooks/pre-push)，并给钩子可执行位；
- 生成 `.debug/cloud-env.sh`（`DSH_HOME`、`CHROME_PATH` 与用户级 PATH），运行隐私自测试和快速检查。

需要初始化时顺便跑完整验证：

```bash
RUN_VERIFY=1 bash scripts/cloud-bootstrap.sh
```

脚本不改全局 Git/npm 配置，不写入任何秘密，也不会替你创建或购买 QoderWake 资源。

## 环境变量

| 名称 | 何时需要 | 用途 |
|---|---|---|
| `PRIVACY_FORBIDDEN` | 首次推送前必须 | 私有隐私词表，逗号或换行分隔；只放在 QoderWake 环境/密钥中，不写进仓库 |
| `NPM_REGISTRY` | 可选 | npm 镜像；脚本会同时设置 lockfile 的 registry 替换 |
| `CHROME_PATH` | 脚本自动写入 | 浏览器可执行文件；已有 Chrome 时可手工覆盖 |
| `DSH_HOME` | 脚本自动写入 | 云端开发用 `$PWD/.debug/dsh-home`，不碰 `~/.dsh` |
| `GH_TOKEN` | 可选 | 无交互环境中的 GitHub CLI 凭据；优先用 `gh auth login`，不要把值写进仓库或日志 |
| `GIT_EMAIL` | 可选 | 覆盖默认的 GitHub noreply 地址；仍需是 noreply 邮箱 |

## 隐私检查

推送前检查待推送提交的整棵树、提交说明和提交身份：

```bash
node scripts/privacy-check.mjs --tree HEAD
node scripts/privacy-check.mjs --staged
```

云端 pre-push 钩子会自动运行 `node scripts/privacy-check.mjs --pre-push --require-private <remote-url>`。它会拒绝：

- 非 `Study0915` 两个仓库的推送目标；
- 非快进/强推和分支删除；
- 非 `Study0915` 或非 noreply 邮箱的新提交作者/提交者；
- 个人目录路径、非 example/非 noreply 邮箱、中国大陆手机号、凭据、私钥和敏感文件名；
- `PRIVACY_FORBIDDEN` 中的私有词。

GitHub 用户名和 GitHub noreply 邮箱允许公开；其他个人信息不得进入公共仓库。私有词表可以放在 QoderWake 的环境/密钥，或本地 `.debug/privacy.local.json`：

```json
{
  "forbidden": ["<真实姓名>", "<手机号>", "<个人邮箱>", "<个人目录前缀>"],
  "allow": ["<需要放行的合成值>"]
}
```

`.debug/` 已被忽略。不要提交这个文件，也不要在 PR、日志或截图里写出词表内容。命中结果只显示文件、行号和规则，不显示命中的值。服务端没有配置私有词表时，云端 pre-push 会失败关闭。

## GitHub 认证

在云电脑终端完成一次：

```bash
gh auth login --web
gh auth setup-git
gh auth status
```

或者把有 `repo` 权限的令牌放入 QoderWake 的密钥并以 `GH_TOKEN` 注入。令牌、`PRIVACY_FORBIDDEN` 和其他秘密不得写入仓库、PR、日志或截图。

## Waker 提示词

把下面整段作为首个任务发给绑定云电脑的 Waker：

```text
你是 dsh-scholar-board 的 QoderWake 云端开发 agent。先读 AGENTS.md、ARCHITECTURE.md、docs/PLAN-scholar.md 和 docs/cloud-environment.md。

首次只做环境验证：运行 bash scripts/cloud-bootstrap.sh；source .debug/cloud-env.sh；确认 gh 已认证；运行 npm run verify，把日志保存到 .debug/；报告版本、十关结果和失败项。不要修改产品源码。

后续每次只做一个计划任务：从最新 main 建分支；实现；运行 npm run verify；运行 node scripts/privacy-check.mjs --tree HEAD；提交（作者和提交者使用 Study0915 + GitHub noreply）；push；gh pr create --base main --head <分支>；gh pr checks --watch；失败就修复并更新 PR；CI 全绿后 gh pr merge --merge。合并后同步 main，保留分支，不删除分支。

边界：只向 Study0915/dsh-scholar-board 推送；不推 Nwflower；不发布 npm；不强推；不使用 --no-verify；不改 GitHub 设置；不把 PRIVACY_FORBIDDEN 写入仓库、日志、PR 或截图；不使用真实个人资料；截图只用合成数据；不碰 ~/.dsh；调试产物放 .debug/。

证据：命令、退出码、日志路径、PR URL、合并提交 SHA；不包含个人隐私。
```

## 日常开发流程

S09–S26 的任务入口是 [PLAN-scholar](PLAN-scholar.md)。公共 Waker 执行契约与任务表对应规格小节共同组成完整任务说明。一次只执行当前一项；规格与产品功能的状态分别记录。完成后更新计划、交接、PR 与合并 SHA；未执行的检查和未确认的视觉保留原状态。

此处的 `origin` 指云端产品克隆。执行前用 `git remote -v` 确认它是 `Study0915/dsh-scholar-board`；Windows 既有工作区的产品远端为 `scholar`，旧 `origin` 是另一个 fork，不能照抄命令向旧 fork 提交产品主线。既有环境已初始化时先检测工具和锁文件变化，不重复运行初始化安装。

1. `git fetch origin --prune`，`git switch main`，`git pull --ff-only`。
2. 从 main 建一个任务分支，一次只做一个计划任务。
3. 实现后运行 `npm run verify`；失败先修复，不跳过检查。
4. 运行 `node scripts/privacy-check.mjs --tree HEAD`。
5. 用 `Study0915` + noreply 提交，推送到自己的产品仓库。
6. `gh pr create --base main --head <分支>`，`gh pr checks --watch`；失败继续修复。
7. CI 全绿后 `gh pr merge --merge`；不删除分支，不改分支保护。
8. 合并后 `git switch main && git pull --ff-only`，继续下一个任务。

`npm run verify` 的十道关是 lint、ADR 索引、CHANGELOG、AGENTS 命令表、市场、构建、提供方类型、单元、真实宿主冒烟、尺寸矩阵。冒烟约 260 秒，矩阵约 140 秒，需要 Chrome 和中文字体。

## 证据与交接

- 命令、退出码、版本（Node、pnpm、dsh、Chrome）、日志路径和 PR/合并 SHA 放在任务交接里。
- 日志、截图和临时文件只放 `.debug/`，不提交。
- 截图只用合成数据；提交前人工核对图片是否含个人信息。
- 报告未执行的检查，不把“测试没跑”写成通过。

## 排障

- **Node 版本太低**：设置 `NODE_MIRROR` 后重跑脚本；脚本把 Node 装在 `$HOME/.local/node`。
- **Chrome 找不到**：设置 `CHROME_PATH` 指向已有浏览器；脚本失败时会尝试 Playwright Chromium。
- **中文排版异常**：安装 `fonts-noto-cjk` 后重跑；没有中文字体时冒烟与矩阵会不稳定。
- **dsh 或 pnpm 不可用**：确认已 `source .debug/cloud-env.sh`；脚本把二者装在 `$HOME/.npm-global`。
- **npm 下载慢**：设置 `NPM_REGISTRY`；脚本会同时替换 lockfile 的 registry 主机。
- **gh 未认证**：运行 `gh auth login --web` 或配置 `GH_TOKEN`；不要用登录令牌绕过隐私钩子。
- **钩子没有执行**：确认 `git config --local core.hooksPath` 是 `scripts/githooks`，并 `chmod +x scripts/githooks/pre-push`。
- **pre-push 报未知远端历史**：先 `git fetch origin --prune`，必要时 `git fetch --unshallow`。
- **pre-push 报没有私有词表**：先在 QoderWake 环境/密钥设置 `PRIVACY_FORBIDDEN`；这是失败关闭的预期行为。
- **冒烟超时**：确认 Chrome、字体和 dsh 版本；查看 `.debug/host-logs/`；不要用跳过冒烟代替修复。

## 边界

- 不操作 QoderWake 账号、不购买资源；云电脑由你开通。
- 不向上游 `Nwflower/dsh-widget-board` 提 PR 或推送；不发布 npm。
- 不改写历史、不强推、不删除分支、不使用 `--no-verify`。
- 不改 GitHub 分支保护或仓库设置；合并前由 Waker 自己确认 CI 全绿。
- 公共历史里仍可能有旧提交中的本地路径；本次只保证当前树和后续推送，历史清理需要单独授权。
