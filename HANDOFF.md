# MBTI 性格测试网站 · 交接文档

> 最后更新：2026-11-06

## 1. 项目是什么

纯前端单文件 MBTI 测试站，结果页加了一份 **AI 生成的 4 页职业报告**。

- 线上：`https://xueren-ctrl.github.io/mbti-test/`
- 仓库：`https://github.com/xueren-ctrl/mbti-test`（公开）
- 本地：`D:\mbti-test`（不是 git 仓库，靠 `.deploy/push_new_page.mjs` 走 GitHub Data API 发布）
- 变现：每月免费 3 次；用完后 ¥9.9 解锁 1 份；爱发电自动发解锁码。

## 2. 当前状态

| 项 | 状态 |
|---|---|
| 前端报告页 | 已完成，`node --check` 通过 |
| 报告 UI/额度/解锁/打印测试 | 通过（`.deploy/report-smoke.cjs`，4 页 PDF） |
| SCF 解锁码校验 | 线上通过（文件首码，50 个码全部本地校验通过） |
| SCF 报告生成 | **2026-11-06 暂停**：腾讯云账号 `InsufficientBalance`，函数返回 410；需充值 ¥1 才能恢复 |
| Cloudflare Pages 代理 | 已上线：`https://xueren-mbti.pages.dev/`，健康检查/解锁码/4 页报告 e2e 通过；Agnes 对 Cloudflare 出口有短时限流 |
| 前端上线 | 已发布（commit `83fd5c4`，`AI_PROXY_URL` 指向 Pages） |
| 爱发电自动发货 | 待配置（商品价格已确认 `￥9.90`） |

线上 AI 代理地址是 `https://api.agnes-ai.cn/v1/chat/completions`（不是 `apihub`）。
之前 401 是接错域名，不是 Key 失效。
`agnes-3.0-flash` / `agnes-2.5-flash` 的调用费用是 0，但网关会按 `max_tokens` 做预授权；
余额只有 ¥0.0107 时，4096 输出的预授权（约 ¥0.0163）会失败。
报告已改成 2000–2400 字、`max_tokens:2600`，预授权约 ¥0.0103，免费额度即可通过；
`agnes-2.5-pro` 会产生额度不足，已从报告 fallback 移除。

2026-11-06 线上故障：SCF 返回 `410 Function is Unavailable, AvailableStatus = InsufficientBalance`，
是**腾讯云账号欠费/余额不足**，不是 Agnes。恢复：腾讯云费用中心充值 ¥1 或结清欠费。

Cloudflare 迁移进度：`worker/agnes-proxy.js` 已补全报告/解锁码逻辑；Worker `mbti-ai` 已部署到旧账号，
但 `workers.dev` 在大陆被 DNS 污染。另在账号 `3256542896@qq.com` 建了 Pages 项目 `xueren-mbti`，
`https://xueren-mbti.pages.dev/` 可访问，健康检查与解锁码校验通过。
前端 `AI_PROXY_URL` 已切到 Pages；直接 POST 曾成功生成 4 页（`agnes-2.5-flash`，24s/84s）。
**但 Agnes 会对 Cloudflare 出口做短时限流**：返回 `429 error code: 1015` + `retry-after`（1–15 分钟），
同一 Key 本地 Node 直连正常，说明限流按出口 IP；连续测试/同一时段多次生成会失败。
完整浏览器 e2e 已通过（`agnes-2.5-flash`，4 页，2462 字，PDF 4 页，额度 3→2）；
但同一出口 IP 连续生成会被限流，页面会提示“当前生成请求较多，请约 15 分钟后再试”。
要稳定支撑多人连续生成，需要中国境内中转（SCF/阿里云函数等）或 Agnes 提额/换允许 Cloudflare 出口的服务。

## 3. 用户流程

1. 完成测试，进入结果页。
2. 点「生成完整报告」→ 填 6 项背景（称呼、年限、当前工作、城市/行业、卡点、1–3 年目标）。
3. 前端 POST 到 SCF，SCF 调 Agnes，一次生成 4 页 Markdown。
4. 前端渲染成 A4：封面/类型内核、三个方向、简历面试转行、90 天计划。
5. 用户可「打印 / 保存 PDF」或「复制全文」。
6. 免费 3 次/月；用完后弹 ¥9.9 解锁框，输入爱发电发来的码，解锁 1 次。

## 4. 关键文件

| 路径 | 作用 |
|---|---|
| `index.html` | 唯一前端源码，约 4,840 行；含报告页、额度、解锁、打印 CSS |
| `scf/index.js` | SCF 代理：报告提示词、模型回退、限流、解锁码校验 |
| `scf/DEPLOY.md` | 部署、环境变量、接口、排障 |
| `.deploy/push_new_page.mjs` | 发布 `index.html` 到 GitHub Pages |
| `.deploy/report-smoke.cjs` | 本地 CDP 端到端测试（mock AI，4 页 PDF） |
| `.deploy/live-report-check.cjs` | 线上 CTA / 免费额度 / 解锁码验证 |
| `.deploy/live-report-e2e.cjs` | 线上真实 AI 生成 + 4 页打印 + 扣次数验证 |
| `tools/gen-unlock-codes.cjs` | 生成 HMAC 解锁码 |
| `report/unlock-codes.txt` | 已生成的码（gitignored，不要提交） |
| `report/README.md` | 运营/发码/验收说明 |
| `server-ai.js` 等 | 旧代理，**不参与当前线上**；不要用它们测报告 |

## 5. 技术要点

- 单文件、无构建、vanilla JS；`localStorage` 存结果、额度、缓存。
- 前端代理地址：`index.html` 里 `AI_PROXY_URL`，可用 `window.MBTI_AI_PROXY` 覆盖。
- SCF：Node 18.15，256 MB，120 秒；请求体 16 KB；同一 IP 10 分钟 15 次。
- 报告最多试 2 个模型，单模型 55 秒；不足 4 页、超过 5000 字或被截断返回 502，前端不扣次数。
- 打印时按页面字数自动加 `rpt-dense` 压缩长页，保证真实 AI 输出稳定落在 4 页 A4。
- 报告缓存 key 含类型、维度、背景；命中缓存不扣次数。
- 解锁码格式 `MBTI-XXXXXX-XXXXXXXXXX`；服务端只验 HMAC，不存订单。
- 合规文案：不写“准/科学诊断”，固定免责声明；AI 不编造公司/薪资/证书。

## 6. 测试

```bash
cd D:\mbti-test
node --check .deploy/report-smoke.cjs
node .deploy/report-smoke.cjs
```

测试会起本地静态服务、mock SCF、Chrome CDP，验证：

- CTA、6 项表单、4 页渲染、无模型名、免责声明只出现一次
- 免费额度 3→2→1→0、缓存命中不扣次数
- 解锁框、码兑换、额度消耗
- 打印 4 页、返回结果、移动端布局

截图输出：`.tmp/report-desktop.png`、`.tmp/report-paywall.png`、`.tmp/report-mobile.png`；
打印 PDF：`.tmp/report-print.pdf`。

线上验收（Chrome CDP，会真实调用 AI、消耗一次免费额度）：

```bash
node .deploy/live-report-check.cjs
node .deploy/live-report-e2e.cjs
```

## 7. 发布前端

```bash
cd D:\mbti-test
GH_TOKEN=$(gh auth token) DEPLOY_MESSAGE="..." node .deploy/push_new_page.mjs index.html
```

发布后等 Pages 构建，打开线上地址强制刷新，确认：

- 结果页有报告 CTA；
- 控制台无 JS 错误；
- 线上来源 `https://xueren-ctrl.github.io` 的代理请求 CORS 正常；
- 免费额度、解锁码、打印都正常。

## 7.1 发布 Cloudflare Pages 代理

```bash
cd D:\mbti-test
CF_API_TOKEN=... node .deploy/cf-pages-deploy.cjs
```

- 项目：`xueren-mbti`，账号 `3256542896@qq.com`
- 环境变量：`AGNES_API_URL`、`AGNES_API_KEY`、`UNLOCK_SECRET`（后两个为 secret）
- 部署后先 `curl` 根路径看 `{"ok":true,"configured":true,"unlock":true}`，再跑 `node .deploy/live-report-e2e.cjs`
- Agnes 对 Cloudflare 出口有短时 `429/1015` 限流；连续测试会命中，等 `retry-after` 后再试

## 8. 下一步

1. **先解决 AI 出口限流**：Cloudflare Pages 能访问，但 Agnes 对 Cloudflare 出口返回 429/1015 + `retry-after`；最省事是腾讯云费用中心充值 ¥1/结清欠费恢复 SCF，或加一个中国境内中转函数；切换后跑 `node .deploy/live-report-e2e.cjs` 确认真实 AI 出 4 页。
2. **配置爱发电自动发货**：商品后台/电铺设置里上传 `report/unlock-codes.txt`，一码一行；付款后自动把码发给买家。
3. 用买家视角走一遍：付款 → 收码 → 回站输入 → 生成 4 页 → 打印 PDF。确认码不重复发。
4. 把 `report/unlock-codes.txt` 留一份离线备份；卖完后用 `tools/gen-unlock-codes.cjs` 再生成一批。
5. 后续：解锁码一次性核销（云数据库/Redis）、SEO 落地页、域名/ICP、退换政策。
6. 偶尔仍可能遇到上游免费模型 500/超时，已自动切 2.5-flash；若频繁出现再考虑充少量余额或加队列。
7. 换 Key 只改 `.deploy/scf-sdk/.env` 并重部署 SCF，前端不动。

## 9. 已知限制

- 仓库公开，前端额度/解锁逻辑可被绕过；真正收费闸门只在 SCF 校验，且码可复用。
- SCF 无数据库：同一解锁码清 localStorage 后可再次使用；这是 MVP 限制。
- 爱发电没有公开 webhook/API 可用于自动核销；当前靠自动发码。
- `report/report-template.html` 是旧人工模板，仅版式参考，不参与生产。
