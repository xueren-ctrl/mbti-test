# AI 完整职业报告接入说明（Key 不再放前端）

> 2026-11-06：线上代理已从腾讯云 SCF 迁到 Cloudflare Pages（`worker/agnes-proxy.js` 作为 `_worker.js`）。
> SCF 因账号欠费暂停；Pages 的 `mode:'report'` 已跑通完整 e2e。
> `server-ai.js` / Vercel / EdgeOne 是旧文件，不支持 `mode:'report'`，不要用它们测报告。

## 现在是怎么工作的

```
浏览器（GitHub Pages，纯静态）
      │  POST { type, dims, mode:'report', profile }   ← 不含任何密钥
      ▼
你的代理（当前：Cloudflare Pages `xueren-mbti`）
      │  Authorization: Bearer sk-...     ← Key 只在服务端环境变量
      ▼
Agnes API
```

页面里已经没有 `sk-` 开头的字符串。代理负责：校验参数、生成提示词、调模型、把结果原样返回。
因为提示词在服务端生成，别人拿到代理地址也只能问 MBTI，不能当通用大模型接口刷。

## 当前线上部署（2026-11）

- 代理地址：`https://xueren-mbti.pages.dev/`
- Cloudflare Pages 项目 `xueren-mbti`；`worker/agnes-proxy.js` 作为 `_worker.js` 直传部署
- 环境变量：`AGNES_API_URL`、`AGNES_API_KEY`（secret）、`UNLOCK_SECRET`（secret）
- 上游地址固定为 `https://api.agnes-ai.cn/v1/chat/completions`；`apihub.agnes-ai.com` 会 401
- 前端 `AI_PROXY_URL` 已指向该地址，国内网络可直连
- 健康检查/解锁码/4 页报告 e2e 已通过；Agnes 会按 Cloudflare 出口 IP 做短时限流（`retry-after` 1–15 分钟），连续生成需等待
- 备用：腾讯云 SCF `mbti-ai`（欠费恢复后可切回，见 `scf/DEPLOY.md`）

---

## 第一步：立刻吊销旧 Key

旧 Key 曾以数组拆分的形式写在 `index.html` 里，已经随公开仓库和页面缓存泄露。
**在 Agnes 控制台删除/轮换它**，换一把新 Key 只填到代理的环境变量里。
只删前端代码不吊销，等于没修。

---

## 第二步：部署代理（三选一）

> ⚠️ 线上站点是 HTTPS，代理也必须是 HTTPS，否则浏览器会按混合内容拦掉。
> `http://127.0.0.1` 仅用于本机调试。

### A. 香港/新加坡小 VPS、国内云主机（国内访问最稳，推荐）

```bash
# 服务器上
export AGNES_API_KEY=sk-新key
export ALLOWED_ORIGINS=https://xueren-ctrl.github.io
export PORT=8787
node server-ai.js
```

用 Nginx 反代到 443 并配证书，例如：

```nginx
location /api/ai-analysis {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

长期运行：`pm2 start server-ai.js --name mbti-ai`（或 systemd）。
零依赖，Node 18+ 即可，不需要 `npm install`。

### B. Cloudflare Worker（免费，但建议绑自己的域名）

1. Cloudflare 控制台 → Workers → 新建，把 `worker/agnes-proxy.js` 全文粘进去
2. Settings → Variables → 添加 **加密** 变量 `AGNES_API_KEY`
3. 可选：再添加 `ALLOWED_ORIGINS=https://xueren-ctrl.github.io`
4. 可选：绑定一个 KV 命名空间到 `RATE_LIMIT`，限流才能跨实例生效
5. 绑定自定义域名（`*.workers.dev` 在国内经常不可直连）

地址形如 `https://ai.example.com/api/ai-analysis`。

### C. Vercel（部署最简单，但国内访问可能不稳）

```bash
vercel --prod
# 在 Vercel 项目 Settings → Environment Variables 添加 AGNES_API_KEY
# 再把 ALLOWED_ORIGINS 设为 https://xueren-ctrl.github.io（如果前端在 Pages）
```

仓库里的 `api/ai-analysis.js` 已经按这个结构写好，`vercel.json` 也放宽到了 60 秒。

### D. 腾讯云 SCF 函数 URL（当前线上，国内可直连）

函数代码在 `scf/index.js`，部署步骤见 `scf/DEPLOY.md`。
腾讯云 API 网关已停止新购，所以用 SCF 自带的 `http` 触发器（函数 URL），公网地址形如
`https://<实例>-<随机>.ap-guangzhou.tencentscf.com/`。

---

## 第三步：把代理地址填回页面

打开 `index.html`，找到 `const AI_PROXY_URL=`（约 3111 行）：

```js
const AI_PROXY_URL='https://1330228714-ck5rk7z3tp.ap-guangzhou.tencentscf.com/';
```

改成你的完整地址：

```js
const AI_PROXY_URL='https://ai.example.com/api/ai-analysis';
```

- 留空：AI 入口隐藏，不会出现“点了必 404”的情况
- 整站和代理同域（例如都部署在 Vercel）：填 `/api/ai-analysis`
- 改完刷新即可，没有构建步骤

---

## 验证

> `agnes-3.0-flash` / `agnes-2.5-flash` 本身费用为 0，但网关会按 `max_tokens` 预授权。
> 报告已用 2600 输出上限，避开余额只有 ¥0.0107 时的预授权失败。
> 若仍返回 `报告服务正在补充额度`，等 1 分钟或给账户留 ¥1 再试。`agnes-2.5-pro` 可能产生额度不足，不用于报告。

先直接打代理（带 Origin，模拟浏览器）：

```bash
curl -s https://1330228714-ck5rk7z3tp.ap-guangzhou.tencentscf.com/ \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://xueren-ctrl.github.io' \
  -d '{"type":"INTJ","dims":{"EI":{"a":"I","b":"E","aVal":72,"bVal":28},"SN":{"a":"N","b":"S","aVal":64,"bVal":36},"TF":{"a":"T","b":"F","aVal":61,"bVal":39},"JP":{"a":"J","b":"P","aVal":58,"bVal":42}},"mode":"report","profile":{"name":"小林","role":"互联网运营","years":"3 年","city":"上海","confusion":"想转产品","goal":"1 年内转岗"}}'
```

正常返回 4 页 Markdown：

```json
{"content":"## 第 1 页……## 第 4 页……","model":"agnes-3.0-flash"}
```

健康检查：`GET 代理地址` → `{"ok":true,"configured":true,"unlock":true}`

再打开站点 → 完成测试 → 点「生成完整报告」→ 填背景 → 看到 4 页即成功。
线上回归：`node .deploy/live-report-check.cjs && node .deploy/live-report-e2e.cjs`。

## 本地联调（不消耗真实额度）

```bash
# 终端 1：假上游，返回固定内容
node tools/mock-agnes.mjs

# 终端 2
set AGNES_API_KEY=test
set AGNES_API_URL=http://127.0.0.1:8898/v1/chat/completions
node server-ai.js

# 终端 3
python -m http.server 8899
```

临时把 `AI_PROXY_URL` 改成 `http://127.0.0.1:8787/api/ai-analysis`，或在本机用 DevTools 的
「请求拦截 / 本地覆盖」注入 `window.MBTI_AI_PROXY`（页面脚本会优先读它）。

## 安全清单

- [ ] 旧 Key 已吊销，新 Key 只存在代理环境变量
- [ ] 代理走 HTTPS
- [ ] `ALLOWED_ORIGINS` 只留自己的域名（默认已包含 `https://xueren-ctrl.github.io`）
- [ ] `.env` 不在仓库里（`.gitignore` 已加）
- [ ] 需要更强防护时：把限流接到 Redis/KV；或给代理加 Cloudflare Turnstile
