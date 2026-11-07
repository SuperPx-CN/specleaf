---
name: specleaf
description: 为使用 SpecLeaf 的项目编写或更新 OpenAPI 3.0 / 3.1 契约，正确使用 x-api-status 等扩展；将本地契约生成或更新为离线 HTML，支持多模块汇总和生成报错排查。
---

# SpecLeaf

CLI 需要 Node.js 22.19.0+。支持本地 OpenAPI 3.0 / 3.1（YAML / JSON），不支持 Swagger 2.0、远程入口或远程 `$ref`。

## 编写或更新契约

用户要求创建、修改或修复契约时，先读取 [编写指南](references/authoring.md) 和 [扩展字段规则](references/extensions.md)，再按项目约定修改。新建契约可参考 [最小完整模板](assets/openapi.yaml)，按需求替换示例内容。

只要求生成或更新 HTML 时，直接使用下面的生成流程，保持入口和引用文件只读。编写契约后，仅在用户要求或项目既有流程需要时生成 HTML。

## 生成 HTML

1. 优先用用户指定路径或项目文档命令中的入口。自行查找时，区分完整契约与模型片段；有多个无关入口时询问范围。
2. 单文件传文件路径，多模块传公共目录。目录递归识别 `openapi.yaml`、`openapi.yml`、`openapi.json`，每个目录限一个入口。各模块独立，无需合并契约或重命名模型。
3. 用 `-o` 指定输出，按用户路径或项目约定，默认 `./openapi.html`。只覆盖本次要更新的文档，保留入口和引用文件。

```bash
specleaf "./docs/apis" -o "./docs/api.html"
```

输入、输出相对调用目录解析，`$ref` 相对所在文件解析；不要切到 skill 目录执行。

优先复用项目命令或已安装的 `specleaf`；项目内安装可用 `npm exec --offline -- specleaf`。CLI 不可用时，读取本 skill 目录下 `specleaf.json` 的 `version`，执行 `npx --yes specleaf@<版本> <输入> -o <输出>`。无记录则先核实可用版本。

## 排错

- 缺失引用：按报错的来源文件和 JSON Pointer 检查路径、文件及字段。
- 找不到入口：检查目录和文件名。扫描跳过隐藏目录、`node_modules`、`dist`、`build`、`coverage` 及目录符号链接。
- 重复入口：列出冲突目录和文件，不自行删改契约。
- 输出冲突：换输出路径。修复契约须在用户请求范围内，不编造接口、字段或示例。

## 完成

编写契约时，按编写指南检查并运行项目已有校验，交付修改文件、扩展字段变更及验证结果。生成 HTML 时，确认命令成功且 HTML 非空，提供文件链接、输入范围、版本和复现命令。HTML 可独立离线阅读；生成成功不代表通过完整的 OpenAPI / JSON Schema 校验。
