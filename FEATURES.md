# good7ob CLI — 功能文档

> **Version:** 0.1.0  
> **Tech Stack:** TypeScript · Node.js 16+ · Commander.js

---

## 目录

- [安装与配置](#安装与配置)
- [命令结构](#命令结构)
- [infra app — 应用组合管理](#infra-app--应用组合管理)
- [infra resource — 云资源管理](#infra-resource--云资源管理)
- [infra cost — 成本分析](#infra-cost--成本分析)
- [infra bill — 账单管理](#infra-bill--账单管理)
- [pm project — 项目管理](#pm-project--项目管理)
- [pm task — 任务管理](#pm-task--任务管理)
- [pm plan — 执行计划管理](#pm-plan--执行计划管理)
- [pm workflow — 工作流管理](#pm-workflow--工作流管理)
- [pm report — 进度报告](#pm-report--进度报告)
- [pm tag — 标签管理](#pm-tag--标签管理)
- [pm health — 产品健康度](#pm-health--产品健康度)
- [idea — Idea 池](#idea--idea-池)
- [workspace — 我的工作台](#workspace--我的工作台)
- [release — 发布管理](#release--发布管理)
- [approval — 审批](#approval--审批)
- [trace — 追溯关系](#trace--追溯关系)
- [输出格式](#输出格式)
- [依赖列表](#依赖列表)

---

## 安装与配置

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 全局安装（可选）
npm link

# 开发模式运行
npm run dev -- <command>
```

### 认证配置

```bash
# 方式一：环境变量
export GOOD7OB_API_KEY=g7b_sk_...
export GOOD7OB_API_URL=https://api.good7ob.net

# 方式二：配置文件 (~/.good7ob/config.json)
good7ob config set api-key "your-api-key"
good7ob config set api-url "https://api.good7ob.net"
```

---

## 命令结构

```
good7ob
├── infra                    # 基础设施管理
│   ├── app                  # 应用组合管理
│   ├── resource             # 云资源管理
│   ├── cost                 # 成本分析与监控
│   └── bill                 # 账单导入与管理
├── pm                       # 项目管理
│   ├── project              # 项目 CRUD、归档、参与者
│   ├── task                 # 任务 CRUD、批量更新
│   ├── workflow             # 工作流模板与阶段管理
│   ├── report               # AI 进度报告
│   ├── tag                  # 标签管理
│   └── health               # 产品健康度、模块进度、范围基线、进度配置、范围变更、Burnup、快照重建；P50/P80 预测、成本/预算、What-if、诊断、AI 解读、管理报告
├── idea                     # Idea 池：估算对比、审批/选定生成需求、评论/附件/标签/关联、合并/恢复、AI 生成方案与估算修正、变更集、效果复盘
├── workspace                # 个人工作台：待办队列（就地审批/稍后/忽略/按优先分排序）、总览、我的任务/产品/组织、我的 AI 团队、AI 日报、下一步推荐
├── release                  # 发布管理：计划、关联任务、开始、申请审批、Release 健康度与基线
├── approval                 # 通用审批：列表、批准、驳回、撤销
└── trace                    # 追溯关系：对象之间的有向关联
```

---

## infra app — 应用组合管理

### `infra app create`

创建新应用。

| 选项 | 说明 |
|------|------|
| `--name` | 应用名称 |
| `--environment` | 环境（prod/staging/dev） |
| `--owner-id` | 负责人 ID |
| `--co-owner-id` | 协同负责人 ID |
| `--description` | 应用描述 |
| `--tags` | 标签（逗号分隔） |
| `--tech-stack` | 技术栈 |
| `--arch-type` | 架构类型 |
| `--deps` | 依赖项 |
| `--launch-date` | 上线日期 |
| `--eol-date` | EOL 日期 |
| `--status` | 应用状态 |
| `--created-by` | 创建人 |

### `infra app update <app-id>`

更新应用信息，支持与 `create` 相同的字段（除 `--created-by`）。

### `infra app delete <app-id>`

删除应用。

| 选项 | 说明 |
|------|------|
| `-f, --force` | 强制删除，不提示确认 |
| `--soft-delete` | 软删除（保留记录） |
| `--hard-delete` | 硬删除（彻底清除） |

### `infra app get <app-id>`

查看应用详情。

| 选项 | 说明 |
|------|------|
| `--show-resources` | 同时展示关联资源 |
| `--json` | JSON 格式输出 |
| `--yaml` | YAML 格式输出 |

### `infra app list`

列出所有应用，支持多维度过滤。

| 选项 | 说明 |
|------|------|
| `--environment` | 按环境过滤 |
| `--owner-id` | 按负责人过滤 |
| `--tags` | 按标签过滤 |
| `--status` | 按状态过滤 |
| `--search` | 关键词搜索 |
| `--sort` | 排序字段 |
| `--order` | 排序方向（asc/desc） |
| `--page` / `--limit` | 分页 |
| `--json` / `--csv` | 导出格式 |

### `infra app import`

从 CSV/JSON 文件批量导入应用。

| 选项 | 说明 |
|------|------|
| `--file` | 文件路径（必填） |
| `--format` | 文件格式（csv/json） |
| `--preview` | 预览模式，不实际写入 |
| `--skip-errors` | 跳过错误行继续导入 |
| `--overwrite` | 覆盖已存在的应用 |

### `infra app export`

导出应用清单到文件。

| 选项 | 说明 |
|------|------|
| `--file` | 输出文件路径 |
| `--format` | 导出格式（csv/json/xlsx） |
| `--include-resources` | 包含关联资源 |
| `--include-costs` | 包含成本数据 |

### `infra app tag <app-id>`

管理应用标签。

| 选项 | 说明 |
|------|------|
| `--add` | 添加标签 |
| `--remove` | 移除标签 |
| `--replace` | 替换全部标签 |
| `--list` | 列出当前标签 |

### `infra app bind-resource <app-id>`

将云资源关联到应用。

| 选项 | 说明 |
|------|------|
| `--resource-ids` | 资源 ID 列表（必填） |
| `--relation-type` | 关联类型 |
| `--replace` | 替换已有关联 |

### `infra app unbind-resource <app-id> <resource-id>`

解除应用与资源的关联。

### `infra app auto-bind`

配置基于标签的自动资源关联规则。

| 选项 | 说明 |
|------|------|
| `--add-rule` | 添加规则 |
| `--rule-name` | 规则名称 |
| `--tag-key` / `--tag-value` | 匹配标签键值 |
| `--app-id` | 目标应用 |
| `--remove-rule` | 移除规则 |
| `--list-rules` | 列出所有规则 |
| `--execute` | 立即执行规则 |
| `--dry-run` | 演习模式，只输出匹配结果 |

### `infra app health-check`

对应用清单执行健康检查。

| 选项 | 说明 |
|------|------|
| `--check-unassociated` | 检查未关联资源的应用 |
| `--check-incomplete` | 检查信息不完整的应用 |
| `--check-stale` | 检查长期未更新的应用 |
| `--stale-days` | 定义"陈旧"的天数阈值 |
| `--fix` | 自动修复可修复的问题 |
| `--json` / `--report` | 输出报告 |

---

## infra resource — 云资源管理

### `infra resource list`

列出云资源，支持多维度过滤。

| 选项 | 说明 |
|------|------|
| `--type` | 资源类型（EC2/RDS/S3 等） |
| `--provider` | 云提供商（aws/azure/gcp/aliyun） |
| `--environment` | 环境 |
| `--status` | 资源状态 |
| `--app-id` | 按关联应用过滤 |
| `--search` | 关键词搜索 |
| `--sort` / `--order` | 排序 |
| `--page` / `--limit` | 分页 |
| `--json` / `--csv` | 导出格式 |

### `infra resource get <resource-id>`

查看资源详情。

| 选项 | 说明 |
|------|------|
| `--show-costs` | 展示成本信息 |
| `--show-metrics` | 展示使用指标 |
| `--show-apps` | 展示关联应用 |
| `--json` / `--yaml` | 输出格式 |

### `infra resource import`

从 CSV/JSON 文件批量导入资源。

| 选项 | 说明 |
|------|------|
| `--file` | 文件路径（必填） |
| `--provider` | 云提供商（必填） |
| `--format` | 文件格式 |
| `--preview` | 预览模式 |
| `--skip-errors` | 跳过错误行 |
| `--update-existing` | 更新已存在的资源 |

### `infra resource export`

导出资源清单。

| 选项 | 说明 |
|------|------|
| `--file` | 输出文件路径 |
| `--format` | 导出格式（csv/json/xlsx） |
| `--type` / `--provider` / `--environment` | 过滤条件 |
| `--app-id` | 按应用过滤 |
| `--include-costs` / `--include-metrics` | 包含额外数据 |

---

## infra cost — 成本分析

### `infra cost overview`

查看指定月份的成本总览。

| 选项 | 说明 |
|------|------|
| `--month` | 月份（YYYY-MM，默认当月） |
| `--compare-last` | 与上月对比 |
| `--currency` | 货币单位 |
| `--json` | JSON 格式输出 |

### `infra cost app`

按应用维度的成本明细。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--limit` | 返回条数 |
| `--include-breakdown` | 包含资源类型细项 |
| `--sort` / `--order` | 排序 |
| `--json` | JSON 格式输出 |

### `infra cost env`

按环境维度的成本明细。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--compare-prod` | 与生产环境对比 |
| `--json` | JSON 格式输出 |

### `infra cost type`

按资源类型的成本明细。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--provider` | 按云提供商过滤 |
| `--limit` | 返回条数 |
| `--json` | JSON 格式输出 |

### `infra cost provider`

按云提供商的成本明细。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--json` | JSON 格式输出 |

### `infra cost trend`

查看历史成本趋势。

| 选项 | 说明 |
|------|------|
| `--months` | 历史月数 |
| `--dimension` | 分析维度（app/env/type/provider） |
| `--dimension-value` | 维度过滤值 |
| `--json` | JSON 格式输出 |

### `infra cost waste`

识别浪费和低利用率资源。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--dimension` | 分析维度 |
| `--min-waste` | 最小浪费金额阈值 |
| `--limit` | 返回条数 |
| `--json` | JSON 格式输出 |

### `infra cost reconcile`

对账：将分摊成本与原始账单比对。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--provider` | 云提供商 |
| `--tolerance` | 允许误差比例 |
| `--verbose` | 输出详细差异 |
| `--json` | JSON 格式输出 |

### `infra cost export`

导出成本报告。

| 选项 | 说明 |
|------|------|
| `--month` | 月份 |
| `--file` | 输出文件路径 |
| `--format` | 导出格式（csv/json/xlsx） |
| `--include-trends` | 包含趋势数据 |
| `--include-waste` | 包含浪费分析 |
| `--include-recommendations` | 包含优化建议 |

### `infra cost forecast`

基于历史趋势预测未来成本。

| 选项 | 说明 |
|------|------|
| `--months-ahead` | 预测月数 |
| `--confidence` | 置信区间（0-1） |
| `--dimension` | 预测维度 |
| `--json` | JSON 格式输出 |

---

## infra bill — 账单管理

### `infra bill import`

从云提供商账单文件导入数据。

| 选项 | 说明 |
|------|------|
| `--file` | 账单文件路径（必填） |
| `--provider` | 云提供商（必填） |
| `--format` | 文件格式（csv/json/tsv） |
| `--month` | 账单月份 |
| `--preview` | 预览模式，不实际写入 |
| `--skip-errors` | 跳过错误行 |
| `--skip-duplicate` | 跳过重复记录 |
| `--start-row` | 从第几行开始读取 |

### `infra bill list`

查看已导入的账单列表。

| 选项 | 说明 |
|------|------|
| `--provider` | 按云提供商过滤 |
| `--month` | 按月份过滤 |
| `--status` | 按状态过滤 |
| `--sort` / `--order` | 排序 |
| `--page` / `--limit` | 分页 |
| `--json` / `--csv` | 导出格式 |

### `infra bill get <bill-id>`

查看账单详情及导入摘要。

| 选项 | 说明 |
|------|------|
| `--show-records` | 展示明细记录 |
| `--show-errors` | 展示导入错误 |
| `--show-reconcile` | 展示对账状态 |
| `--limit` | 明细条数限制 |
| `--json` | JSON 格式输出 |

### `infra bill schedule`

配置账单自动导入计划任务。

| 选项 | 说明 |
|------|------|
| `--add-schedule` | 添加计划任务 |
| `--schedule-id` | 计划任务 ID |
| `--provider` | 云提供商 |
| `--frequency` | 频率（daily/weekly/monthly） |
| `--day` | 执行日期（按频率） |
| `--time` | 执行时间 |
| `--bucket` / `--prefix` | S3 数据源配置 |
| `--enabled` / `--disable` | 启用/停用 |
| `--list-schedules` | 列出所有计划 |
| `--remove-schedule` | 删除计划 |
| `--test` | 测试计划是否可访问数据 |
| `--json` | JSON 格式输出 |

### `infra bill delete <bill-id>`

删除账单记录。

| 选项 | 说明 |
|------|------|
| `-f, --force` | 强制删除 |
| `--soft-delete` | 软删除 |
| `--hard-delete` | 硬删除 |
| `--keep-costs` | 保留已分摊的成本数据 |

---

## pm project — 项目管理

API 端点前缀：`/progress/projects`

| 命令 | 说明 |
|------|------|
| `pm project list` | 列出项目，支持状态/关键词过滤、分页 |
| `pm project get <id>` | 查看项目详情（进度、任务数、剩余天数等） |
| `pm project create` | 创建项目（名称必填） |
| `pm project update <id>` | 更新项目信息 |
| `pm project delete <id>` | 软删除项目（需 `-f` 确认） |
| `pm project archive <id>` | 归档项目（`--unarchive` 取消归档） |
| `pm project recalculate <id>` | 根据任务完成度重新计算项目进度 |
| `pm project gantt <id>` | 获取 Gantt 图表数据 |
| `pm project participants <id>` | 列出项目参与者 |
| `pm project add-participant <project-id>` | 添加参与者（需 `--user-id`） |
| `pm project remove-participant <participant-id>` | 移除参与者（需 `-f` 确认） |

**`pm project list` 选项：**

| 选项 | 说明 |
|------|------|
| `--status` | 状态过滤（not_started\|in_progress\|paused\|completed） |
| `--search` | 关键词搜索 |
| `--include-archived` | 包含已归档项目 |
| `--page` / `--limit` | 分页 |
| `--json` / `--csv` | 输出格式 |

**`pm project create` 选项：**

| 选项 | 说明 |
|------|------|
| `--name` | 项目名称（必填） |
| `--description` | 项目描述 |
| `--start-date` | 开始日期（YYYY-MM-DD） |
| `--end-date` | 截止日期（YYYY-MM-DD） |
| `--owner-id` | 负责人用户 ID |
| `--status` | 初始状态（默认 not_started） |

---

## pm task — 任务管理

API 端点前缀：`/progress/tasks`

| 命令 | 说明 |
|------|------|
| `pm task list <project-id>` | 列出项目任务，支持状态/优先级/标签过滤 |
| `pm task get <id>` | 查看任务详情（含执行者类型、阻塞原因等） |
| `pm task create` | 创建任务（project-id 和 name 必填） |
| `pm task update <id>` | 更新任务 |
| `pm task move <ids...>` | 把一个或多个任务移到另一个项目（带前置校验） |
| `pm task delete <id>` | 删除任务（需 `-f` 确认） |
| `pm task batch-update` | 批量更新多个任务的状态/优先级/负责人 |

**`pm task list` 选项：**

| 选项 | 说明 |
|------|------|
| `--status` | 状态过滤（not_started\|in_progress\|completed\|blocked\|cancelled） |
| `--priority` | 优先级过滤（high\|medium\|low） |
| `--tags` | 按标签过滤（逗号分隔） |
| `--parent-task-id` | 列出指定父任务的子任务 |
| `--json` / `--csv` | 输出格式 |

**`pm task create` 选项：**

| 选项 | 说明 |
|------|------|
| `--project-id` | 项目 ID（必填） |
| `--name` | 任务名称（必填） |
| `--description` | 任务描述 |
| `--priority` | 优先级（high\|medium\|low，默认 medium） |
| `--status` | 初始状态（默认 not_started） |
| `--deadline` | 截止日期（YYYY-MM-DD） |
| `--owner-id` | 负责人用户 ID |
| `--parent-task-id` | 父任务 ID（创建子任务） |

**`pm task move` 选项：**

任务 ID 支持空格或逗号分隔：`pm task move 871 872 --to-project 4` 或 `pm task move 871,872 --to-project 4`。

| 选项 | 说明 |
|------|------|
| `--to-project` | 目标项目 ID（必填） |
| `--with-subtasks` | 连同子任务一起移动，会递归到整棵子树 |
| `--force` | 无视校验错误强制执行 |
| `--dry-run` | 只打印移动计划，不写入 |
| `--json` | 以 JSON 输出计划与结果 |

**移动前的校验规则：**

| 代码 | 级别 | 触发条件 |
|------|------|---------|
| `ALREADY_IN_TARGET` | 警告 | 任务已在目标项目，跳过 |
| `DEADLINE_AFTER_PROJECT_END` | 错误 | 任务截止日期晚于目标项目结束日期 |
| `PARENT_LEFT_BEHIND` | 错误 | 父任务不在本次移动范围内，移动后形成跨项目悬挂引用 |
| `SUBTASKS_LEFT_BEHIND` | 警告 | 子任务会留在原项目，提示可加 `--with-subtasks` |

出现错误级问题时**不做任何写入**并以 exit 1 退出；加 `--force` 可降级为警告后继续。
移动完成后会逐个读回校验 `projectId` 是否真的落到目标项目。

> 后端 `PUT /progress/tasks/{id}` 本身接受 `projectId` 变更但不做上述任何校验
> （`TaskService.saveOrUpdateTask` 的截止日期守卫只在请求体带 deadline 时才触发，
> 仅传 projectId 的移动请求会绕过它），因此这些检查放在 CLI 侧。
> `pm task update --project-id` 是不带校验的直通写法，供脚本使用，日常请用 `pm task move`。

**`pm task batch-update` 选项：**

| 选项 | 说明 |
|------|------|
| `--ids` | 任务 ID 列表（逗号分隔，必填） |
| `--status` | 批量设置状态 |
| `--priority` | 批量设置优先级 |
| `--owner-id` | 批量设置负责人 |

---

## pm plan — 执行计划管理

API 端点前缀：`/progress/execution-plans`

把项目中的若干任务编成一条有序执行链，设定开始时间与预计耗时，由后端按序推进；
支持两种暂停、运行中编辑未开始的节点、失败沿任务依赖自动传播。设计详见
`docs/需求检讨/04-执行计划设计.md`，需求见 `docs/prd/progress/execution-plan/prd-0075-*.md`。

| 命令 | 说明 |
|------|------|
| `pm plan create` | 创建计划（draft），可选带初始 task 链 |
| `pm plan list <project-id>` | 列出项目下的执行计划 |
| `pm plan get <id>` | 查看计划详情（含链、派生的预计开始时刻、警告） |
| `pm plan edit <id>` | 编辑计划属性（乐观锁） |
| `pm plan delete <id>` | 删除计划（仅 draft 或已终结状态） |
| `pm plan add-task <id>` | 向链中追加/插入一个任务 |
| `pm plan remove-item <id>` | 移除一个未开始的节点 |
| `pm plan reorder <id>` | 重排未开始的节点顺序 |
| `pm plan skip-item <id>` | 跳过一个未开始的节点 |
| `pm plan schedule <id>` | draft → scheduled |
| `pm plan start <id>` | 立即启动（draft / scheduled → running） |
| `pm plan pause <id>` | 优雅暂停：等当前节点跑完再停 |
| `pm plan halt <id>` | 强制暂停：立即终止当前节点，需显式确认 |
| `pm plan resume <id>` | 恢复（累计暂停时长） |
| `pm plan cancel <id>` | 取消计划 |
| `pm plan events <id>` | 事件时间线（只追加，不可篡改） |

**`pm plan create` 选项：**

| 选项 | 说明 |
|------|------|
| `--project-id` | 项目 ID（必填） |
| `--name` | 计划名称（必填） |
| `--description` | 计划描述 |
| `--start` | 计划开始时间，`"YYYY-MM-DD HH:mm"`（不填 = 等待手动启动） |
| `--tasks` | 初始 task 链，按顺序逗号分隔的任务 ID |
| `--execution-mode` | `sequential`（默认）\| `parallel_where_possible` |

预计耗时默认由链上各任务的估算工时自动推导（`estimatedDurationSource=derived`），
不需要手填；改用 `pm plan edit --estimated-minutes` 手动覆盖后不再跟随任务估算变化。

**乐观锁与 `--version`：**

`edit` / `add-task` / `reorder` / `skip-item` 都要求提交时携带计划当前的 `version`，
不提供 `--version` 时 CLI 会先 `GET` 一次自动获取，日常使用不需要手动追踪版本号。
两个客户端并发编辑时，后提交的一方仍会收到后端的"计划已被他人修改，请刷新后重试"。

**两种暂停的区别：**

| | `pause`（优雅） | `halt`（强制） |
|---|---|---|
| 行为 | 不再启动新节点，当前节点跑完再停 | 当前节点立即终止 |
| 需要确认 | 否 | 是（`--yes`），CLI 在发请求前先本地拦截一次 |
| 被中止的节点 | 正常完成 | 标记 `aborted`（≠`failed`），对应任务回退，可另行重排 |
| 何时用 | 默认选择，避免留下半成品 | 紧急止损（如发现方向错误、线上事故） |

```bash
# 不带 --yes 会被 CLI 拒绝并提示，不会发出请求
good7ob pm plan halt 12 --reason "线上事故，立即止损" --yes
```

**失败传播（无全局开关）：**

某个节点失败后，是否阻塞后续节点由该链上任务之间的依赖关系决定，而不是一个全局配置：
依赖失败节点（`finish_to_start`）的后续任务会被标记 `blocked`（`get`/`events` 里可见
`blockedByItemId` 指向哪个节点），不依赖的任务照常执行。全部终结后计划状态为
`completed`，用 `failedItemCount` / `blockedItemCount` 两个计数表达，不会出现
"部分完成"这种额外状态。

---

## pm workflow — 工作流管理

API 端点前缀：`/progress/workflows`

| 命令 | 说明 |
|------|------|
| `pm workflow templates` | 列出所有工作流模板 |
| `pm workflow template-get <id>` | 查看模板详情及阶段列表 |
| `pm workflow start` | 为任务应用工作流模板 |
| `pm workflow complete-stage <task-id>` | 完成当前工作流阶段 |
| `pm workflow next-action <task-id>` | 获取任务的下一步操作 |
| `pm workflow project-status <project-id>` | 获取项目内所有任务的工作流状态 |
| `pm workflow add-dependency` | 添加任务依赖关系 |
| `pm workflow dependencies <task-id>` | 查看任务的依赖列表 |

**`pm workflow start` 选项：**

| 选项 | 说明 |
|------|------|
| `--task-id` | 任务 ID（必填） |
| `--template-id` | 工作流模板 ID（必填） |

**`pm workflow add-dependency` 选项：**

| 选项 | 说明 |
|------|------|
| `--task-id` | 被依赖的任务 ID（必填） |
| `--depends-on` | 前置任务 ID（必填） |
| `--type` | 依赖类型（默认 finish_to_start） |

---

## pm report — 进度报告

API 端点前缀：`/progress/reports`

| 命令 | 说明 |
|------|------|
| `pm report list <project-id>` | 列出项目的进度报告 |
| `pm report get <id>` | 查看报告详情及内容 |
| `pm report generate <project-id>` | 触发 AI 自动生成进度报告 |
| `pm report update <id>` | 更新报告标题或内容 |
| `pm report publish <id>` | 发布报告 |
| `pm report archive <id>` | 归档报告 |
| `pm report delete <id>` | 软删除报告（需 `-f` 确认） |

---

## pm tag — 标签管理

API 端点前缀：`/progress/tags`

| 命令 | 说明 |
|------|------|
| `pm tag list` | 列出所有标签（系统标签 + 用户标签） |
| `pm tag create` | 创建用户自定义标签 |
| `pm tag delete <id>` | 删除用户标签（需 `-f` 确认） |

**`pm tag list` 选项：**

| 选项 | 说明 |
|------|------|
| `--system` | 只显示系统标签 |
| `--user` | 只显示用户标签 |
| `--json` | JSON 格式输出 |

**`pm tag create` 选项：**

| 选项 | 说明 |
|------|------|
| `--name` | 标签名称（必填） |
| `--color` | 标签颜色（如 #FF5733） |

---

## pm health — 产品健康度

API 端点前缀：`/progress/products/{productId}`（需登录 + 产品所属组织成员）。对应后端 C1 + C2（`api-0090`）；C2（预测、成本、What-if、诊断、管理报告）见本节末尾「进度智能」。

| 命令 | 说明 |
|------|------|
| `pm health <productId>` | 产品健康度 KPI：进度、工作量口径、范围基线与增长、加权进度、阻塞占比、AI 贡献、速度与预计完成日期 |
| `pm health modules <productId>` | 各模块进度（按延期天数降序，含加权进度；表尾注明加权进度口径） |
| `pm health baseline <productId> [--note <text>]` | 把**当前**范围快照为新基线（备注 ≤500 字符） |
| `pm health config get <productId>` | 读进度配置：工作量口径 + 各任务状态的默认 / 生效 / 覆盖完成度（从未配置则显示默认值） |
| `pm health config set <productId> --basis <B> [--status-completion s=n,...]` | **整体替换**配置（仅组织 owner/admin）。`--basis`：`ESTIMATED_HOURS` \| `STORY_POINT` \| `WEIGHT`（不区分大小写）；`--status-completion` 形如 `in_progress=30,blocked=50`（0–100；状态取 not_started / pending_agent / pending_info / awaiting_plan_approval / in_progress / paused / awaiting_completion_approval / blocked，`completed` / `cancelled` 不可覆盖）。**省略 `--status-completion` 会清空已有覆盖** |
| `pm health scope-changes <productId>` | 范围变更历史（新的在前；`auto` 由每日快照自动写入，`manual` 为手动记录）；`--release <id>` `-p/--page` `--page-size`（≤100，默认 20） |
| `pm health scope-change add <productId> --delta <±n> --reason <text>` | 手动记录一笔范围变更（任一成员）；`--delta` 非零有符号数，`--reason` ≤500 字符，`--release <id>` 归到某个 Release |
| `pm health scope-change annotate <id> --reason <text>` | 为任一条范围变更（含自动写入的）补充 / 修改原因（≤500 字符） |
| `pm health burnup <productId>` | 每日 范围 / 已完成 / 剩余：表格 + 文本走势图（`▁▂▃▄▅▆▇█`，范围 vs 已完成；超过 60 点时走势图抽样，表格保留全部）+ 完成度条；`--from` `--to`（`yyyy-MM-dd`，跨度 ≤366 天，默认最近 30 天）`--release <id>` |
| `pm health snapshots rebuild <productId> [--days N]` | 从任务历史补齐缺失的每日快照（仅 owner/admin；`--days` 1–90，默认 30；已有快照不覆盖；已删除任务无法还原） |

所有命令支持 `--json`（可放在子命令前或后）。后端算不出来的字段（无基线、无计划日期、数据不足等）显示为 `—`，绝不显示为 0；`velocityDataStatus=INSUFFICIENT_DATA` 时「预计完成」显示 `数据不足`，不给日期。
KPI 输出新增「工作量口径」「速度与预测」两段，并在以下情况给出 `⚠` 提示：有任务缺少所选口径的取值而回退到下一级（`basisFallbackTaskCount>0`，单位混合）；基线口径与当前口径不同（`baselineBasisMismatch`，此时基线范围 / 范围变化 / 范围增长 / 基线进度 的单位是基线口径，重设基线即可迁移）。

业务错误码：
- 旧端点（`health` / `modules` / `baseline`）：`40480` 产品不存在、`40380` 非组织成员、`40080` 备注过长。
- 新端点（其余命令）：`1000` 缺必填、`1001` 参数不合法（服务端消息会一并显示）、`1002` 产品 / Release / 记录不存在、`1008` 缺 Release id、`2000` 非成员（写配置 / 重建快照需 owner/admin）。
- 以上均为 HTTP 200 + 非 200 `code`；`999` = 未登录。

所有必填项、枚举、长度、范围在调用 API 前于 CLI 端校验；无任何确认提示。

```bash
good7ob pm health 10
good7ob pm health modules 10 --json
good7ob pm health baseline 10 --note "Q4 范围冻结"
good7ob pm health config get 10
good7ob pm health config set 10 --basis STORY_POINT --status-completion in_progress=40,blocked=10
good7ob pm health scope-changes 10 --release 5 -p 2
good7ob pm health scope-change add 10 --delta -12.5 --reason "砍掉导出功能" --release 5
good7ob pm health scope-change annotate 3 --reason "客户追加需求"
good7ob pm health burnup 10 --from 2026-09-01 --to 2026-09-19
good7ob pm health snapshots rebuild 10 --days 14
```

### 进度智能（C2）：预测 / 成本 / What-if / 诊断 / 解读 / 管理报告

对应后端 `api-0090` §8–§13（`ProductIntelligenceController`）。读 = 产品所属组织成员；**预算与成本条目的写入 = 组织 owner/admin**（否则 `2000`）。所有命令支持 `--json`（可放在子命令前或后），无任何确认提示，空值 / 算不出的值显示 `—`，绝不显示为 0。

| 命令 | 说明 |
|------|------|
| `pm health forecast <productId> [--release <id>]` | P50/P80 完成预测（按历史周速度蒙特卡洛，同一份数据结果固定）：预计完成日期、还需周数、相对计划的偏差（晚 / 早 N 天）、周完成量走势。**历史不足（`INSUFFICIENT_DATA`）时显示 `数据不足`，绝不给日期**；某分位 520 周内无法完成显示 `不收敛` |
| `pm health cost <productId> [--release <id>]` | 成本进度：预算、实际（按类别 + 推导人力，推导的会标明「非手工录入」）、剩余预算、开发 / 时间 / 成本三条进度线、成本偏差（正 = 成本消耗快于交付）、完工估算 EAC。`NO_BUDGET`（无预算）仍列出实际成本；`INSUFFICIENT_DATA`（含同范围多币种）不求和。`aiTokensConsumed` 是 token **数量**不是金额，`ai_token` 成本只能手工录入 |
| `pm health budget get <productId> [--release <id>]` | 读预算（未设置会明确提示） |
| `pm health budget set <productId> --amount <n> --currency <C> [--labor-rate <n>] [--note <text>] [--release <id>]` | 设置 / 替换预算（owner/admin，幂等）。`--amount` > 0、最多 2 位小数、≤ 9999999999.99；`--currency` 3 位字母（自动大写；**一个产品只能用一种币种**，首次写入决定）；`--labor-rate` (0, 100000]，用于把任务实际工时推导成人力成本；`--note` ≤500 字符；`--release` 设 Release 级预算 |
| `pm health budget clear <productId> [--release <id>]` | 删除预算（owner/admin；之后可重设） |
| `pm health cost-entry list <productId> [--category c] [--release <id>] [--from d] [--to d] [-p n] [--page-size n]` | 成本条目，发生日新的在前；`--category` `labor｜cloud｜ai_token｜other`；`--from/--to`（`yyyy-MM-dd`，闭区间，`--from ≤ --to`）；`--page-size` ≤100（默认 20）。`source=auto` 的条目只读 |
| `pm health cost-entry add <productId> --category c --amount n --currency C --date yyyy-MM-dd [--release <id>] [--note <text>]` | 记录一笔实际成本（owner/admin）。`--date` 为 2000-01-01 ~ 明天（UTC）；币种须与该产品已有币种一致（否则 `1001`） |
| `pm health cost-entry update <id> --category … --amount … --currency … --date … [--release] [--note]` | **整体替换**一条手工条目（四个必填项都要给；省略 `--release` / `--note` 即清空它们）。`auto` 条目不可改（`1007`） |
| `pm health cost-entry delete <id>` | 删除一条手工条目（`auto` 条目不可删，`1007`） |
| `pm health what-if <productId> [--add-scope n] [--remove-scope n] [--velocity-multiplier x] [--extra-capacity n] [--deadline d] [--release <id>]` | What-if 模拟（**纯计算，不保存任何数据**）：基线 vs 场景的 P50/P80 日期、变化天数（提前 / 延后）、目标日期是否赶得上、成本影响。`--add-scope` / `--remove-scope` 0–1e9（移出只能移出未完成部分）；`--velocity-multiplier` 0.1–10；`--extra-capacity` 0–1e6（每周额外产能，「加人 / 加 AI」的抽象量）；`--deadline` 2000-01-01 ~ 2100-01-01。不带任何参数 = 场景等于基线（后端会给出提示） |
| `pm health diagnosis <productId> [--release <id>]` | 确定性诊断（**非 AI**）：总体严重度、发现清单（级别 / 代码 / 说明）、事实（加权进度、时间进度、加权延期、速度趋势、阻塞占比、范围增长、各模块延期贡献） |
| `pm health explain <productId> [--release <id>] [--question <text>]` | AI 解读（**AI 生成，需人工确认**，输出里会明确标注；消耗 AI token）。`--question` ≤500 字符（缺省 = 「为什么进度是现在这样？下一步该做什么？」）。AI 不可用（无余额 / 配额 / 密钥、调用失败）时后端仍返回 HTTP 200，CLI 显示原因并照常给出确定性发现；10 分钟内相同事实 + 问题命中缓存（`缓存命中`，不再扣费）。客户端超时 180 秒，超时会提示服务端可能仍在处理 |
| `pm health report generate <productId> --period week｜month｜custom [--from d] [--to d] [--release <id>] [--ai]` | 生成并保存一份管理报告（任一成员）。`week` / `month`：不给 `--from` = 上一个**完整**周（周一至周日）/ 月；给 `--from` = 其所在的周 / 月（不接受 `--to`）；`custom`：`--from` 与 `--to` 必填，`--from ≤ --to`，含首尾 ≤92 天，`--to` 不晚于今天（UTC）。`--ai` 在顶部加一节 AI 摘要（AI 生成，需人工确认；失败时报告照常生成并显示 `⚠ AI 摘要未生成` 及原因）。输出报告元信息 + Markdown 全文 |
| `pm health report list <productId> [--release <id>] [--period week｜month｜custom] [-p n] [--page-size n]` | 已保存的报告（新的在前，不含正文）；`--page-size` ≤100（默认 20） |
| `pm health report get <id> [--out file.md]` | 报告详情：元信息 + Markdown 全文；`--out` 把 Markdown 写入文件（覆盖已存在的文件，目录须已存在；写文件时终端只显示元信息和路径）。`--json` 另含结构化分节（`structured`） |

业务错误码（HTTP 200 + 非 200 `code`，服务端消息会一并显示）：`1000` 缺必填、`1001` 参数不合法（数值 / 日期越界、混币种、Release 不属于该产品、报告期不合法、问题超长）、`1002` 产品 / Release / 预算 / 条目 / 报告不存在、`1007` 自动入账（`auto`）条目只读、`2000` 无权限（非成员；写预算 / 成本需 owner/admin）、`999` 未登录。
所有必填项、枚举、长度、范围、日期在调用 API 前于 CLI 端校验（金额多于 2 位小数会被拒绝而不是被后端悄悄四舍五入）；`report generate` 的日期 / 区间规则与后端 `ReportPeriod` 一致。

```bash
good7ob pm health forecast 10
good7ob pm health cost 10 --release 5
good7ob pm health budget set 10 --amount 10000000 --currency CNY --labor-rate 200 --note "2026 H2"
good7ob pm health cost-entry add 10 --category cloud --amount 1200.50 --currency CNY --date 2026-09-01 --note EKS
good7ob pm health cost-entry list 10 --category cloud --from 2026-09-01 --to 2026-09-30
good7ob pm health cost-entry update 9 --category cloud --amount 1300 --currency CNY --date 2026-09-01
good7ob pm health what-if 10 --add-scope 100 --velocity-multiplier 1.5 --deadline 2026-12-01
good7ob pm health diagnosis 10
good7ob pm health explain 10 --question "为什么延期？"
good7ob pm health report generate 10 --period week --ai
good7ob pm health report list 10 --period custom
good7ob pm health report get 7 --out weekly.md
```

---

## idea — Idea 池

API 端点前缀：`/forge/ideas`（需登录 + 该 Idea 所属产品的组织成员）。契约见 api-0088（good7ob-forge-idea-management）。
状态：draft / evaluating / approved / rejected / archived / planning / developing / released / validated。`approved` / `rejected` 只能经 `idea select` / `idea reject` 到达；自 approved 起 Idea 自身字段锁定（错误码 1007），但 `--release` 在 approved / planning / developing 仍可改；方案仅 draft / evaluating 可增改删。

| 命令 | 说明 |
|------|------|
| `idea list --product <id>` | 列表；`--status` `-k/--keyword` `--tag <标签>`（精确、不区分大小写）`--release <发布ID>` `-p/--page` `--page-size`（≤100） |
| `idea get <id>` | 详情：发布、标签；方案并排对比（成本/周期/预期效果/是否选中）；有结构化估算时另出「估算对比」表（总人日及各角色人日、预计成本、月度成本、周期、技术/产品风险、可信度 + `[AI 估算]` 标记、预期效果、KPI、落选原因）；决策行（选定方案、理由、审批状态/审批单）；已批准时显示关联需求 ID |
| `idea create --product <id> --title <t> --source <s>` | 创建（始终 draft）；`--priority` `--description` `--expected-value` |
| `idea update <id>` | 修改（未给的字段保持不变）；`--release <发布ID>` 关联发布（须同产品且 planned / in_progress / awaiting_approval），`--clear-release` 解除（两者互斥） |
| `idea delete <id>` | 软删除（可用 `idea restore` 恢复） |
| `idea restore <id>` | 恢复：已删除 → 取消删除；已归档且未生成需求 → draft |
| `idea status <id> <evaluating\|archived\|planning\|developing\|released\|validated>` | 状态流转（合法路径 draft→evaluating→approved→planning→developing→released→validated，任意态可→archived；released 通常由 Release 发布自动同步） |
| `idea reject <id> --reason <text>` | 驳回（evaluating → rejected） |
| `idea solution add <ideaId> --name <n>` | 添加方案；备注类 `--description` `--cost-note` `--cycle-note` `--effect-note`；结构化估算见下 |
| `idea solution update <ideaId> <solutionId>` | 修改方案（未给的字段不变；`--kpi` 整体替换 KPI 列表，`--clear-kpi` 清空） |
| `idea solution delete <ideaId> <solutionId>` | 删除方案 |
| `idea select <ideaId> <solutionId> --reason <text>` | 选定方案：Idea 变 approved，并在需求收件箱创建需求；`--rejected-reason <方案ID>:<原因>`（可重复，写入落选方案的 rejectionReason）；`--require-approval` 改为发起 `IDEA_DECISION` 审批，Idea 保持 evaluating，批准后才生成需求 |
| `idea merge <id> --into <目标ID>` | 把本 Idea（源）并入目标：迁移方案/评论/附件/标签，源归档，并建立 duplicate_of 关联；要求同产品、双方 draft/evaluating、均无待审批决策 |
| `idea duplicates <id> [--limit N]` | 同产品内标题相似的 Idea（相似度 0–1）；`--limit` 1–20，默认 5 |
| `idea comment add <id> --text <t>` | 发表评论；`--parent <评论ID>` 回复同一 Idea 的评论；≤2000 字符 |
| `idea comment list <id>` | 评论列表（时间正序）；`-p/--page` `--page-size`（≤100） |
| `idea comment delete <id> <commentId>` | 删除评论（作者或组织 owner/admin） |
| `idea attachment add <id> --name <n> --url <u> --size <bytes>` | 登记附件元数据（文件须先经 `POST /file/upload2s3` 上传，把返回的 fileUrl 填到 `--url`）；`--content-type`；每个 Idea 最多 20 个，单个 ≤20 MiB |
| `idea attachment list <id>` | 附件列表 |
| `idea attachment delete <id> <attachmentId>` | 取消登记（不删 S3 对象；登记人或组织 owner/admin） |
| `idea tag set <id> --tags a,b,c` | **整体替换**标签集；最多 10 个、每个 1–30 字符；去空白、转小写、去重；`--tags ""` 清空 |
| `idea relation add <id> --to <ideaId> --type <t>` | 建立 `<id> —type→ to` 关联；`--type`：related\|duplicate_of\|blocks；同产品、不能自关联、重复报 1006 |
| `idea relation list <id>` | 双向关联列表（→ 本 Idea 指向对方，← 对方指向本 Idea） |
| `idea relation remove <id> <relationId>` | 删除关联（任一端 Idea 的成员均可） |

**方案结构化估算**（`idea solution add|update` 的可选参数，未给的不发送；全部在 CLI 侧先校验范围/小数位）：

| 参数 | 含义 / 限制 |
|------|------------|
| `--effort-frontend` `--effort-backend` `--effort-ai` `--effort-test` `--effort-pm` | 各角色人日，0–99999.9，1 位小数；`get` 里的「总人日」由后端按五项非空值求和，不能写入 |
| `--cost` | 预计总成本，0–9999999999.99，2 位小数 |
| `--cloud-cost` `--token-cost` `--maintenance-cost` | 云资源 / AI token / 维护成本，**每月**，2 位小数 |
| `--cycle-weeks` | 周期（周），0–999.9，1 位小数 |
| `--technical-risk` `--product-risk` `--confidence` | low\|medium\|high |
| `--estimation-source` | manual（默认）\|ai；ai 时 `get` 在可信度旁标 `[AI 估算]` |
| `--expected-effect` | 预期效果，≤2000 字符（与 ≤500 的 `--effect-note` 备注不同） |
| `--kpi "name:current:target:unit"` | 效果指标，可重复，最多 20 项；只有 name 必填（≤100），current/target ≤100，unit ≤20；各段内不能含冒号 |

`--source`：customer|feedback|pm|dev|ai|ops|bug|competitor|market|management；`--priority`：low|medium|high。
`--product` 缺省读环境变量 `GOOD7OB_PRODUCT_ID`。长度上限：标题/方案名 200，预期价值/方案备注 500，原因 1000，评论 2000。
`--url`（附件）形态：`https://<bucket>.s3[.-<region>].amazonaws.com/public/...`，无查询串 / `#` / 用户信息 / `..`；桶名由服务端配置，CLI 只校验形态。
所有命令支持 `--json`（删除类命令只输出确认行）；无确认提示。空值一律显示 `—`。
业务错误码（HTTP 200 + 非 200 `code`）：`1000` 缺参、`1001` 值非法、`1002` 不存在、`1006` 已存在（关联重复 / 已有待审批决策）、`1007` 状态不允许、`1008` 缺 id、`1009` 并发冲突（重试）、`2000` 无权限、`999/401` 未登录。

```bash
good7ob idea create --product 3 --title "订单导出" --source customer --priority high
good7ob idea status 12 evaluating
good7ob idea solution add 12 --name "前端导出" --cost-note "2 人天" --cycle-note "1 周"
good7ob idea solution add 12 --name "后端异步导出" --effort-frontend 2 --effort-backend 5 --effort-test 2 \
  --cost 30000 --cloud-cost 120 --cycle-weeks 3 --technical-risk medium --confidence medium \
  --expected-effect "对账耗时下降 60%" --kpi "对账耗时:5h:2h:小时"
good7ob idea get 12                                    # 方案并排 + 估算对比 + 决策
good7ob idea select 12 34 --reason "成本最低" --rejected-reason 35:周期过长   # → 需求收件箱出现新需求
good7ob idea select 12 34 --reason "成本最低" --require-approval             # → 待审批，Idea 仍是 evaluating
good7ob idea tag set 12 --tags backend,ai
good7ob idea duplicates 12 && good7ob idea merge 13 --into 12
good7ob idea comment add 12 --text "先做后端方案"
good7ob idea relation add 12 --to 15 --type blocks
good7ob idea update 12 --release 7 && good7ob idea list --product 3 --release 7 --tag backend
```

### A2：AI 生成方案、估算修正、变更集、效果复盘

契约见 api-0088 §4~§6（后端 PR #264）。所有命令支持 `--json`、无确认提示、空值显示 `—`，且在 CLI 侧先校验枚举 / 长度 / 范围（失败即退出码 1，不发请求）。

**AI 生成方案与估算修正**

| 命令 | 说明 |
|------|------|
| `idea generate <ideaId> [--count 2..4] [--hints <text>]` | AI 一次生成 2~4 个（默认 3）带估算的候选方案，单事务写入；仅 draft / evaluating 的 Idea（否则 1007）；`--hints` ≤1000 字符。**消耗 token / 月度配额**，客户端超时放宽到 180 s；超时时提示服务端可能仍在处理并已计费，先 `idea get` 核对再重试。输出标 `[AI 估算]`，附估算对比表、本次采用的修正系数、模型与 token 用量。AI 数值只是估算，须人工核对（`idea solution update`，可 `--estimation-source manual`）后再 `idea select` |
| `idea correction <productId>` | 产品的估算修正系数（人日 / 周期 / 成本）：已完成复盘中 实际 ÷ 预期 的均值，限幅 0.5~3.0；样本 <3 时系数恒为 1.000 并标「历史样本不足」 |

AI 错误码（调用失败时**无写入、不扣 token**）：`7101` 模型调用失败、`7102` 调用超时、`7103` 输出无法解析 / 字段不合法（服务端 msg 指出第几个方案的哪个字段）、`7104` 本月 API 配额用完、`7105` Token 余额不足（<15000）。

**变更集**（`idea change-set ...`）：把已批准 Idea 的选定方案落成「受影响对象清单」→ 审批 → Apply 成任务。状态：draft → impact_analyzed → pending_approval → approved → applied；draft / impact_analyzed / approved 可 cancel（`rejected` 为预留值，A2 不产生：审批被驳回 / 撤销后回到 impact_analyzed）。

| 命令 | 说明 |
|------|------|
| `idea change-set create <ideaId> --title <t> [--solution <id>] [--summary <s>]` | 创建 draft 变更集（Idea 须 approved / planning，否则 1007）；标题 ≤200、摘要 ≤2000；`--solution` 缺省取选定方案 |
| `idea change-set list [--idea <id> \| --product <id>] [--status <s>] [-p/--page] [--page-size]` | 倒序列表；`--idea` 与 `--product` 二选一（`--product` 缺省读 `GOOD7OB_PRODUCT_ID`）；`--status`：draft\|impact_analyzed\|pending_approval\|approved\|applied\|rejected\|cancelled；`--page-size` ≤100 |
| `idea change-set get <id>` | 详情 + 条目表（类型 / 变更 / 对象 / 说明 / 来源 / 可信度 / 是否已确认 / 生成的任务） |
| `idea change-set update <id> [--title <t>] [--summary <s>]` | 改标题 / 摘要（至少一个；仅 draft / impact_analyzed） |
| `idea change-set item add <id> --type <T> --kind <k> --description <d> (--object-id <n> \| --object-ref <r>)` | 加手工条目（加入即已确认）。`--type`：PRD\|FP\|RP\|UI\|API\|DB\|ARCH\|TEST_CASE\|TASK\|OTHER（不区分大小写）；`--kind`：add\|update\|remove；`--description` ≤1000；`--object-ref` ≤300；`--object-id` 与 `--object-ref` **至少给一个**（可同时给）；同一对象在同一变更集内只能有一条（1006） |
| `idea change-set item update <id> <itemId> [--type --kind --description --object-id --object-ref]` | 改条目（未给的不变，至少一个；不改确认状态）；仅 draft / impact_analyzed |
| `idea change-set item remove <id> <itemId>` | 删条目（软删除） |
| `idea change-set item confirm <id> <itemId> [--no]` | 确认条目；`--no` 取消确认。只有已确认条目会计入 submit / apply |
| `idea change-set analyze <id>` | 影响分析：沿追溯关系（≤2 跳）+ AI 建议**只追加**条目（均未确认）。AI 失败不报错，降级为仅追溯并打印 `⚠ 告警`；客户端超时同样放宽到 180 s |
| `idea change-set submit <id>` | 提交审批（须 impact_analyzed 且至少 1 个已确认条目）；打印审批单 ID，审批人 = 组织 owner / admin，走 `good7ob approval ...` |
| `idea change-set apply <id> [--module <id>]` | Apply（须 approved，原子且幂等）：为每个已确认条目建一个人工任务 + 追溯关系，Idea approved → planning。`--module` 缺省自动建 `Change <code>` 模块。打印任务列表、追溯条数、Idea 状态。**只生成任务与追溯，不会自动修改 PRD / UI / API / DB 文档** |
| `idea change-set cancel <id>` | 取消（审批中的须先撤销审批） |

**效果复盘**（`idea review ...`，每个 Idea 至多一条）：

| 命令 | 说明 |
|------|------|
| `idea review start <ideaId>` | 创建 / 刷新草稿：快照选定方案的预期，重新收集实际值（Idea 须 planning / developing / released；已完成的复盘不可刷新） |
| `idea review get <ideaId>` | 预期（AI 方案同时显示修正前原值）、实际、准确度（草稿实时计算，完成后冻结）、手工指标。实际值 `—` = 不可得（不是 0）；成本暂无可推导口径，恒为 `—` |
| `idea review metrics <ideaId> [--metric "name:expected:actual:unit"]... [--clear-metrics] [--notes <n>]` | 填手工指标（**整体替换**，可重复，≤20）与备注（≤2000，`--notes ""` 清空）；至少给一项。`--metric`：只有 name 必填（≤100）；expected / actual 留空 = 不可得（如 `NPS:40::pts`），可为负数、≤4 位小数；unit ≤20；各段内不能含冒号；仅草稿可改 |
| `idea review complete <ideaId>` | 完成：冻结准确度，Idea released → validated，重算该产品的估算修正系数（Idea 须 released） |

A2 业务错误码在 A1 基础上：变更集 `1007`（创建要求 Idea approved / planning；改条目仅 draft / impact_analyzed；提交要求已确认条目；Apply 要求 approved 且未 Apply），`2000`（Apply 另要求 owner / admin 或创建人）；复盘 `1002` 表示尚无复盘（先 `idea review start`）。

```bash
good7ob idea generate 21 --count 3 --hints "面向中小企业，优先复用现有导出组件"
good7ob idea correction 12
good7ob idea select 21 41 --reason "成本最低"
good7ob idea change-set create 21 --title "订单导出落地" --summary "按方案 A 实施"
good7ob idea change-set item add 5 --type API --kind add --description "新增导出接口" --object-ref "POST /orders/export"
good7ob idea change-set analyze 5                       # 追加追溯 / AI 条目（未确认）
good7ob idea change-set item confirm 5 11               # 逐条确认；--no 取消
good7ob idea change-set submit 5 && good7ob approval get 8
good7ob idea change-set apply 5 --module 40             # 生成任务 + 追溯，不改文档
good7ob idea review start 21
good7ob idea review metrics 21 --metric "对账耗时:2:3:小时" --metric "NPS:40::pts" --notes "首月数据"
good7ob idea review complete 21                         # released → validated，重算修正系数
```

---

## workspace — 我的工作台

API 端点前缀：`/workspace`（需登录）。这里不叫 inbox —— 在本 CLI 里 inbox 指需求收件箱状态（`good7ob req`）。

### 待办队列（等待我处理的事项）

来源：我负责的等待态任务、未读消息、我创建的 inbox 需求、我能决定的审批、我所在组织的高风险产品。
动作类型：`PLAN_APPROVAL` 计划审批 / `COMPLETION_APPROVAL` 完成审批 / `INFO_REQUEST` 信息请求 / `BLOCKED` 已阻塞 / `PAUSED` 已暂停 / `SYSTEM_ALERT` 系统提醒 / `REQUIREMENT_TRIAGE` 需求分诊 / `APPROVAL` 审批申请 / `RISK_ALERT` 风险预警。
状态：new / in_progress / waiting / snoozed / dismissed / done（到期的 snooze 读作 new）。

| 命令 | 说明 |
|------|------|
| `workspace queue` | 队列列表，默认新的在前；`-l/--limit` 1–200（默认 50）、`--status`（active｜snoozed｜dismissed｜done｜all｜new｜in_progress｜waiting，默认 active）、`--action-type`、`--product <id>`、`--sort newest｜score`（`score` = 按优先分从高到低，同分截止早的在前，无截止最后；先排序再取 `--limit`）。后端返回 `priorityScore` 时表格多一列「优先分」（0 显示 0，没有显示 `—`），旧后端不显示这一列 |
| `workspace queue counts` | 计数：活跃总数与各动作类型，以及已稍后 / 已忽略 / 已完成 |
| `workspace queue dismiss <id>` | 忽略（来源仍在时保持忽略；幂等；已完成的项不行） |
| `workspace queue done <id>` | 标记已处理（幂等） |
| `workspace queue reopen <id>` | 把已忽略 / 已稍后 / 已完成的项变回 new（对活跃项无操作） |
| `workspace queue snooze <id> --until <time>` | 稍后处理；`--until` 是 ISO 日期时间（`2026-09-20T09:00:00Z`、`2026-09-20T17:00:00+08:00`；**无时区按 UTC**）或相对时间 `+30m` / `+2h` / `+1d`；必须晚于现在且不超过 30 天；可对已稍后的项重设时间 |
| `workspace queue approve <id>` | 就地批准：审批申请 / 任务计划（会**同步恢复 Agent 执行**，可能较慢）/ 任务完成；`--comment` 可选（只对审批申请记录） |
| `workspace queue reject <id> --comment <text>` | 就地驳回；`--comment` 必填（不能为空白） |

`<id>` 是列表第一列 **ID（队列项 id）**，不是来源对象的 id（`来源ID` 列）。列表先显示各动作类型计数（总数与计数不受 `--limit` 影响，也不受 `--action-type` 影响），再列出事项表；已稍后的项在“到期/稍后”列显示 `稍后至 … UTC`，任务显示截止时间。
`approve` / `reject` 只对活跃项、且类型有就地审批（审批申请 / 计划审批 / 完成审批）；其他类型（阻塞、信息请求、风险预警等）返回 `1007`，需到来源对象处理。成功后该项自动置 done。
`approve` 若客户端超时（默认 30 秒，Agent 执行可能更久），CLI 会提示服务端可能仍在处理，先用 `queue --status all` 核对，不要盲目重试。

### 总览与“我的”视图

| 命令 | 说明 |
|------|------|
| `workspace overview` | 一屏总览：队列计数、任务分组计数、开放任务最多的前 5 个产品、我的 AI 团队（各状态人数 + 最需要关注的员工）、最近动态；某一块加载失败时该块显示“（加载失败）”并在末尾列出 |
| `workspace tasks` | 不带 `--group`：开放任务摘要（今日 / 进行中 / 待审批 / 已逾期）+ 最紧急的几个（`-l/--limit` 1–50，默认 5） |
| `workspace tasks --group <g>` | 某分组一页：`today`｜`todo`｜`in_progress`｜`waiting`｜`blocked`｜`done`；`-p/--page`（默认 1）`--page-size`（1–100，默认 20）；各分组计数会重叠，不可相加 |
| `workspace products` | 我的产品卡片：我的开放任务、产品内阻塞数 / AI 执行中数、进度与风险；`--scope all｜owned｜participating｜following｜archived`（默认 all，最多 50 张；进度/风险只评估前 20 张，其余显示 —） |
| `workspace product follow <productId>` | 关注产品（幂等；仅产品所属组织的 active 成员） |
| `workspace product unfollow <productId>` | 取消关注（幂等，只影响自己） |
| `workspace orgs` | 我所在的组织：我的角色、成员 / AI 员工 / 产品 / 活跃任务数 |

所有命令支持 `--json`（`product follow|unfollow` 后端无返回，`--json` 输出 `{"productId":N,"following":true|false}`），无二次确认；空值一律显示 `—`（不会显示成 0）。
参数在 CLI 端先校验（枚举、范围、id 为正整数、snooze 时间），错误不发请求。`--group` 与 `--page/--page-size`、不带 `--group` 与 `--limit` 的组合被拒绝而不是被悄悄忽略。
业务错误码：`1000` 缺参、`1001` 值非法、`1002` 不存在（队列项不存在或不属于你 / 任务无待审批计划 / 产品不存在）、`1007` 状态不允许（对已完成 / 已忽略的项 dismiss·snooze，或该类型不能就地决定）、`1009` 已被他人处理（并发）、`2000` 无权限（审批需组织 owner/admin；任务门禁需责任人 / 创建人 / owner；关注非成员产品）、`400/999/401` 未登录。

```bash
good7ob workspace queue --status active --action-type PLAN_APPROVAL
good7ob workspace queue counts
good7ob workspace queue snooze 501 --until +2h          # 或 2026-09-20T17:00:00+08:00
good7ob workspace queue approve 501 --comment "LGTM"
good7ob workspace queue reject 502 --comment "范围不清，补充后重提"
good7ob workspace queue dismiss 503 && good7ob workspace queue reopen 503
good7ob workspace overview
good7ob workspace tasks --group waiting -p 2 --page-size 50
good7ob workspace products --scope following
good7ob workspace product follow 12
good7ob workspace orgs --json
```

### 我的 AI 团队 / AI 日报 / 下一步推荐（B2）

对应后端 `api-0089` §7–§9（`WorkspaceAiController`），都在 `/workspace` 下；只看自己所在组织（active 成员）的数据。

| 命令 | 说明 |
|------|------|
| `workspace ai-team [--status s] [--org <id>]` | 我的 AI 员工：状态（工作中 / 等待中 / 异常 / 空闲，异常会标注原因：有阻塞任务 / 最近工作记录失败）、当前任务（≤5，表里显示第一个 + `+N`）、排队任务数、累计统计（完成数、成功率、工时、tokens、说明充分度、被驳回数、阻塞次数）。`--status` `working｜waiting｜error｜idle｜all`（默认 all，不区分大小写）；`--org` 必须是你所在的组织（否则 `2000`）。各状态人数不受 `--status` 影响 |
| `workspace ai-team log <employeeId> [--from t] [--to t] [-p n] [--page-size n]` | 一个 AI 员工的时间线（新的在前）：工作记录 / 状态变更 / 评论 / 评审。`--from` / `--to` 为 `yyyy-MM-dd`（`--to` 取当天结束）或 `yyyy-MM-ddTHH:mm[:ss]`（服务器本地时间，无时区）；默认最近 7 天；两端都给时范围 ≤31 天且 `--from ≤ --to`；`--page-size` ≤100（默认 20） |
| `workspace daily-report [--date d]` | 读已保存的 AI 日报（默认今天；`--date` 为 `yyyy-MM-dd`，不能晚于今天）。**还没有 → `1002`，CLI 提示用 `daily-report generate` 生成**。输出来源（`template` 确定性 / `ai`）、生成时间、Markdown 全文；`--json` 另含结构化分节（`sections`） |
| `workspace daily-report generate [--date d] [--ai]` | 生成或**重新生成**该日期的日报（同一天只有一份，会替换已存的）。`--ai` 加一段 AI 叙述总结（AI 生成，需人工确认；配额不足 / 调用失败时降级为确定性日报并显示 `⚠ 未能使用 AI` 及原因）。带 `--ai` 时客户端超时 180 秒 |
| `workspace next-actions [-l n]` | 「现在先做哪几件事」：按得分排序（确定性规则、无 AI），每项给出得分、类型（队列项 / 任务）、队列项 / 任务 id、动作、优先级、到期时间和逐条理由（`--json` 另含机器可读的 `factors`）。`-l/--limit` 1–20（默认 5）。队列项可直接用 `workspace queue approve｜reject｜dismiss｜snooze <队列项id>` 处理 |

统计口径：累计值，只含执行者登记为 `emp:<员工id>` 的任务（默认 Agent、外部 Agent 名无法归属，不计入）；成功率 = 完成 /（完成 + 被驳回 + 阻塞），分母为 0 时显示 `—`；「说明充分度」是交给员工的任务说明是否充分，**不是员工质量评分**；`cost` 后端恒为 null（没有 token 单价来源），CLI 不显示成本列。
业务错误码：`400/999/401` 未登录、`1001` 参数不合法（status 未知、work-log 时间格式错 / 范围超 31 天、日报日期错或晚于今天）、`1002` 不存在（AI 员工不存在或不在你的组织里 / 该日期还没有日报）、`2000` `--org` 不是你所在的组织。
`--date` 的「不晚于今天」CLI 只拒绝比 UTC 明天还晚的日期（服务端按自己的时区判断「今天」，边界由服务端裁决）；`--from/--to` 等参数在调用 API 前于 CLI 端校验，错误不发请求。

```bash
good7ob workspace ai-team --status error
good7ob workspace ai-team log 7 --from 2026-09-12 --to 2026-09-19 -p 2
good7ob workspace daily-report --date 2026-09-18
good7ob workspace daily-report generate --ai
good7ob workspace next-actions --limit 10
good7ob workspace queue --sort score --limit 20
```

---

## release — 发布管理

API 端点前缀：`/forge/releases`（需登录 + 产品所属组织成员）。
状态：planned → in_progress → awaiting_approval → released（planned / in_progress 可 cancel → cancelled）。
批准/驳回发布走 `approval approve|reject`，不在这里。

| 命令 | 说明 |
|------|------|
| `release list --product <id>` | 该产品全部发布（不分页，新的在前）；`--status` |
| `release get <id>` | 详情；待审批时显示 `pendingApprovalId` |
| `release create --product <id> --name <n> --version <v>` | 创建（始终 planned，版本号在产品内唯一）；`--description` `--start` `--end`（`yyyy-MM-dd`） |
| `release update <id>` | 修改（未给的字段保持不变，仅 planned / in_progress）；`--name` `--version` `--description` `--start` `--end` |
| `release delete <id>` | 软删除并解除任务关联（仅 planned / cancelled） |
| `release start <id>` | planned → in_progress |
| `release request-approval <id>` | in_progress → awaiting_approval，同时创建一条 `RELEASE` 审批；`--description` 给审批人的说明 |
| `release cancel <id>` | planned / in_progress → cancelled |
| `release tasks <id>` | 该发布下的任务（状态、进度、项目、负责人） |
| `release tasks add <id> --task-ids 1,2,3` | 关联任务（幂等，全部成功或全部失败） |
| `release tasks remove <id> --task-ids 1,2,3` | 解除关联（只影响属于本发布的任务） |
| `release health <releaseId>` | Release 级 KPI：范围、基线、加权进度、阻塞、AI 贡献、速度与预计完成（口径 = 产品配置；`⚠` 提示同 `pm health`） |
| `release baseline <releaseId> [--note <text>]` | 把 Release **当前**范围存为新基线（追加式，只影响 Release 级，不动产品基线；备注 ≤500 字符） |

`--status`：planned|in_progress|awaiting_approval|released|cancelled。`--product` 缺省读 `GOOD7OB_PRODUCT_ID`。
`release health` / `release baseline` 走 `/progress/releases/{id}`（任一产品组织成员），错误码是进度模块的一套：`1001` 参数不合法、`1002` Release 不存在、`1008` 缺 id、`2000` 非成员（与 `/forge/releases` 的 `1006` / `1007` 不同）。
`--task-ids`：逗号分隔的正整数，去重后 1–200 个。名称 ≤200、版本号 ≤50 字符；`--end` 不得早于 `--start`。
`update` 传空字符串不会清空字段（后端把空值视为"不修改"）。所有命令支持 `--json`（`delete` 输出 `{"deleted":true,"id":N}`），无二次确认。
业务错误码：`1000` 缺参、`1001` 值非法（日期倒置 / 任务不存在或不属于该产品）、`1002` 不存在、`1006` 冲突（版本号重复 / 任务已属于另一个未取消的发布 / 已有待处理审批）、`1007` 状态不允许、`2000` 无权限、`999/401` 未登录。

> `--version` 注意：根命令 `-V/--version` 打印 CLI 版本。为让 `release create --version 1.2.0` 生效，`src/index.ts` 对根命令启用了 `enablePositionalOptions()`（根命令的选项只在子命令名之前生效）。

```bash
good7ob release create --product 12 --name "v1.2 发布" --version 1.2.0 --start 2026-10-01 --end 2026-10-15
good7ob release tasks add 7 --task-ids 101,102,103
good7ob release start 7
good7ob release request-approval 7 --description "测试通过，申请发布"   # → 输出新审批 ID
good7ob release baseline 7 --note "冻结范围"
good7ob release health 7
good7ob release get 7
```

---

## approval — 审批

API 端点前缀：`/approvals`（需登录 + 组织成员）。没有"创建审批"命令：申请由拥有目标对象的功能发起（发布用 `release request-approval`）。
状态：pending / approved / rejected / cancelled。

| 命令 | 说明 |
|------|------|
| `approval list` | 我所在组织的审批（新的在前，分页）；`--status` `--target-type`（如 RELEASE，不区分大小写）`--target-id` `--product` `--mine` `-p/--page` `--page-size`（≤100，默认 20） |
| `approval get <id>` | 详情；显示我能否决定 / 撤销、决定人与意见、是否自批 |
| `approval approve <id>` | 批准；`--comment` 可选 |
| `approval reject <id> --comment <text>` | 驳回；`--comment` 必填 |
| `approval cancel <id>` | 撤销（申请人或 owner/admin） |

`--mine`：只列**我能决定的** pending 申请（我是 owner/admin 且不是申请人；若我是唯一审批人，自己的申请也算），后端会忽略 `--status`，所以 `--mine` 不能与 pending 以外的 `--status` 同用。
`--product` 只是过滤条件，**不**读 `GOOD7OB_PRODUCT_ID`（否则会悄悄缩小"待我决定"的范围）。
决定权限：仅组织 owner/admin；申请人不能批准/驳回自己的申请，唯一例外是组织里没有其他审批人，此时批准会标记 `selfApproved`（CLI 会提示）。
业务错误码：`1000` 缺参（驳回没写意见）、`1001` 值非法、`1002` 不存在、`1009` 已被处理（含并发的第二个决定者，用 `approval get` 看结果）、`2000` 无权限、`999/401` 未登录。所有命令支持 `--json`，无二次确认。

```bash
good7ob approval list --mine
good7ob approval list --target-type release --target-id 7 --status approved
good7ob approval approve 31 --comment "LGTM"
good7ob approval reject 31 --comment "范围不清，补充测试报告后重提"
```

---

## trace — 追溯关系

API 端点前缀：`/forge/trace-links`（需登录 + 产品所属组织成员）。关系有方向：`source —linkType→ target`。
后端**不**校验来源/目标对象是否存在，由调用方保证。

| 命令 | 说明 |
|------|------|
| `trace create --product <id> --source-type <T> --source-id <n> --target-type <T> --target-id <n> --link-type <l>` | 创建；同一产品下相同的 (source, target, linkType) 重复返回 `1006` |
| `trace list --product <id>` | 查询（新的在前，分页）；`--source-type` + `--source-id`、`--target-type` + `--target-id`（各自必须成对）、`--link-type`、`-p/--page`、`--page-size`（≤200，默认 50） |
| `trace delete <id>` | 软删除（之后可重新创建） |

`--link-type`：derived_from|impacts|implements|verifies。类型代码 2–32 位字母/数字/下划线（如 IDEA、REQUIREMENT、TASK），不区分大小写，CLI 会转成大写再发送；来源与目标不能是同一个对象。
`--product` 缺省读 `GOOD7OB_PRODUCT_ID`。所有命令支持 `--json`（`delete` 输出 `{"deleted":true,"id":N}`），无二次确认。
业务错误码：`1000` 缺参、`1001` 值非法、`1002` 不存在、`1006` 已存在、`2000` 无权限、`999/401` 未登录。

```bash
good7ob trace create --product 12 --source-type IDEA --source-id 5 --target-type REQUIREMENT --target-id 9 --link-type derived_from
good7ob trace list --product 12 --source-type IDEA --source-id 5
good7ob trace list --product 12 --target-type TASK --target-id 101 --link-type implements
good7ob trace delete 3
```

---

## 输出格式

所有列表命令均支持多种输出格式：

| 格式 | 说明 | 触发方式 |
|------|------|---------|
| Table（默认） | 终端友好的 Unicode 表格 | 无需选项 |
| JSON | 结构化数据 | `--json` |
| CSV | 逗号分隔，适合导入 Excel | `--csv` |
| YAML | YAML 格式（部分命令） | `--yaml` |

**终端状态图标：**

| 图标 | 含义 |
|------|------|
| `✓` | 操作成功（绿色） |
| `✗` | 操作失败（红色） |
| `⚠` | 警告（黄色） |
| `ℹ` | 提示信息（蓝色） |

---

## 依赖列表

### 运行时依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `axios` | ^0.26.1 | HTTP 请求 |
| `chalk` | ^4.1.2 | 终端彩色输出 |
| `commander` | ^9.4.1 | CLI 命令解析 |
| `form-data` | ^4.0.5 | 文件上传 |
| `table` | ^6.8.1 | 表格格式化 |
| `ts-node` | ^10.9.1 | TypeScript 运行时 |

### 开发依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `typescript` | ^4.6.4 | 语言编译器 |
| `vitest` | ^0.15.0 | 单元测试框架 |
| `eslint` | ^8.15.0 | 代码风格检查 |
| `prettier` | ^2.6.2 | 代码格式化 |
| `@types/node` | ^17.0.34 | Node.js 类型定义 |

---

## API 集成

**Base URL：** `https://api.good7ob.net`（可通过环境变量覆盖）

**认证方式：** `Authorization: Bearer <api-key>`

**响应格式：**

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

**主要 API 端点：**

| 端点 | 功能 |
|------|------|
| `/api/infra/applications` | 应用 CRUD |
| `/api/infra/applications/{id}/resources` | 应用资源关联 |
| `/api/infra/resources` | 资源列表与详情 |
| `/api/infra/cost/*` | 成本分析系列接口 |
| `/api/infra/bills/*` | 账单导入与管理 |
| `/progress/projects` | 项目 CRUD |
| `/progress/projects/{id}/tasks` | 项目任务列表 |
| `/progress/tasks` | 任务 CRUD |
| `/progress/workflows/*` | 工作流与阶段管理 |
| `/progress/reports/*` | 进度报告 |
| `/progress/tags` | 标签管理 |
