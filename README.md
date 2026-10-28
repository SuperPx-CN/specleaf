# SpecLeaf

把 OpenAPI 契约变成可离线阅读的单页文档。

把本地 OpenAPI **3.0 / 3.1 YAML 或 JSON** 转成一个可离线阅读的 HTML 文件。界面采用浅紫色主题，提供左侧接口目录、正文和右侧页内目录；窄屏使用目录抽屉。

## 安装

需要 Node.js **22.19+** 及 npm。克隆源码后，进入项目目录安装依赖：

```bash
git clone https://github.com/SuperPx-CN/specleaf.git
cd specleaf
npm ci
```

示例、构建脚本和测试均包含在源码中，可在任意目录独立安装和运行。

## 生成单个 HTML

```bash
npm run generate -- ./examples/openapi.yaml
npm run generate -- ./examples/minimal.json -o ./output/api.html
npm run generate -- "/path/中文 目录/openapi.yaml" --output "/path/输出/API 文档.html"
npm run generate -- --help
```

默认输出调用目录中的 `openapi.html`。输入和输出路径均相对**调用目录**解析；引用文件相对包含 `$ref` 的文件解析。输出目录不存在时会创建。

从其他目录调用时可用 `--prefix` 指定本源码目录：

```bash
npm --prefix /path/to/specleaf run generate -- ./openapi.yaml -o ./api.html
```

也可以直接运行源码命令，路径相对当前目录：

```bash
node /path/to/specleaf/build/cli.ts ./openapi.yaml -o ./api.html
```

生成成功后，**只需复制这个 HTML 文件**。脚本、样式、SVG 图标和合并后的契约均已内嵌，不需要 Node.js、源契约、旁边的资源目录或 API 服务。

- **双击打开**：在现代浏览器中直接打开 HTML（`file://`），断网也能搜索、导航、切换示例和导出契约。
- **静态托管**：把 HTML 放到任意静态服务器。可重命名为 `index.html`，部署到根目录或 `/reference/` 等子目录；目录 URL 保留末尾 `/`。接口链接采用 Hash，无需配置路由回退。
- 页面不发送接口请求。Markdown 图片显示为可点击链接，外部示例仅显示地址；生成和阅读均不自动下载图片或远程内容。生产页面还限制了自动联网资源加载。

## 开发与默认构建

```bash
npm run dev
npm run build
npm run preview
```

默认入口为项目内的 `examples/openapi.yaml`，包含跨文件递归模型、组合类型、鉴权、参数和多媒体示例。`examples/minimal.json` 是独立的最小 JSON 示例。开发模式监听入口和跨文件引用；解析失败时显示终端错误与浏览器错误浮层，修复后自动刷新。

`npm run build` 先检查 TypeScript，再生成单文件 **`dist/index.html`**。`npm run preview` 用于本地预览。生成器不会清空输出所在目录；分发文档时只需复制本次生成的 HTML。

开发和默认构建可通过 `OPENAPI_ENTRY` 更换入口。相对路径以本项目根目录为基准，支持绝对路径：

```bash
OPENAPI_ENTRY=/absolute/path/to/openapi.yaml npm run dev
OPENAPI_ENTRY=/absolute/path/to/openapi.yaml npm run build
```

转换命令 `generate` 使用明确传入的输入文件，不依赖 `OPENAPI_ENTRY`。

## 阅读功能

- 站点名称、标题、版本与说明来自 `info`；保留原始 tag 名称和描述。按关键词、路径、operationId、说明或请求方法筛选；支持 `⌘/Ctrl + K` 搜索、Escape 关闭移动目录及键盘焦点管理。
- 使用方法和路径生成稳定 Hash，支持复制、刷新、前进和后退。右侧页内目录随滚动高亮；提供空契约、无结果和无效链接状态。
- 展示 Path / Query / Header / Cookie 参数、鉴权、响应状态码、响应头和扩展策略。操作参数覆盖同名同位置的路径参数。
- 字段树保留递归引用、数组、空值、布尔 Schema、`allOf` / `oneOf` / `anyOf` 分支、必填及常用约束，最多展开 32 层。
- 请求与响应可切换媒体类型和多个**原始示例**。JSON、纯文本和 YAML 按原始值展示，无示例时明确提示；不根据 Schema 编造数据。
- 可复制接口路径、分享链接、示例和 cURL，导出合并后的 OpenAPI JSON。Clipboard API 不可用或拒绝访问时会尝试备用复制；仍失败则提供自动选中的文本供手动复制。

cURL 使用服务地址、参数、第一组鉴权方案和当前原始示例生成。使用前替换相对服务地址、参数和 `{token}` 等占位符，并遵循契约中的序列化规则。页面仅供只读阅读，不执行在线调试。

## 错误与已有文件保护

缺少输入、未知参数、多余输入、版本不支持、解析或写入失败时，命令显示中文错误上下文并以非零状态退出。引用错误附带来源文件和 JSON Pointer；远程入口和远程 `$ref` 不受支持。

生成器在内存构建成功后，把完整 HTML 写入目标同目录的临时文件，最后替换目标文件；失败不会覆盖已有产物。不允许输出覆盖入口或任何被引用文件（包含符号链接和硬链接别名），也不会清空输出目录。更换输出文件或修正错误后重新执行即可。

源契约始终只读。支持范围为 OpenAPI 3.0 / 3.1 的 HTTP 接口阅读，不包含 Swagger 2.0、远程契约、在线调试、深色主题或图片打包。项目以源码命令交付，保留 `private: true`，不发布 npm CLI 包。解析器不会代替完整的 OpenAPI / JSON Schema 语义校验。

## 验证

```bash
npm test
npm run typecheck
npm run build

# 首次执行浏览器验收时安装 Chromium
npx playwright install chromium
npm run test:e2e
```

可以设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用本机 Chromium。浏览器测试读取构建后的 HTML，检查 HTTP 根目录、子目录、移动端、开发监听和错误恢复；另将唯一 HTML 复制到临时独立目录，通过 `file://` 断网验证搜索、导航、刷新、递归模型、示例切换、复制及导出，检查外部资源请求和运行时错误。桌面与移动截图保存在 `test-results/`。

单元及命令测试覆盖 YAML / JSON、跨文件及循环引用、中文空格路径、分组顺序与去重、未声明分组及未分组接口、参数和错误退出、已有产物保护、元数据及脚本闭合字符。全部测试仅使用项目内的通用示例、fixture 和测试时生成的临时文件，可直接在独立源码副本中运行上述验证流程。

## 源码

```text
build/contract.ts        本地契约解析、合并与错误上下文
build/openapi-plugin.ts  Vite 虚拟模块、安全序列化和开发监听
build/generate.ts       IIFE 内存构建、HTML 内嵌与原子写入
build/cli.ts            generate 命令
build/build.ts          默认生产构建
src/lib/openapi.ts      引用、接口、Schema、示例和 cURL 处理
src/components.tsx      字段树、参数表、Markdown、示例与复制
src/App.tsx             目录、概览与接口详情
examples/               独立 YAML、JSON 和跨文件模型示例
tests/                  单元、命令及浏览器测试
```

使用 [JSON Schema Ref Parser 的 bundle](https://apidevtools.com/json-schema-ref-parser/docs/ref-parser.html) 合并本地引用，保留内部指针以序列化递归模型；使用 [Vite library 构建选项](https://vite.dev/config/build-options.html#build-lib) 生成单个 IIFE，随后内嵌到 HTML。

## 许可证准备

许可证已选定为 [MIT](https://opensource.org/license/mit)。版权署名待补；确认署名后再添加正式 `LICENSE` 文件及 `package.json` 的 `license` 字段。
