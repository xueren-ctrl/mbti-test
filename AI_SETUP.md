# AI 解读接入说明（Key 不再放前端）

## 现在是怎么工作的

```
浏览器（GitHub Pages，纯静态）
      │  POST { type, dims, mode }        ← 不含任何密钥
      ▼
你的代理（server-ai.js / Worker / Vercel）
      │  Authorization: Bearer sk-...     ← Key 只在服务端环境变量
      ▼
Agnes API
```

页面里已经没有 `sk-` 开头的字符串。代理负责：校验参数、生成提示词、调模型、把结果原样返回。
因为提示词在服务端生成，别人拿到代理地址也只能问 MBTI，不能当通用大模型接口刷。

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

---

## 第三步：把代理地址填回页面

打开 `index.html`，找到（约 3111 行）：

```js
const AI_PROXY_URL='';
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

先直接打代理（带 Origin，模拟浏览器）：

```bash
curl -s https://ai.example.com/api/ai-analysis \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://xueren-ctrl.github.io' \
  -d '{"type":"INTJ","dims":{"EI":{"a":"E","b":"I","aVal":35,"bVal":65},"SN":{"a":"S","b":"N","aVal":30,"bVal":70},"TF":{"a":"T","b":"F","aVal":72,"bVal":28},"JP":{"a":"J","b":"P","aVal":58,"bVal":42}},"mode":"detailed"}'
```

正常返回：

```json
{"content":"……","model":"agnes-3.0-flash"}
```

健康检查：`GET /api/health` → `{"ok":true,"configured":true}`

再打开站点 → 完成测试 → 点「AI 深度解读」，能看到流式之外的完整结果即成功。

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
