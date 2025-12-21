# GitHub Agents Package

该包实现了从 GitHub 获取和导入 Claude Agent 的功能。

## 功能

### 1. 获取 GitHub Agents 列表
- `FetchAgents(url string)` - 从指定的 GitHub URL 获取可用的 agents 列表
- 默认使用 `DefaultAgentsURL` 作为 agents 仓库地址
- 返回 agents 元数据列表（名称、图标、模型、URL）

### 2. 获取 Agent 内容
- `FetchAgentContent(url string)` - 从 GitHub URL 获取并解析特定 agent 的完整内容
- 支持 YAML 格式的 agent 定义
- 自动验证必需字段（name, system_prompt）
- 自动设置默认值（icon: 🤖, model: sonnet）

### 3. 导入 Agent
- `ParseAgentFromYAML(yamlContent string)` - 从 YAML 字符串解析 agent
- `ParseAgentFromURL(url string)` - 从 GitHub URL 获取并解析 agent
- 自动规范化 GitHub URL（支持 blob URL 自动转换为 raw URL）

### 4. 模型名称规范化
- `normalizeModelName(model string)` - 将各种模型名称变体规范化为标准名称
- 支持的映射：
  - `sonnet`, `claude-sonnet`, `claude-3-sonnet`, `claude-3.5-sonnet` → `sonnet`
  - `opus`, `claude-opus`, `claude-3-opus` → `opus`
  - `haiku`, `claude-haiku`, `claude-3-haiku` → `haiku`

## Agent YAML 格式

```yaml
name: Agent Name
icon: 🤖
model: sonnet
system_prompt: |
  Your agent instructions here...
default_task: Optional default task
```

## Bindings

该包已集成到 `bindings.go` 中，提供以下 Wails 绑定函数：

- `FetchGitHubAgents()` - 获取 GitHub agents 列表
- `FetchGitHubAgentContent(url string)` - 获取指定 agent 的内容
- `ImportAgentFromGitHub(url string)` - 从 GitHub 导入 agent 到本地数据库

## 测试

运行测试：
```bash
go test ./internal/github/...
```

测试覆盖：
- 模型名称规范化
- GitHub URL 规范化
- YAML 解析和验证
- 默认值设置
