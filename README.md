# SpecLeaf

把 OpenAPI 契约变成可离线阅读的单页文档。

把本地 OpenAPI **3.0 / 3.1 YAML 或 JSON** 转成一个可离线阅读的 HTML 文件。界面采用浅紫色主题，提供左侧接口目录、正文和右侧页内目录；窄屏使用目录抽屉。

## npm 用户用法

需要 Node.js **22.19.0+** 及 npm。本轮完成 npm CLI 打包，尚未正式发布到 npm。下面的 registry 命令为**发布后的用法**：

```bash
# 临时运行
npx specleaf ./openapi.yaml -o ./api.html

# 全局安装
npm install -g specleaf
specleaf ./openapi.yaml

# 项目内使用
npm install -D specleaf
npx specleaf ./openapi.yaml
```

安装包已包含编译后的 CLI 和界面资源。用户安装与运行均不需要 Vite、React、TypeScript 或前端构建步骤，支持 `--ignore-scripts` 安装。

## 生成单个 HTML

以下命令用于已经安装的 CLI：

```bash
specleaf ./openapi.yaml
specleaf ./openapi.json -o ./output/api.html
specleaf "/path/中文 目录/openapi.yaml" --output "/path/输出/API 文档.html"
specleaf --help
specleaf --version
```

默认输出调用目录中的 `openapi.html`。输入和输出路径均相对**调用目录**解析；引用文件相对包含 `$ref` 的文件解析。输出目录不存在时会创建。支持 `-o / --output`、`-h / --help`、`-v / --version`，`--` 后的参数按文件路径处理。

项目内也可通过 npm scripts 调用：

```json
{
  "scripts": {
    "docs": "specleaf ./openapi.yaml -o ./api.html"
  }
}
```

在项目目录运行 `npm run docs` 即可生成。

生成成功后，**只需复制这个 HTML 文件**。脚本、样式、SVG 图标和合并后的契约均已内嵌，不需要 Node.js、源契约、旁边的资源目录或 API 服务。

- **双击打开**：在现代浏览器中直接打开 HTML（`file://`），断网也能搜索、导航、切换示例和导出契约。
- **静态托管**：把 HTML 放到任意静态服务器。可重命名为 `index.html`，部署到根目录或 `/reference/` 等子目录；目录 URL 保留末尾 `/`。接口链接采用 Hash，无需配置路由回退。
- 页面不发送接口请求。Markdown 图片显示为可点击链接，外部示例仅显示地址；生成和阅读均不自动下载图片或远程内容。生产页面还限制了自动联网资源加载。

## 源码开发与默认构建

```bash
git clone https://github.com/SuperPx-CN/specleaf.git
cd specleaf
npm ci
npm run generate -- ./examples/openapi.yaml
npm run generate -- ./examples/minimal.json -o ./output/api.html
```

示例、构建脚本和测试均包含在源码中。`generate` 自动准备预编译资源，再执行源码 CLI。从其他目录调用时可用 `--prefix` 指定源码目录，输入和输出仍相对调用目录解析：

```bash
npm --prefix /path/to/specleaf run generate -- ./openapi.yaml -o ./api.html
```

也可以先在源码目录执行 `npm run build:package`，再直接运行 `node /path/to/specleaf/build/cli.ts ./openapi.yaml` 或 `node /path/to/specleaf/lib/cli.js ./openapi.yaml`，路径相对当前目录。

```bash
npm run dev
npm run build
npm run preview
```

默认入口为项目内的 `examples/openapi.yaml`，包含跨文件递归模型、组合类型、鉴权、参数和多媒体示例。`examples/minimal.json` 是独立的最小 JSON 示例。开发模式监听入口和跨文件引用；解析失败时显示终端错误与浏览器错误浮层，修复后自动刷新。

`npm run build` 先检查 TypeScript、编译 CLI 和通用界面资源，再生成单文件 **`dist/index.html`**。`npm run preview` 用于本地预览。生成器不会清空输出所在目录；分发文档时只需复制本次生成的 HTML。

开发和默认构建可通过 `OPENAPI_ENTRY` 更换入口。相对路径以本项目根目录为基准，支持绝对路径：

```bash
OPENAPI_ENTRY=/absolute/path/to/openapi.yaml npm run dev
OPENAPI_ENTRY=/absolute/path/to/openapi.yaml npm run build
```

转换命令 `generate` 使用明确传入的输入文件，不依赖 `OPENAPI_ENTRY`。

## 本地 tarball 验收

发布前可直接从源码构建、打包和安装，以下命令不会发布到 npm：

```bash
# 在源码目录中执行；prepack 自动检查类型并执行 build:package
npm pack

# 在独立目录安装实际压缩包，不安装开发依赖，不运行安装脚本
mkdir ../specleaf-consumer
cd ../specleaf-consumer
npm init -y
npm install --omit=dev --ignore-scripts ../specleaf/specleaf-1.0.0.tgz
npm exec -- specleaf ../specleaf/examples/minimal.json -o ./api.html
npx specleaf --version
```

把上面的 `../specleaf` 替换为实际源码目录。`npm run test:package` 自动在临时独立目录执行真实 `npm pack`、生产依赖安装、npm scripts、npm exec、npx 临时安装和临时全局安装，再验收文件保护、错误退出与特殊字符。验收后自动删除临时目录，不修改系统全局安装。

`build:package` 只生成 `lib/cli.js` 和 `lib/assets/`；`files` 白名单仅分发这些产物、README、LICENSE 和 npm 必需的包元信息。公开接口为 `specleaf` CLI。

## 阅读功能

- 站点名称、标题、版本与说明来自 `info`；保留原始 tag 名称和描述。按关键词、路径、operationId、说明或请求方法筛选；支持 `⌘/Ctrl + K` 搜索、Escape 关闭移动目录及键盘焦点管理。
- 使用方法和路径生成稳定 Hash，支持复制、刷新、前进和后退。右侧页内目录随滚动高亮；提供空契约、无结果和无效链接状态。
- 展示 Path / Query / Header / Cookie 参数、鉴权、响应状态码、响应头和扩展策略。操作参数覆盖同名同位置的路径参数。
- 接口目录用彩色圆点展示接口状态，并提供中文状态说明；详情页展示对应的中文徽标。
- 字段树保留递归引用、数组、空值、布尔 Schema、`allOf` / `oneOf` / `anyOf` 分支、必填及常用约束，最多展开 32 层。
- 请求与响应可切换媒体类型和多个**原始示例**。JSON、纯文本和 YAML 按原始值展示，无示例时明确提示；不根据 Schema 编造数据。
- 可复制接口路径、分享链接、示例和 cURL，导出合并后的 OpenAPI JSON。Clipboard API 不可用或拒绝访问时会尝试备用复制；仍失败则提供自动选中的文本供手动复制。

cURL 使用服务地址、参数、第一组鉴权方案和当前原始示例生成。使用前替换相对服务地址、参数和 `{token}` 等占位符，并遵循契约中的序列化规则。页面仅供只读阅读，不执行在线调试。

## 接口状态

在 **Operation 层级**使用 `x-api-status`，与 `summary` 同级：

```yaml
paths:
  /items:
    get:
      summary: 查询资源
      x-api-status: released
      responses:
        '200':
          description: 查询成功
```

| 值 | 中文状态 | 颜色 |
| --- | --- | --- |
| `draft` | 草稿 | 灰色 |
| `developing` | 开发中 | 紫色 |
| `testing` | 测试中 | 蓝色 |
| `released` | 已发布 | 绿色 |
| `deprecated` | 已弃用 | 琥珀色 |

当前 Operation 的标准字段 `deprecated: true` 优先显示“已弃用”，即使 `x-api-status` 是其他值，也只显示一个状态徽标。否则只识别表中的小写字符串；缺失、未知值、大小写不符或类型错误时均不显示状态标记。状态不从文档根级、路径或 tag 继承，也不映射其他工具的状态字段。

“操作策略”以“接口状态”为标题，保留 `x-api-status` 原字段名和值。状态解析只用于展示，导出的合并契约保留原值，不自动补写 `deprecated`。`x-design-status` 仍表示设计状态，在操作策略中展示；文档根级的 `x-contract-status` 仍用于概览中的契约状态说明，两者均不作为接口状态来源。

`examples/openapi.yaml` 演示五种状态，`examples/minimal.json` 演示未指定接口状态的契约。

## 错误与已有文件保护

缺少输入、未知参数、多余输入、版本不支持、解析或写入失败时，命令显示中文错误上下文并以非零状态退出。引用错误附带来源文件和 JSON Pointer；远程入口和远程 `$ref` 不受支持。

生成器在内存中生成完整 HTML 后，写入目标同目录的临时文件，最后替换目标文件；失败不会覆盖已有产物。不允许输出覆盖入口或任何被引用文件（包含符号链接和硬链接别名），也不会清空输出目录。更换输出文件或修正错误后重新执行即可。

源契约始终只读。支持范围为 OpenAPI 3.0 / 3.1 的 HTTP 接口阅读，不包含 Swagger 2.0、远程契约、在线调试、深色主题或图片打包。解析器不会代替完整的 OpenAPI / JSON Schema 语义校验。

## 验证

```bash
npm test
npm run typecheck
npm run build
npm run test:package

# 首次执行浏览器验收时安装 Chromium
npx playwright install chromium
npm run test:e2e
```

可以设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用本机 Chromium。浏览器测试读取构建后的 HTML，检查 HTTP 根目录、子目录、移动端、开发监听和错误恢复；另将唯一 HTML 复制到临时独立目录，通过 `file://` 断网验证搜索、导航、刷新、递归模型、示例切换、复制及导出，检查外部资源请求和运行时错误。接口状态验收覆盖目录与详情一致、弃用优先、无效值隐藏、移动端长标题与圆点尺寸，以及导出后扩展值不变。桌面与移动截图保存在 `test-results/`。

单元及命令测试覆盖 YAML / JSON、跨文件及循环引用、中文空格路径、分组顺序与去重、未声明分组及未分组接口、参数和错误退出、已有产物保护、元数据及脚本闭合字符。全部测试仅使用项目内的通用示例、fixture 和测试时生成的临时文件，可直接在独立源码副本中运行上述验证流程。

CI 在 Linux、macOS 和 Windows 上分别使用 Node.js 22.19.0 与 24 运行单元测试、类型检查、构建和 tarball 安装验收；Linux 上另运行完整 Chromium 浏览器验收。

## 源码

```text
build/contract.ts         本地契约解析、合并与错误上下文
build/openapi-plugin.ts  开发模式虚拟模块和引用监听
build/serialize.ts       HTML JSON 数据块的安全序列化
build/package.ts         预编译 ESM CLI、通用 IIFE、CSS 和图标
build/generate.ts        读取包内资源、HTML 内嵌与原子写入
build/cli.ts             specleaf 命令、帮助和版本
build/build.ts            默认生产构建
src/lib/openapi.ts        引用、接口、Schema、示例和 cURL 处理
src/components.tsx        字段树、参数表、Markdown、示例与复制
src/App.tsx               目录、概览与接口详情
examples/                 独立 YAML、JSON 和跨文件模型示例
tests/                    单元、命令及浏览器测试
```

使用 [JSON Schema Ref Parser 的 bundle](https://apidevtools.com/json-schema-ref-parser/docs/ref-parser.html) 合并本地引用，保留内部指针以序列化递归模型；使用 [Vite library 构建选项](https://vite.dev/config/build-options.html#build-lib) 提前生成通用 IIFE。CLI 把安全转义的契约写入 `application/json` 数据块，预编译界面通过虚拟模块读取；所有资源内嵌到同一个 HTML。

## 许可证

[MIT](./LICENSE)，Copyright (c) 2026 SpecLeaf contributors。
