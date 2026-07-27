# MySQL Compare — Agent 指南

## 项目概述

基于 **Tauri 2 + React + TypeScript + Vite** 的桌面数据库客户端。`main` 为全 Rust 后端；完整 Electron / Web 版在 `electron` 分支。`src/main`、`src/preload`、`src/web` 等 Electron/Web 代码已从 `main` 删除，parity 参考实现请查阅 `electron` 分支。

## 技术栈

- **Shell**: Tauri 2（`src-tauri/`）
- **Backend**: Rust（sqlx MySQL/PG、redis、ssh2）
- **Frontend**: React 19 + Zustand + Tailwind CSS 4 + Monaco
- **桥接**: `src/renderer/lib/tauri-api.ts` → `invoke` / `listen`

## 目录

```text
src/renderer/           React UI
src/shared/             AppAPI / types 契约
src-tauri/src/
  commands/             Tauri commands
  drivers/              mysql / pg / redis
  ssh/                  tunnel / sftp / terminal
  diff/ sync/           对比与同步
  store/                connections + host keys
```

## 命令

```bash
npm run dev
npm run dev:ui   # 仅前端，浏览器预览（走 dev mock，不需要 Tauri）
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 浏览器预览

`npm run dev:ui` 在普通浏览器里跑 renderer。此时没有 Tauri IPC，
`bootstrapApi()`（`src/renderer/lib/api.ts`）会在 `import.meta.env.DEV` 下装载
`src/renderer/lib/dev-mock-api.ts` —— 一份返回相同 `IPCResult<T>` 信封的确定性
假数据实现（4 个连接：mysql / mysql+SSH / postgres / redis）。生产构建里该分支
被 DCE 掉，不会进包。

query 开关（仅 dev）：

- `?mock=slow` —— 放大所有延迟，便于观察 loading / 进度 / 流式状态
- `?mock=error` —— 除 `connection.list` 外全部返回错误信封，便于观察错误态

## UI 基元（设计系统）

`src/renderer/components/ui/` 是共享设计系统的实现，由 `ui/index.ts` 统一导出。
颜色/间距/层级只来自 `src/renderer/styles/tokens.css`，不要写死颜色或新增 token。

- 交互层：`Popover` / `DropdownMenu` / `ContextMenu` / `Tooltip` / `Dialog` /
  `ConfirmDialog` / `Drawer` / `CommandPalette`。定位与视口裁剪统一走
  `_internal/useFloating`，关闭走 `_internal/useDismiss`，焦点陷阱走
  `_internal/useFocusTrap`。**不要再手写 `fixed inset-0 z-[...]` 浮层。**
- z 轴顺序只有一套（tokens.css 的 z 阶梯）：写
  `z-[var(--ds-z-popover)]` 这种形式，Tailwind 4 没有 `--z-*` 命名空间，
  `z-popover` 之类的类名不会编译。
- Esc **只关最上面一层**：`useDismiss` 自己维护浮层栈（DOM 包含关系优先，
  其次挂载顺序），一次按键只消费一层。所以对话框里开的菜单按 Esc 只关菜单。
  自己写的键盘处理如果消费了 Esc（例如清空搜索框），要 `stopPropagation()`，
  否则它外面的浮层也会一起关掉。
- 图标按钮一律用 `IconButton`（`label` 必填 → `aria-label` + `Tooltip`）。
- 搜索/过滤框一律用 `SearchInput`；需要“清空 = 撤销已应用的过滤”时传 `onClear`。
- 破坏性操作一律走 `ConfirmDialog`，不要用 `window.confirm`。
- 长任务用 `ProgressBar` / `Toolbar.progress`，取消按钮必须和进度在一起。
- Toast 用 `src/renderer/store/toast-store.ts`（`toast.show/update/dismiss`），
  视图层由 `App.tsx` 的 `<Toaster />` 渲染；`useUIStore().showToast` 只是
  兼容适配器。`danger` 级别默认不自动消失。
- 数值格式化用 `src/renderer/lib/format.ts`（`formatBytes` / `formatNumber` /
  `formatDateTime`），不要再各自写一份。
- 多行文本用 `Textarea`（`ui/input.tsx`），不要再手写 `<textarea className=...>`。
- `Toolbar.subtitle` 会 `truncate`；**必须留住的那一条信号**（无主键的
  `Badge tone="warning"`、SQL 控制台的选中提示）放 `subtitleSlot`，它不截断，
  窄窗口下先牺牲 `subtitle`。

### 设计系统扫描（`src/renderer/design-system-sweep.test.ts`）

蓝图 §5 chunk 12 的验收清单原本是一串一次性 grep。一次性的 grep 会腐烂，所以它们
现在是测试：写死颜色、`confirm()`、`text-[11px]`、数字 z-index、手写全屏浮层、
`eslint-disable` / `@ts-ignore`、`action={null}` 的空状态，都会在 `npm test` 里挂掉。

**规则命中而新代码确实合理时，扩大规则旁边那个很窄的白名单并写清理由，不要删规则。**
目前只有两条白名单：

- `components/icons/EngineIcon.tsx` —— MySQL / PostgreSQL / Redis 的官方商标色，
  是全应用 `tokens.css` 之外**唯一**允许出现 hex 的地方。会随主题变色的商标就不是
  商标了。别往这里加非 logo 的颜色。
- `components/ui/dropdown-menu.tsx` 的 `outline-none` —— 菜单列表本身是整个菜单的
  唯一 tab stop，焦点通过 `aria-activedescendant` 委派给当前行，所以环画在
  **当前行**（`ROW_ACTIVE_RING`）上而不是整个菜单外面。除此之外任何地方都不许
  关掉焦点环。

## 应用外壳（`src/renderer/components/layout/`）

`App.tsx` 只有 `<AppShell />` + `<Toaster />`。外壳分四个区域，每层都
`overflow-hidden`，滚动只属于具名区域：

```
AppTitlebar   36px  应用菜单 · 标题 · Diff & Sync · New ▾ · ⌘K · ⚙
SidebarRail / Sidebar   44px 图标栏（⌘\ 折叠）或可调宽度的树
Workspace     flex-1  文档标签页
AppStatusBar  24px  后台任务（点开是任务列表 + 每项 Cancel）· 上下文 · ⌘K 提示
```

- **不要再往侧边栏头部塞全局功能**。主题、语言、连接管理都在
  `components/settings/SettingsDialog.tsx`（⌘,），Diff & Sync 是标题栏上的
  带文字按钮（⌘D）。`SidebarAppMenu` 已删除。
- 三个外壳浮层（命令面板 / 设置 / 快捷键）的开关状态在
  `layout/shell-context.tsx`，用 `useShell()` 读；它只在 `AppShell` 里可用。
- **凡是从主界面下放的功能，必须在 `layout/useCommands.ts` 注册一条命令**
  —— 这是 IA 精简不丢功能的唯一保证（DESIGN-SYSTEM §9 规则 1）。
- 快捷键只有一处实现：`hooks/useGlobalShortcuts.ts`（挂在 `AppShell`），
  文档表在 `layout/shortcut-registry.ts`，`?` 面板由它生成。**不要在视图里
  再加 window 级 keydown。** 新增绑定要同时改这两个文件。
- `⌘F` / `⌘R` / `⌘S` / `⌘J` 是「全局按键、视图目标」：视图用
  `useAppAction(id, active ? handler : null)`（`lib/app-actions.ts`）登记，
  外壳只负责派发。**多标签页同时挂载，未激活的视图必须传 `null`**，否则后台
  标签会替前台标签响应。没人登记时外壳不会吞掉按键。
- 标签页标题和图标统一走 `lib/tab-presentation.ts`（`getTabDisplayTitle` /
  `getTabIcon` / `getViewContext`），不要再各写一份 switch。
- localStorage 只能由 `components/settings/storage-maintenance.ts` 清理
  （SQL 历史 / diff 最近组合 / 隐藏列 / 布局），别在别处 `removeItem`。

### 侧边栏（`layout/Sidebar*`）

- `Sidebar.tsx` 只管宽度、拖拽分隔条和树失效副作用；树在 `SidebarTree.tsx`，
  浮层在 `SidebarOverlays.tsx`，两者都直接读 `sidebar-store`，**不要再加 props**。
- 所有动作都在 `layout/sidebar-actions.ts`（`useSidebarActions()`，内部用
  `getState()`，对象是稳定的）。新增树操作写在这里，不要写回组件。
- 菜单只有一份：`layout/sidebar-menus.ts` 每种对象一个 builder，行上常驻的 `⋯`
  和右键菜单渲染同一个数组。**新增菜单项只改这里。**
- 破坏性操作一律 `sidebar-store.pendingConfirm` → `SidebarConfirmDialog`
  （复制表 / 清空 / 删表 / 删库 / 删连接）。删库要求输入库名。
- 树的行模型是扁平的：`layout/sidebar-tree-rows.ts` 把连接/库/表/Redis Key 摊平成
  一维数组并算好 `focusIndex` / `parentIndex`，方向键和首字母跳转都依赖它。
  Redis 的 `:` 分组构建在 `layout/redis-key-tree.ts`（纯函数）。
- 重命名对两种引擎都是行内编辑（`TreeRow.editing`，`F2` 触发），没有重命名对话框。

### 表标签页（`pages/Workspace.tsx` + `components/table-view/`）

- 标签条是 `ui/tab-strip.tsx`（拖拽排序 / 中键关闭 / roving tabIndex / 一份右键
  菜单 builder），32px。**不要再手写标签条。**
- Data / Structure / Info 不再是独立的一行：`Workspace` 造好
  `<Tabs variant="pill" size="sm">` 后作为 `tabs` 传给三个视图，各自放进自己的
  `Toolbar center`。改子 tab 仍然只能用 `setTableTab(tabId, kind)`。
- 三个表视图 + `DatabaseInfoView` 都是 `Toolbar`（title=表名 mono ·
  subtitle=`连接 / 库 · 引擎` · center=子 tab · 最多 4 个 action · 一个 `⋯` ·
  底边 2px 进度线）+ 可选 filters 行。无主键警告是 subtitle 里的
  `Badge tone="warning"`，**不要再加横幅**。
- 数据工具栏常驻只有：⟳ / + Insert / 🗑 Delete n。Export、Columns、Wrap、
  Density、Rows per page、复制选中行、清空选中、以及表对象自身的动作
  （重命名 / 复制 / CREATE / 导入 / 清空 / 删表）全在 `⋯` 里；表对象那一段直接
  复用 `layout/sidebar-menus.ts` 的 `buildTableMenuItems`，**不要另写一份**。
- 被下放的 Columns / Export 通过 `lib/app-actions.ts` 的
  `open-column-picker` / `export-current-view` 在 `⋯` 之外还挂在 ⌘K 上
  （DESIGN-SYSTEM §9 规则 1）。
- 网格是 `ui/data-table.tsx` 的 `variant="grid"`：粘性表头、`indeterminate`
  全选、行可聚焦（`Enter` 打开行编辑）、行右键菜单、300ms 骨架屏。选择模型仍是
  `Set<number>`（Shift 连选在 `table-selection-utils.ts`），通过
  `selection.onToggle` 交给 `DataTable`。
- 分页条是 24px（`h-statusbar`）。每页行数的 `<Select>` 只留在
  `TableCompareView`（它没有工具栏）；表标签页里它是 `⋯` 的
  `Rows per page` 子菜单，两边都读 `PAGE_SIZE_OPTIONS`。
- 删除行走 `table-data-row-hooks.ts` 的 `requestDeleteRows` →
  `pendingDelete` → `TableDataView` 里的 `ConfirmDialog`；删表走
  `sidebar-actions.requestDropTable`，和树用同一个确认框。**不要再用
  `confirm()`。**

### SQL 控制台（`components/sql/`）

- 四个文件，职责分明：`SQLQueryView.tsx`（Toolbar + `SplitPane` + Monaco +
  历史 Dialog）、`SQLResultPanel.tsx`（idle / error / rows / mutation / batch
  五种结果态）、`SQLExplainPanel.tsx`（EXPLAIN 双栏）、
  `sql-result-normalize.ts`（纯函数：驱动返回值归一化 + TSV/JSON 序列化 +
  错误分行）。**新的结果形态加在 `sql-result-normalize.ts` 的联合类型里**，
  别在视图里再判一次 `typeof`。
- 常驻动作只有 History 和 Run（带 `Kbd ⌘↵` 与 `aria-keyshortcuts`）。执行选中 /
  EXPLAIN / 打开文件 / 重置 / 结果面板开关 / 复制结果 / 清空历史全在 `⋯`。
- 上下分栏是 `ui/split-pane.tsx` 的 `direction="vertical"`，沿用旧的
  `mysql-compare:sql-editor-percent` 键、42% 双击复位，并获得了键盘调整。旧值
  存的是百分数（`42`），`migrateStoredEditorRatio()` 在模块加载时改写成比例
  （`0.42`）——**不要删掉这个迁移**。
- ⌘J 折叠结果面板：`SplitPane collapsible="second" collapsedSize={0}`，通过
  `lib/app-actions.ts` 的 `toggle-bottom-panel` 注册，必须传 `active`，否则后台
  标签页会替前台响应。
- `db.executeSQL` 没有取消通道，所以 Run 只有 `loading` + 工具栏不确定进度线，
  **不要伪造 Cancel**，也不要把查询登记进 `job-store`（那会给出一个假的取消
  按钮）。

### Diff & Sync（`components/diff/`）

- 布局是 `Toolbar` → 一个 `ScrollArea`（里面是可折叠的 setup `Panel` +
  结果 Tab）。常驻动作只有 Compare（运行时旁边多一个 Cancel）和 Plan Sync；
  Compare rows / 并行度 / 重新对比 / 交换端点 / 导出差异报告 / 清空最近组合
  全在 `⋯`。
- **对比的取消是「渲染端取消」**：`diff.table` 没有取消通道，
  `diff-panel-hooks.ts` 的 `stopCompare()` 只是把 `compareRunIdRef` 加一，
  让在途结果作废并停止发起后续请求，然后把 phase 置成 `cancelled`
  （已完成的结果保留）。取消统一走 `job-store`：工具栏按钮、状态栏和 `⌘.`
  都调 `jobs.cancel(id)` → job 的 `onCancel` → `stopCompare()`。
  **不要反过来让 `stopCompare` 去调 `jobs.cancel`**，那是无限递归。
- `sync.execute` 同样没有取消通道，所以同步任务登记进 `job-store` 但**不带**
  `onCancel`，状态栏不会给出假的取消按钮。
- Compare rows 与并行度的唯一真值是 `settings-store`（Settings 界面编辑的就是
  它），`DiffPanelPreferences.tableCompareConcurrency` 已经不再被读取；
  `migrateStoredCompareConcurrency()` 在模块加载时把旧值搬一次，**不要删**。
- `diff-panel-utils.ts` / `table-compare-diff.ts` / `sync-request.ts` /
  `table-diff-request.ts` 是纯模块，本次改版刻意没动它们（它们的测试是护栏）。
  所以「取消后 queued/comparing 该显示成什么」是**展示层**的映射
  （`ComparisonStatusPanel.entryDisplayStatus`），不是新的 entry 状态。
- 从数据库行的「Compare this database…」进来时，`ui-store.requestDiffCompare()`
  发一个自增 id 的一次性事件（不持久化），`DiffPanel` 消费它填源端、展开
  setup、把焦点放到目标端连接。**不要把预填塞进 `RightView.diff`** —— 那个
  view 的 tabId 恒为 `diff` 且会被持久化，重启后会莫名其妙地重放。
- 每条结构差异行都必须带 `DiffGutter`（`+/−/~`），颜色只是补强
  （DESIGN-SYSTEM §1.5：深色下绿/红在红绿色盲下 ΔE 只有 5.6）。

### 表对比（`components/diff/TableCompare*`）

- 文件分工：`TableCompareView.tsx`（布局 + 四个动词：复制 / 删除 / 覆盖 /
  跳表）、`TableCompareToolbar.tsx`（纯展示，唯一的 `⋯`）、
  `TableComparePanes.tsx`（`SplitPane` + 同步滚动）、`TableComparePane.tsx`
  （单侧表格）、`table-compare-data-hooks.ts`（两侧取数、对齐、选择）、
  `table-compare-presentation.tsx`（**唯一**决定 diff 符号的地方）、
  `table-compare-session.ts`（tab 描述 / sessionId）。
- **符号是行级的，两侧同号**：`+` 仅源端、`−` 仅目标端、`~` 字段有变更、
  空白 = 相同。因为图例（filters 行）就是这三条，若两侧镜像取号，图例在目标端
  会自相矛盾。`buildRowDiffKinds()` 合并 `RowDiffLookup.source|target`，
  否则「仅目标端」的行在源端面板上取不到号。
- 两个入口必须产出**同一个** `compareSessionId`：`ui-store.getTabId` 用它当
  tabId。所以 `DiffPanel.openCompareView` 和表行 `⋯` 的「Compare With...」都走
  `buildTableCompareView()`，不要再手拼字符串。
- 表行的「Compare With...」在 `sidebar-menus.buildTableMenuItems`（非 Redis），
  动词在 `sidebar-actions.compareTableWith`，对话框状态在
  `sidebar-store.tableCompareTargetDialog`，由 `SidebarOverlays` 渲染
  `TableCompareTargetDialog`；`⌘K` 里也有同一条命令。
- 覆盖目标表登记 `job-store`（kind `sync`，`tabId = table-compare:<sessionId>`）
  但**不带** `onCancel` —— `sync.execute` 没有取消通道。
- 分页条 `TableDataPagination` 不再有 pageSize `Select`：两个调用方都把它放进
  各自 `Toolbar` 的 `⋯` 子菜单，`PAGE_SIZE_OPTIONS` 只从 `settings-store` 读。

### SSH 三件套与导出任务（`components/ssh/` + `DatabaseExportTaskView`）

- 文件管理器：`Toolbar`（⟳ / `Upload ▾` SplitButton / Download / 一个 `⋯`）+
  面包屑与过滤行 + `DataTable`。旧的 7 个平铺按钮只作用于"选中行"，现在**每行
  常驻一个 `⋯`**（打开 / 下载 / 重命名移动 / 删除），工具栏的 `⋯` 是同一组动作
  作用在选中行上，外加新建文件夹和上传文件夹。
- 路径有两种形态：面包屑（默认，每段可点）和可编辑输入框（铅笔按钮切换，
  Enter 应用、Esc 还原）。**不要删掉输入框**，任意路径跳转只有这一个入口。
- 终端：`Toolbar` + 状态 `Badge`（统一状态词汇），`⋯` 是重连 / 清屏 / 复制全部。
  重连 = `reconnectToken` 自增让整个 effect 重跑，清理函数负责关会话、销毁实例。
  xterm 是 canvas，不能用 CSS 变量，`readTerminalTheme()` 每次换主题从
  `--ds-canvas` / `--ds-fg` / `--ds-border-strong` 读一次，**不要写死十六进制**。
- 编辑器：`Toolbar` + 脏标记 `Badge` + 常驻 Save（`⌘S` 走 `lib/app-actions.ts`
  的 `save`，Monaco 内部的绑定保留），重新载入和复制路径在 `⋯`。
- **标签页关闭守卫的签名带 `reason`**（`ui-store.TabCloseReason`）：
  `close`（用户关这一个标签页）允许视图弹自己的 `ConfirmDialog` 并先返回
  `false`，确认后置 ref 再调一次 `closeTab`；`check`（批量关闭、文件被移动）
  必须无副作用地回答"干不干净"，由提问方自己确认。三个批量关闭动作和
  `hasUnsavedSSHPathTabs()` 都传 `check`，所以不会叠出三个对话框。
- 导出任务登记 `job-store`（kind `export`，`tabId = database-export:<taskId>`）
  但**不带** `onCancel` —— `db.exportDatabase` 既没有进度事件也没有取消通道，
  所以进度线是不确定态，状态栏也不会给出假的取消按钮。重试是唯一的手动触发。
- 状态栏任务列表里，属于某个还开着的标签页的任务多一个"查看标签页"按钮
  （§2.10：任务列表的意义就是找回你切走的那份工作）。

## 状态（`src/renderer/store/`）

| Store | 负责 | 是否持久化 |
| --- | --- | --- |
| `ui-store.ts` | 工作区 tab、`rightView`、拖放/重载事件 | ✅ `mysql-compare:workspace` |
| `sidebar-store.ts` | 侧边栏树、菜单、对话框、宽度、折叠 | 仅 `width` / `collapsed` |
| `settings-store.ts` | 密度、色盲 diff、默认分页、换行、对比选项 | ✅ `mysql-compare:settings` |
| `job-store.ts` | 所有长任务（`idle→queued→running→done/error/cancelled`） | ❌ 会话内 |
| `toast-store.ts` | 堆叠 toast | ❌ |
| `connection-store.ts` | 连接列表 | ❌（后端持有） |

- **主题和语言不进 `settings-store`**：`theme/index.ts`（`useTheme()`）和
  `i18n/index.ts`（`useI18nStore`）各自已有持久化，Settings 界面只做代理，
  否则 `<html class="dark">` 会和 store 失步。
- 表的 Data/Structure/Info 子 tab 存在 `tab.view.tableTab` 上，改它只能用
  `setTableTab(tabId, kind)`；`getTabId()` 不含 `tableTab`，走 `setRightView`
  会重建 tab 对象（丢滚动位置和选择）。
- `ui-store` 重启后会恢复 tab，但**不会**主动连数据库；`ssh-terminal`
  （活的 PTY）和 `database-export`（一次性任务）在恢复时被丢弃。
  持久化 JSON 是可被手改的，`restorePersistedUIState()` 会逐个校验 view 形状。
- 长任务一律登记到 `job-store`（`jobs.start/update/finish/cancel`），
  三个消费方读同一份状态：`Toolbar.progress`、TabStrip 的 tab 状态点、
  状态栏任务列表。同一个任务同时只出现在一层（DESIGN-SYSTEM §7.2）。
- **`src/shared/app-api.ts` 里没有任何取消通道**（grep `cancel` / `abort` 为空）。
  所以只有库对比传了 `onCancel`（`diff-panel-hooks.stopCompare` 是渲染端取消：
  作废在途结果并停止发起后续请求）；同步 / 表覆盖 / 导出都是**不带 `onCancel`**
  地登记，状态栏和 `⌘.` 因此不会长出一个骗人的取消按钮。
  哪天 `src-tauri` 加了取消，接线点是 `SyncPanel.executeSync`、
  `TableCompareView.overwriteTargetTable`、`DatabaseExportTaskView.runExport`
  和 `SQLQueryView.runSQL`（后者还要顺带把查询登记进 `job-store`）。
- 色盲 diff 开关只写 `<html data-colorblind-diff>`，tokens.css 里换
  `--ds-diff-add/-del`，组件不需要任何分支。
- **持久化 JSON 一律不可信**，三个持久 store 都在 `merge`/`migrate` 里做形状校验
  （`restorePersistedUIState` / `sanitizePersistedSettings` / sidebar 的 `merge`）。
  `settings.defaultPageSize` 会直接进 `db.queryRows({ pageSize })`，非法值会让所有
  表标签页打不开，所以它只接受 `PAGE_SIZE_OPTIONS` 里的值 —— 这份列表必须是
  `TableDataPagination` 那个 `<Select>` 的子集，否则设置里的默认值在网格里显示成别的数。

## 规范

- 不要自动跑长驻 `tauri dev`
- 同理不要自动跑 `npm run dev:ui`
- 桌面不再依赖 Node sidecar / Express
- 对照 `electron` 分支行为做 parity，优先 happy path
