# DEV-20261010-12 · 素材目录改为本地导入与服主预缓存准入

## 基本信息

| 字段 | 内容 |
|---|---|
| 开始 / 最后更新 | 2026-10-10 / 2026-10-11，Asia/Shanghai |
| 状态 | 进行中 |
| 类型 | 修复 / 功能 / 网络验证 |
| 分支与开始 HEAD | `feat/IncreasePlayerCapacity`，`85d3716aca8dcab658641ab9afa83f2ceef46464`，开始时工作区干净 |
| 上游基线 | 已合并 v0.2.3 / `1db8e51023ae6abaec9370beb81a513d5c4d0b01`，本任务仅核对本地，不刷新远程 |
| 提交归属 | 目录本地导入阶段与本文同一功能提交，按路径查询；准入为下一功能提交；沿用既有本地提交授权，不推送 |
| 关联 | D016、D019、D021、D022、D023；I002、I004；DEV-20261010-08、DEV-20261010-09 |

## 需求、范围与验收

用户在新版本线上短、长抓包后要求紧急消除完整素材目录流量。目录不允许在线获取，即使客户端没有导入任何素材；应从 ZIP 内的 `manifest.json` 或独立 JSON 目录导入，再与服务器进行小型摘要校验。预缓存面板与操作不应反复请求完整目录。已有内容缓存尽量保留，目录导入不能声称素材已完整。

新增服主动态配置：是否要求当前素材版本已完整缓存，才允许创建、加入、最快匹配和观战。用户分别确认默认允许、服主手动开启严格限制，以及观战同样限制；已经在对局中的断线续玩保留。客户端启动器明确暂缓。

验收包括：冷浏览器初始化、反复打开面板和执行管理操作均无完整目录网络请求；直接请求旧完整目录接口也只返回小型拒绝；当前完整 ZIP 自带目录可引导导入，独立目录导入及刷新持久复用正常；旧素材和增量导入按当前内容哈希复用；错误、篡改、旧目录和缺项不会得到正常客户端完整准入；服主配置在本机动态生效，创建 / 加入入口由服务器核验，默认模式与断线恢复回归通过。验证使用定向模块、真实 Edge 导入 / 缓存 / WebSocket 短流程；不运行完整 14 回合，不推送或部署。

## 调查与决定

| 问题 | 证据或来源 | 结论及确定程度 |
|---|---|---|
| 目录重复占用 | 用户长抓包 `biglocal.pcap`，研究目录聚合报告；392.102 秒、106 份相同目录，共 73,444,220 B | 已确认；不能在客户端缓存未就绪时回退在线完整目录 |
| 尖峰 | 同抓包本机 100 ms 最大 120.514 Mbps，其中目录约 92%；完整秒最大 26.932 Mbps | 已确认本机突发，不等于公网 200 Mbps 已复现 |
| 在线补齐与其他 HTTP | 补齐 390.764 MB / 80.919%，约 8 Mbps；其他 HTTP 合计 14.632 MB | 目录与补齐分别控制；本任务遵循用户要求优先目录，保留已批准的补齐限流 |
| 现有包内目录 | `tools/asset-cache-pack.mjs` 的 manifest 已含完整文件、别名、SHA 和内容版本 | 已确认；无需重打现有大包即可支持完整包引导 |
| 本地目录持久状态 | SW 已保存完整目录及 per-client pin；页面 `refreshCatalog` 仍取在线完整目录 | 已确认；恢复本地目录且与服务器小摘要校验，保留对局固定版本 |
| 服主开关默认 | 本轮用户结构化回复 | 已确认默认允许，动态开启严格模式 |
| 观战准入范围 | 本轮第二次用户结构化回复 | 已确认创建、加入、最快匹配、观战均限制；不影响已有对局断线恢复 |

## 实现或操作

### 第一阶段：目录线上出口与本地导入

- `server/http/assetCache.js`：旧完整目录 GET / HEAD / 条件 / 压缩请求全部 403，正文仅错误码，拒绝发生在构建目录前。状态接口仅返回摘要和政策；保留固定进程快照、文件允许列表及既有限流。
- `shared/assetCache.js`：规范化 schema 1 条目属性顺序并验证完整内容版本，维持现有 ZIP 哈希；提供目录、摘要和准入报告的纯校验函数，不信任裸 `ready:true`。
- `public/js/assetCache.js`：移除完整目录 URL 和 fetch / 回退；初始化读取 Cache Storage 的既有目录，并请求一次小摘要。面板重开只检查 SW 游玩标志。无目录可导入 JSON / 完整 ZIP，不能直接在线补齐；匹配后 Worker 按实际键扫描进度。
- Worker 在写入素材前限长读取 JSON / ZIP manifest，验证目录，再按当前哈希导入素材。已持有当前目录时允许旧 / 部分 ZIP 复用；错误、篡改、旧目录不升级 pin。SW 保留旧数据结构，并允许直接重连的初始 pin；活动对局仍禁止更换版本。
- 预缓存界面提供「导入目录 JSON」，冷浏览器显示需要目录，在线补齐和完整校验在当前目录就绪后启用。四个翻译包补齐。
- `tools/asset-cache-pack.mjs --catalog-only` 独立导出与完整包相同的 JSON，原子发布、拒绝覆盖，不重做大 ZIP，不上传。

### 第二阶段：服主准入

计划接入现有私有动态配置与同步 Lobby 方法；不把 Network 分发改成异步，避免提前返回 ok 或迟到修改房间。准入报告将包含当前版本、已缓存文件数与字节数；服务端对照自己的摘要，默认模式放行，严格模式限制四个入口，恢复 hello 保留。

## 验证

| 检查 | 实际结果 |
|---|---|
| Node 定向模块 | `node --test test/asset-cache-shared.test.js test/asset-cache-catalog.test.js test/asset-cache-pack.test.js test/asset-cache-http.test.js test/asset-cache-manager.test.js test/asset-cache-sw.test.js`，61 项全部通过；含 50 个并发旧目录拒绝、构建次数为零、目录校验、缓存复用及生命周期 |
| Edge 真实缓存 | `SP_E2E=1 node --test test/asset-cache.browser.test.js test/asset-cache-ui.browser.test.js`：缓存文件对应 5 个场景全部通过，UI 首次超时见下；覆盖 JSON / 完整 ZIP 引导、旧部分 ZIP、音频 alias / Range、刷新 / 升级、跨标签、无目录 / 旧目录 / 错误重试；完整目录 HTTP 请求均零 |
| Edge 主界面 | 与缓存套件同时运行时首次导航等待 networkidle0 超时；改为 DOM 加载并等待具体 UI / 缓存状态后单独重测 `test/asset-cache-ui.browser.test.js`，1 项通过（3828×1931 / 1920×1080 / 1280×720，持久保存结果及本地目录按钮）。这是测试就绪判断调整，不宣称第一次通过 |
| 四语言严格检查 | `node tools/i18n.mjs check --all --strict`，每包 1316 个已用 msgid，0 missing / 0 errors |
| 类型与定向 ESLint | `tsc --noEmit --checkJs -p jsconfig.json` 和本次缓存 / 工具 / 测试相关文件 ESLint 均通过 |
| 文档与冷启动统计补充回归 | `node --test test/asset-cache-manager.test.js test/docs-consistency.test.js test/docs-paths.test.js`，46 项全部通过；`git diff --check` 通过 |
| 导入边界扫描 | `node tools/check-imports.mjs` 默认非 strict 返回 0，但报告 `server/sim/nodeData.js:11–13` 的 3 个 `sim-node` 违例；该文件及检查器与开始 `85d3716` 无差异，属既有 Node-only 加载器报告，本任务无新增违例。未将此报告称为完整通过或修改无关边界规则 |
| 当前真实包目录兼容 | `node tools/asset-cache-pack.mjs --catalog-only` 生成 4,585,419 B JSON；定向读取现有「素材包dd40447a61c1.zip」的 manifest（仅读取约 2.02 MB ZIP）后逐项相等，浏览器共享验证器确认内容版本及 12,562 文件 / 648,096,514 B |

Node v24.21.0，Edge 无头浏览器，Windows；真实素材整包导入及服主 / WebSocket 准入验证仍待后续阶段。既有抓包是调查依据，不冒充新实现线上效果。未运行完整 14 回合、golden、真实多人线上压测或全量 CI。

本地独立目录：`.cache/asset-cache-pack/Stronghold-Protocol-catalog-dd40447a61c1.json`，4.37 MiB，SHA-256 `046836292b8ef9adc7af57117204ba4555849cde46e7bdd0575fe96ac32de566`。内容版本 `dd40447a61c10c9d655907a5ce237cec8e2a5f485a5de202a5854c3f85bad0a9`；与已分发完整包一致，不需要重做大 ZIP。生成物为 Git 忽略内容，未上传。

## 结果、遗留与接手

- 实现结果：目录阶段本地实现与定向 / Edge 验证完成；服主准入进行中。
- 未完成：严格模式的客户端进度上报、服务端校验、动态设置及真实素材整包导入；目录导出兼容已核验。服务器效果待部署测量。
- 提交 / 远程 / 素材 / 线上：目录阶段分批本地提交；无远程操作；现有素材与 ZIP 未修改；未部署。
- 接手入口：`server/http/assetCache.js`、`public/js/assetCache.js`、`public/js/asset-cache-worker.js`、`public/asset-cache-sw.js`、`server/serverSettings.js`、`server/lobby.js`、本文。

## 后续补充

开发中随验证补充。
