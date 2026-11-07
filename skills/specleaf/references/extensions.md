# SpecLeaf 扩展字段

## `x-api-status`：接口状态

这是 SpecLeaf 支持的可选扩展，写在 **Operation 对象**上，与 `summary`、`responses` 同级。值必须是以下小写字符串：

| 值 | 展示文字 | 选择依据 |
| --- | --- | --- |
| `draft` | 草稿 | 明确处于设计、草拟阶段 |
| `developing` | 开发中 | 明确处于开发阶段 |
| `testing` | 测试中 | 明确处于测试阶段 |
| `released` | 已发布 | 用户或项目记录确认已发布 |
| `deprecated` | 已弃用 | 明确已弃用 |

优先保留任务范围内仍适用的已有状态，或依据用户说明、项目生命周期约定设置。新接口不自动等于 `draft`，存在实现不自动等于 `released`；没有依据或项目默认约定时省略字段。状态不会从文档根级、路径或 tag 继承，也不会自动映射其他工具的状态字段。

正确示例（假设该接口明确处于开发阶段；完整契约模板见 [assets/openapi.yaml](../assets/openapi.yaml)）：

```yaml
paths:
  /items:
    get:
      summary: 查询资源
      x-api-status: developing
      responses:
        '200':
          description: 查询成功
```

常见错误：

| 写法 | 原因及修正方式 |
| --- | --- |
| 在 `paths./items` 下写 `x-api-status: developing` | 位于 Path Item；应按每个操作的真实状态写到 `get`、`post` 等 Operation 下 |
| `x-api-status: Released` 或 `已发布` | 只识别表中小写值；确认已发布后使用 `released` |
| `x-api-status: [testing]` | 数组不是字符串；确认测试状态后使用 `testing` |
| `x-api-status: planned` | 未知值；按实际状态和项目约定决定，不能任意映射 |

未设置 `deprecated: true` 时，`x-api-status` 缺失、未知值、大小写不符或类型错误均不显示状态标记；这不代表写法通过了业务规则校验。

### 与标准 `deprecated` 的关系

Operation 上的标准字段 **`deprecated: true` 优先**：即使 `x-api-status: released`，界面仍只显示“已弃用”。字符串 `deprecated: 'true'` 不是布尔值，也不触发这一优先规则。

若需求明确将接口标记为弃用，优先使用标准字段 `deprecated: true`；项目同时使用 `x-api-status` 时，将其设为 `deprecated`，避免冲突。仅从已有的 `x-api-status: deprecated` 生成 HTML 时，不自动补写标准字段或修改源契约。

状态展示不会改变契约；导出的合并契约保留原值，不自动补写 `deprecated`。`x-api-status` 用于导航圆点和详情徽标，不重复列入“操作策略”。

## 其他扩展的展示边界

| 字段 | 位置 | SpecLeaf 行为 |
| --- | --- | --- |
| `x-contract-status` | 文档根级 | 当值为真值时，在概览展示完整原值，说明契约与实际可用范围；不是接口状态来源 |
| `x-design-status` | Operation | 与其他普通操作扩展一样，按原名和完整 JSON 原值展示；不是接口状态来源 |
| 其他 `x-*`（如 `x-rate-limit`、`x-notes`） | Operation | 以原字段名为折叠标题，默认收起，可复制完整 JSON 原值；不解释私有结构 |

`x-contract-status` 和普通操作扩展没有 SpecLeaf 定义的固定枚举或对象结构，按项目现有约定填写。不要套用 `x-api-status` 的枚举，也不要为了文档展示而虚构限流、审计或权限规则。其他层级的自定义扩展不能据此假定会出现在界面中。
