# 第三方许可

## 上游项目

本插件基于 **dsh-widget-board**（MIT License，Copyright (c) 2026 Nwflower，https://github.com/Nwflower/dsh-widget-board）二次开发。上游的版权与许可声明完整保留在 [LICENSE](LICENSE)；内置组件、示例组件与市场原型中的 `nwflower.*` 条目均由上游作者编写，按 MIT 保留署名。

## 运行时依赖

配置与表单的 schema 校验使用 **@deepseek-ai/schemastery 3.18.5**（MIT，https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/schemastery），它随包带上 **@deepseek-ai/cosmokit 1.8.6**（MIT，同一仓库的 `vendor/cosmokit`）与 **@standard-schema/spec 1.1.0**（MIT，https://github.com/standard-schema/standard-schema）。

manifest 与能力参数的 JSON Schema 校验使用 **Ajv 8.20.0**（MIT，https://github.com/ajv-validator/ajv），构建时内联进宿主半边的产物。

版本号比较使用 **semver 7.8.5**（ISC，https://github.com/npm/node-semver）。

浏览器半边以 **React 18.3.1**（MIT，https://github.com/facebook/react）为 peer 依赖，由宿主页面提供，不随本插件打包。

本地图片处理使用 **sharp 0.35.5**（Apache-2.0，https://github.com/lovell/sharp），依赖的 libvips 及平台二进制按其随附许可分发；不向外部服务上传图片。sharp 附带 **@img/colour 1.1.0**（MIT）、**detect-libc 2.1.2**（Apache-2.0）与按平台分发的二进制包（如 **@img/sharp-win32-x64 0.35.5**，Apache-2.0 AND LGPL-3.0-or-later），各自许可见其包内 LICENSE。

校园事项的 IANA 时区及夏令时处理使用 **Luxon 3.7.2**（MIT，https://github.com/moment/luxon）。共享纯模型在构建时内联进标准校园组件；不请求外部时间服务。

本插件随包发布三个精选库，构建时打进 `lib/runtime/libs/`，组件文档用到它们时内联：

- **marked** — Markdown 解析器，MIT License，https://github.com/markedjs/marked
- **highlight.js** — 代码高亮，BSD-3-Clause License，https://github.com/highlightjs/highlight.js
- **Three.js** — WebGL 三维渲染，MIT License，https://github.com/mrdoob/three.js

组件包与看板包的 zip 读写用 **fflate**（MIT License，https://github.com/101arrowz/fflate），内联进宿主半边的产物。

高级源码编辑器用 **CodeMirror 6**（MIT License，https://github.com/codemirror/view），构建时打进 `lib/client.source-editor.js`；源码面板在进入高级模式时才按需加载它，用到的部分有 `@codemirror/view`、`@codemirror/state`、`@codemirror/commands`、`@codemirror/search`、`@codemirror/language`、`@codemirror/autocomplete`、`@codemirror/lint`、`@codemirror/lang-html`、`@codemirror/lang-css`、`@codemirror/lang-javascript`、`@codemirror/lang-json` 与 `@codemirror/theme-one-dark`。

倒计时的IANA时区及夏令时处理使用 **Luxon 3.7.2**（MIT，https://github.com/moment/luxon），构建时内联进组件脚本，不请求外部时间服务。

「月历」与「今日运势」两个内置组件随目录带一份 **lunar-javascript 1.7.7**（MIT License，https://github.com/6tail/lunar-javascript），放在各自的 `vendor/` 下，经 manifest 的 `scripts` 内联进组件文档；农历、节气、干支与宜忌都由它算。文件原样保留，未做修改。

CSV 读取与导出使用 **Papa Parse 5.7.0**（MIT，https://github.com/mholt/PapaParse）；ICS 解析、重复规则与标准序列化使用 **ical.js 2.2.1**（MPL-2.0，https://github.com/kewisch/ical.js）。两者构建进宿主半边，保留各自许可声明；ical.js 源文件没有修改，源代码可从对应版本的上游仓库取得。

Atom XML 的校验与解析使用 **fast-xml-parser 5.12.0**（MIT，https://github.com/NaturalIntelligence/fast-xml-parser），构建时内联进宿主半边。它随包带上 **@nodable/entities 3.1.0**、**fast-xml-builder 1.3.1**、**is-unsafe 2.0.3**、**path-expression-matcher 1.6.2**、**strnum 2.5.1** 与 **xml-naming 0.3.0**，均为 MIT，各自许可见其包内 LICENSE。宿主先拒绝带 `DOCTYPE` 的文档再解析，自定义实体不在展开范围内。

上述库的版权归各自的作者所有；本插件只做打包与调用。

看板入口的未读通知徽标参考了 transitions.dev 的 **Notification badge**（作者 Jakub Antalík），按它的许可改写为本站的类名与令牌：

- 来源：https://transitions.dev/detail.html?t=notification-badge
- 许可：https://transitions.dev/terms.html
