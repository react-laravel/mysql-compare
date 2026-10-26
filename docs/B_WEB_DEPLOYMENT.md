# MySQL Compare 网页版发布至 B

网页版本来自 electron 分支，首次发布固定 b927fc9748ce0988439b51ba2c6b7ea3e0ae3324。默认 main 是 Tauri 桌面版，网页流程绝不将其当网站部署，桌面 CI/Release 不改。main 与 electron 同步网页发布基础设施；首次提交带 [skip ci]，先验证再发布。

构建在 GitHub ubuntu-24.04 / Node24.16.0 上执行，沿用网页 npm 锁文件。只运行 web:build；生产机不安装依赖。后端33个现有TS模块编译成单个JS，网站静态成品与115个所需生产包一起发布；不带Electron、Monaco编辑器开发依赖、tsx、原始环境或用户数据。许可证保留。

B 的 mysql-compare-deploy 账号独立于 runtime mysql-compare，只能通过强制网关执行 receive/publish/validate 三种固定命令；不提供终端/转发，不可直接读网站登录配置、会话/加密密钥、连接记录、进程环境或其他站点私密目录。sudo仅允许 restart mysql-compare.service。公网CI来源动态，使用这把仅限该站点的独立密钥。

GitHub Secrets：B_MYSQL_COMPARE_DEPLOY_SSH_KEY、B_MYSQL_COMPARE_DEPLOY_KNOWN_HOSTS。仅用于发布程序，不包含真实网站Basic登录信息。

发布前需runtime专属UID连续5次无ESTABLISHED套接字，包括HTTP/SSE和DB/SSH出站连接；未断开的连接会拒绝发布。上传/展开大小限制、路径/链接/秘密文件校验、哈希校验和至少1GiB磁盘余量都由B发布器执行。失败恢复原current，成功删除旧运行版，保持一个版本。运行环境和持久文件独立于代码，发布不修改它们，不自动操作任何数据库或远程SSH资源。

手动验证（source_revision应为精确网页提交）：

```sh
gh workflow run deploy-self-hosted.yml -R react-laravel/mysql-compare --ref main \
  -f source_revision=b927fc9748ce0988439b51ba2c6b7ea3e0ae3324 -f validate_only=true
```

相同参数 validate_only=false 才上传并发布。之后 electron push 自动构建对应提交；main 的 Tauri push不会发布网站。恢复标签在真实发布成功后创建，恢复时固定该标签及其source_revision；不要启用旧A的Deployer流程或通知钩子。

当前该方案尚未安装新账号/公钥/Secret，也未提交或执行真实托管流程。现有B迁移实例已通过真实Basic会话、95个静态文件/2511运行文件逐项校验；拟议发布器18项边界/回退/单版本/只检查不上传测试通过，纯代码包实际打包与发布器解包校验另有回执。GitHub业务构建仍需批准后真实验证。
