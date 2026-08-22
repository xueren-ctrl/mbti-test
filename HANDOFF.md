# MBTI 性格测试网站 · 项目交接文档

> 用途：把当前项目状态与下一步任务交给另一个 AI 接续完成。
> 最后更新：2026-08-22

---

## 1. 项目是什么

一个**纯前端单文件**的 MBTI 性格测试网站。用户输入答题 → 算出 4 维度性格类型 → 输出性格画像 + 职业方向 + 发展建议，并支持分享海报、本地账号、AI 深度分析等。

- 线上地址（GitHub Pages）：`https://xueren-ctrl.github.io/mbti-test/`
- GitHub 仓库：`https://github.com/xueren-ctrl/mbti-test`（用户名 `xueren-ctrl`）
- ⚠️ 线上**当前部署的是旧版**，尚未包含本次"重复保存"修复。

---

## 2. 技术栈与架构

| 项 | 说明 |
|---|---|
| 前端 | 单文件 SPA：`/workspace/index.html`（约 180KB / ~3000 行，**无构建步骤**） |
| 数据存储 | `localStorage`（本地）+ Node.js 后端 JSON 文件（云同步，仅本地运行用） |
| AI | Agnes-2.0-Flash，前端**直连**；API key 做了数组拆分混淆；endpoint `https://apihub.agnes-ai.com/v1/chat/completions` |
| 部署 | GitHub Pages（静态托管，国内可访问）；曾试 Vercel 因国内墙放弃 |
| 本地后端 | `server.js` / `server-ai.js`（Node + Express），用于账号云同步 + AI 代理，**不进 Pages** |

---

## 3. 已实现功能

- 3 种测试模式：快速（12 题）/ 详细（28 题）/ 完整（60 题）
- 结果页：四维分析条、推荐职业、优势劣势、发展建议
- 分享海报 + 二维码（扫码可看结果）；社交分享（微信 / 微博 / QQ / 复制链接）
- 本地账号系统 + 云端同步（Node 后端 + JSON DB）
- 首页 16 型性格画廊
- 7 大高级功能：性格兼容分析、AI 深度分析、成长追踪、职业路径规划、团队性格地图、每日洞察、名人墙

---

## 4. 关键文件位置（重要）

| 路径 | 作用 |
|---|---|
| `/workspace/index.html` | **最新源码（含全部修复）**，上线用的唯一文件 |
| `/tmp/mbti-test/index.html` | 同一份已 `git commit` 的副本（commit `9bc12d4`），仓库远端已配置 |
| `/workspace/server/` `server.js` `server-ai.js` `api/` `deploy.sh` `DEPLOY.md` | 本地后端 / 部署脚本，**GitHub Pages 不需要** |

---

## 5. 当前唯一阻塞项：修复"查看历史记录重复保存"的 Bug

### 根因
`showResult()` 函数内部写有自动保存逻辑，每次被调用都会存一条记录。而该函数同时被三处调用：
1. `calculateResult`（完成新测试）—— 应当保存 ✅
2. `viewHistoryResult`（点击历史记录查看）—— 不应保存 ❌（这就是重复来源）
3. `checkUrlResult`（扫码查看分享结果）—— 不应保存 ❌

### 修复内容（已写入 `/workspace/index.html`）
- 函数签名改为 `function showResult(type,dims,isNew)`（约 1940 行）
- 自动保存逻辑改为仅在 `isNew` 为真时执行（约 2052 行）：
  ```js
  if(isNew&&appState.currentUser){
    setTimeout(()=>{saveResult(type);},500);
  }
  ```
- 三处调用点：
  - `calculateResult` → `showResult(type,dims,true)`（1934 行，**新测试才保存**）
  - `viewHistoryResult` → `showResult(type,dims)`（2954 行，查看不保存）
  - `checkUrlResult` → `showResult(type,dims)`（2313 行，查看不保存）

### 修复状态
- ✅ 代码已改好，JS 语法已校验通过，本地起服务 HTTP 200 验证可加载
- ✅ 已 `git commit`（仓库 `/tmp/mbti-test`，commit `9bc12d4`）
- ❌ **尚未推送到 GitHub Pages（线上仍是旧版）**

---

## 6. 下一步具体操作（给下一个 AI）

### 目标：把修复推上线

**第一步：先判断当前环境能否访问 GitHub**
```bash
curl -sS -m 10 -o /dev/null -w "%{http_code}\n" https://github.com
# 若返回 000 / TLS 报错 / DNS 解析到 198.18.0.x → 无外网，见下方"无网方案"
```

**方案 A — 环境有外网时（直接推）：**
```bash
cd /tmp/mbti-test
git push origin HEAD
# 或把 /workspace/index.html 拷到用户本地仓库后：
# git add index.html && git commit -m "fix: 修复历史记录重复保存" && git push origin main
```

**方案 B — 环境无外网时（当前沙箱情况，GitHub 不可达）：**
让用户在其**自有网络环境**完成部署，二选一：
1. **GitHub 网页直传（最省事）**：打开 `github.com/xueren-ctrl/mbti-test` → 进 `index.html` → 点铅笔「Edit」→ 把 `/workspace/index.html` 内容贴入 → Commit。1–2 分钟后 Pages 自动更新。
2. **本地终端推送**：把 `/workspace/index.html` 下载到用户电脑，放进本地 `mbti-test` 仓库，执行上面的 git 命令。

### 上线后验证
登录 → 完成一次测试（历史 +1 条）→ 进入历史记录 → 点开某条查看 → 返回 → 确认**没有**因此新增重复记录。

---

## 7. 环境坑位提醒（避免下一个 AI 白费劲）

- **当前沙箱无外网出口**：`github.com` / `*.github.io` 被 DNS 解析到 `198.18.0.x` 保留网段，TLS 握手失败。`curl` / `git push` / 浏览器自动化（agent-browser）**全部失败**——已实测：同一浏览器开本地服务成功、开 GitHub 报 `ERR_CONNECTION_CLOSED`。若下一个 AI 也在同类沙箱，会撞同一堵墙，不必反复试。
- 若下一个 AI 运行在**有网环境**（用户本机或开放沙箱），方案 A 直接 `git push` 即可。
- **API key 已混淆写在前端**（数组拆分），这是已知权衡：因 Vercel 国内不可达，退回了前端直连。若要更安全，可改回后端代理（`server-ai.js` 已有代理逻辑），但后端需部署到可公网访问的节点（Render / VPS / 国内云），纯静态 Pages 做不到。

---

## 8. 其他已知可优化点（非阻塞，供参考）

- 账号密码以明文存 `localStorage` → 可改为哈希
- 二维码库已内联到 HTML（此前用 cdnjs CDN 被墙导致分享页转圈）
- 已弃用残留：`api/ai-analysis.js`（Vercel 函数）、`vercel.json`（已简化）
- 如未来要支持更稳的 AI 调用，建议把 Agnes 调用全部收口到后端代理，密钥不落前端。
