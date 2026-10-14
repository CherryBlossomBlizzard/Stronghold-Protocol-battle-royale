# DEV-20261014-04 · 公告列表置顶与删除命令

## 基本信息

| 字段 | 内容 |
|---|---|
| 开始 / 最后更新 | 2026-10-14 / 2026-10-14，Asia/Shanghai |
| 状态 | 进行中 |
| 类型 | 修复 / 功能 |
| 分支与开始 HEAD | `feat/IncreasePlayerCapacity`，`4e0d0a9433415b99b1b8308add841d8689611e44`；开始时工作区干净 |
| 上游基线 | 已合并 v0.2.6，`488db49f11daf862b67ce26fa4cf89aa6cba2466`；仅核对本地记录与源码，未联网刷新 |
| 提交归属 | 列表置顶与本阶段记录同一提交，按记录路径查询；删除部分后续另交 |
| 关联 | [D014](../DECISIONS.md#d014)、[D015](../DECISIONS.md#d015)、[前次手机公告修复](2026-10-12-04-announcement-mobile.md) |

## 需求、范围与验收

用户报告置顶只影响默认打开哪篇公告，历史列表仍按原发布位置展示，要求置顶期间列表首位显示；同时增加删除公告功能与对应管理命令。

范围为公告列表排序、私有文件管理/CLI、共享元数据与免提示兼容、定向测试及使用/开发文档。验收：置顶在列表首位，切换和取消置顶不破坏原发布顺序或当前选择；指定 ID 的公告可通过 CLI 删除，删除置顶自动清 pin，重启后仍生效；删除不使旧公告重新提醒；图片和用户手写草稿不自动删除，HTTP 仍无写入能力。

## 调查与决定

| 问题 | 证据或来源 | 结论及确定程度 |
|---|---|---|
| 列表没有真正置顶 | `AnnouncementDialog` 直接遍历 `state.items`；索引保存发布顺序 | 源码确认；仅派生展示数组，不重排持久索引 |
| 删除最新会回退提醒版本 | `readAnnouncementIndex` 原要求总体 revision 等于首项；免提示按总体版本匹配 | 源码确认；删除须保留最近发布 revision，删除为空时也保留；仅新发布更新它 |
| 删除涉及哪些文件 | 索引、`<id>.md` 由工具管理；图片 assets 可能被多篇共享 | 沿用单目录锁与原子索引替换，索引提交后删除对应正文；不删除共享图片、输入草稿或其他文件 |
| 紧急通知撤回 | 通知带不可变版本、浏览器独立队列，未设计远程撤回 | 删除不新增撤回协议；已显示正文无法远程抹除，尚未读取的删除正文返回现有不可用提示；具体边界在使用说明补充 |

## 实现或操作

| 文件 / 函数 / 操作 | 变化或结果 | 为什么这样做 |
|---|---|---|
| `announcementHistoryItems` / `AnnouncementDialog` | 派生置顶优先的展示数组，其余保持发布顺序 | 取消置顶即可恢复原位置，保留最新发布和免提示语义 |

删除命令与相关验证进行中，完成后补充。

## 验证

| 命令或场景 | 环境 / 数据 / 版本 | 实际结果 |
|---|---|---|
| `node --test test/ui/announcements-ui.test.js test/ui/announcements-model.test.js test/docs-consistency.test.js test/docs-paths.test.js` | 列表置顶、取消、原发布顺序、选择与既有生命周期；文档 | 75/75 通过；一项旧列表顺序断言按用户要求更新，新加临时置顶/切换/取消测试 |
| `node node_modules/eslint/bin/eslint.js shared/announcements.js public/js/ui/announcements.js test/ui/announcements-ui.test.js`；`git diff --check` | 列表相关 JS 与差异 | 通过 |
| `node .cache/announcement-admin/pin-qa.mjs` | Edge 155.0.4283.45 无头；1280×720 桌面和 844×390 横屏触屏；真实标题入口及三条公告，未开房或开局 | 两种布局通过：旧 pin 首位、切换 pin、取消恢复时序、保留当前阅读与总体 revision；状态中原发布数组未变，无页面错误 |
| 置顶浏览器资源关闭 | PID 105720、端口 63643 | finally 关闭浏览器和服务；连接端口返回 ECONNREFUSED，浏览器进程退出 |

删除刷新检查与最终文档检查待完成。不运行完整十四回合、golden 或真人压测；本次不改变游戏规则或战斗流程。

## 结果、遗留与接手

- 实现结果：列表临时置顶部分完成并验证；删除部分进行中。
- 未确定或未完成：删除、免提示回归与 Edge 检查待完成。
- 提交 / 远程 / 素材 / 线上：按功能本地提交；未操作远程、素材或部署。
- 接手入口：`shared/announcements.js`、`server/announcements.js`、`tools/announcements.mjs`、`public/js/ui/announcements.js`、`announcementModel.js`、[公告说明](../../ANNOUNCEMENTS.md)。

## 后续补充

无。
