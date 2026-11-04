# 腾讯云 SCF 函数 URL 部署

当前线上：

- 函数：`mbti-ai`（`ap-guangzhou`）
- 运行时：`Nodejs18.15`
- 入口：`index.main_handler`
- 环境变量：`AGNES_API_KEY`（只存在函数配置里）
- 触发器：`http`（函数 URL），`AuthType=NONE`，`EnableExtranet=true`
- 公网地址：`https://1330228714-ck5rk7z3tp.ap-guangzhou.tencentscf.com/`

腾讯云 API 网关已停止新购，`CreateService` 会返回
`LimitingResourceCreated`，所以不要走 API 网关，直接用 SCF 的 `http` 触发器。

## 重新部署

1. 修改 `scf/index.js`
2. 打包（zip 根目录必须直接是 `index.js`）：

   ```powershell
   cd scf
   powershell -NoProfile -Command "Compress-Archive -Path index.js -DestinationPath mbti-ai.zip -Force"
   ```

3. 在 `.deploy/scf-sdk/.env` 里填好：

   ```
   TENCENT_SECRET_ID=...
   TENCENT_SECRET_KEY=...
   AGNES_KEY=sk-...
   TENCENT_REGION=ap-guangzhou
   ```

4. 执行：

   ```bash
   cd .deploy/scf-sdk
   set -a; . ./.env; set +a
   node deploy.cjs
   ```

   脚本会创建/更新函数、等待 `Active`、创建或复用 `http` 触发器，
   最后打印 `ExtranetUrl`，并写入 `deploy-result.json`。

## 说明

- CORS 由函数自己处理，Origin 白名单在 `index.js` 的 `originAllowed`。
- 函数超时 60s，上游请求 50s，前端 fetch 55s。
- 密钥只放环境变量，不要写进 `index.js` 或仓库。
- 子账号需要 `QcloudSCFFullAccess`；创建函数还需要服务角色 `SCF_QcsRole`。
