# init.sh 创建（Dev）

> 触发：项目根不存在 `init.sh`（通常只有项目首个 feature 会遇到）。已存在则直接 `chmod +x init.sh && ./init.sh`，不需要读本文件。

从 `team3/cli/init.sh.template` 拷贝到项目根并 chmod +x，然后按需补 feature 特定依赖和启动命令。脚本需做到：

1. **启动前先 `env -u` 清理父进程污染**（`__NEXT_PRIVATE_STANDALONE_CONFIG` / `__NEXT_PRIVATE_ORIGIN` / `NEXT_DEPLOYMENT_ID` / `TURBOPACK` / `NODE_PATH`）— 详见模板和同目录 `dev-tech-stack.md` §2
2. **`npm install --include=dev --prefer-offline`** — 强制含 devDeps
3. 启动必要的 server / service（前端 dev server、后端 API、数据库等，写日志便于排查）
4. 打印关键访问信息（端口、URL、健康检查路径、停止方式），让人类或下一个 agent 一眼能用
5. 固定业务 App 端口：脚本内写 `APP_DEV_PORT=3001`，不要读取环境变量 `PORT`
6. 写 PID 文件；关闭服务只支持 `./init.sh stop`，只能关闭 PID 文件且是当前项目的进程
7. 如果 `3001` 被占用但不是当前项目 PID，直接报错退出，说明占用 PID；**禁止自动 kill 端口占用进程**

注意：

- `init.sh` 属于项目级基础设施，不是某个 feature 的私有产物——本轮新建后，在 STEP 7 交付总结中显式提到，便于 Arch 在 commit 时一并提交
- 后续 feature 增加新依赖时，**就地补充** `init.sh` 而不是另起脚本，保持向后兼容
