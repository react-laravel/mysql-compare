# MySQL Compare 网页版发布至 B

2026-10-26 已验证：GitHub 托管构建、仅验证、真实发布及恢复标签构建均成功；网站位于 B，A 的网页入口已退役。网页源码来自 electron，main 的 Tauri 桌面版不作为网页源码，桌面 CI/Release 保留。

已验证的网页源码：`564f8e53570f25fe2a0dca11021dd7ce142a58da`。相对于原网页 `b927fc9748ce0988439b51ba2c6b7ea3e0ae3324`，除发布基础设施外，仅同步 main 已有的 React 19 nullable ref 类型声明一行；声明在编译时擦除。33 模块后端编译入口 SHA-256 与原网页完全相同：`1bdaa12eb7c3838d908ae37917f7a1b18bcbdec088187cc5e2c9fdd575bb6f2e`。依赖锁和运行行为未改。

构建环境是 GitHub ubuntu-24.04 / Node24.16.0，沿用 npm 锁文件并运行 typecheck、测试和 web:build。B 仅接收编译后端、dist-web 与115个生产包，不安装完整开发依赖。凭据和用户文件不进入构建包或 GitHub。

B 的 `mysql-compare-deploy` 独立账号只经强制网关执行 receive/publish/validate 三种固定操作，sudo 只允许重启 `mysql-compare.service`；不提供终端或转发，不能直接读运行账号的登录配置、会话密钥、连接文件或其他项目。GitHub Secrets 是 `B_MYSQL_COMPARE_DEPLOY_SSH_KEY` 和 `B_MYSQL_COMPARE_DEPLOY_KNOWN_HOSTS`。

发布前要求运行UID连续5次没有HTTP/SSE/数据库/SSH已建立连接。B执行包大小、路径、链接、敏感文件和内容哈希检查，并保留至少1GiB磁盘余量。失败在B恢复此前current；成功删除旧版，仅保留一个运行包。发布不改环境、持久文件或外部数据库，不执行数据库结构变更。

恢复标签：`mysql-b-verified-20261026`，工作流修订 `ebb2c43373ac417facc8503b07e4e08f13091765`，网站源码固定为上述564f提交。先验证：

```sh
gh workflow run deploy-self-hosted.yml -R react-laravel/mysql-compare \
  --ref mysql-b-verified-20261026 \
  -f source_revision=564f8e53570f25fe2a0dca11021dd7ce142a58da -f validate_only=true
```

验证通过后相同参数改 `validate_only=false` 才发布。今后 electron push 自动部署对应提交；main 的桌面push不发布网页。标签验证成功任务40341925605，真实发布40341136395，完整托管验证40340442322。

原Basic认证/会话、两份共47B持久文件保持；真实登录和95个静态资源校验通过，没有连接真实外部数据库或SSH。A已有旧文件不能在B接受写入后直接解冻作为回滚；优先在B从恢复标签重建程序，业务数据继续使用B的最新副本。
