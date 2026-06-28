# 故障排除

## 构建问题

### `pnpm install` 失败

**症状**：依赖安装失败。

**解决**：
```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

### `pnpm run build` 失败

**症状**：TypeScript 编译错误。

**解决**：
```bash
pnpm run typecheck        # 查看具体类型错误
```

常见原因：
- 依赖未安装：先运行 `pnpm install`
- 类型定义过期：检查 `@earendil-works/*` 包版本

### PI 本地依赖找不到

**症状**：`@earendil-works/*` 包解析失败。

**原因**：PI 包是本地 file 依赖，来自 `github-repo/pi-mono/`。

**解决**：确认 `github-repo/pi-mono/` 目录存在且包含对应包。

## 运行时问题

### API Key 未设置

**症状**：`No API key found for provider "xxx"`。

**解决**：
```bash
export ANTHROPIC_API_KEY="sk-..."
# 或对应的 provider key
```

### 模型不存在

**症状**：`Unknown model "xxx" for provider "yyy"`。

**解决**：检查 `--model` 参数是否为该 provider 支持的模型 ID。

### tmux 未安装（PI Extension 模式）

**症状**：tmux 相关错误。

**解决**：
```bash
# macOS
brew install tmux

# Ubuntu/Debian
apt install tmux
```

### Phase 不推进（PI Extension 模式）

**症状**：agent 已经完成工作，但 `.harness-kit/state.json` 中的 `currentPhase` 没有变化。

**解决**：
- 当前兼容路径下，检查 assistant 输出是否包含可解析的 `<HK_RESULT>`。
- scheduler path 下，检查是否调用了 `complete_phase`。
- 检查 facts 是否通过硬校验；校验失败时 phase 必须停留在当前阶段。
- 检查 guardrail 事件是否报告了未声明文件变更。

## 测试问题

### 测试超时

**症状**：测试长时间无响应。

**解决**：
- 检查是否有网络调用未 mock
- 检查是否有死锁

### E2E 测试失败

**症状**：`pnpm run test:e2e` 失败。

**原因**：E2E 测试需要 tmux 环境。

**解决**：确认 tmux 已安装且可正常运行。

## 格式/Lint 问题

### `pnpm run lint` 报错

**解决**：
```bash
pnpm run lint:fix         # 自动修复
```

### `pnpm run fmt:check` 报错

**解决**：
```bash
pnpm run fmt              # 自动格式化
```

> **注意**：始终使用 `pnpm run lint` 和 `pnpm run fmt`，不要使用 `npx` 或全局安装的工具。
