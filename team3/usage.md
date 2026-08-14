## team3 两种启动

设计见 `spec/packaging_design.md`。

两种启动方式：

```bash
# 方式 1：源码 dogfood（开发者）
cd team3
node build/embed-prompts.js      # 生成 daemon/src/embedded-prompts.js；改 prompt 后必须重跑
cd web
TEAM3_SUPERMAN=1 PORT=9001 npm run dev

# 方式 2：打包产物 dogfood / 终端用户
cd team3
bash build/build.sh                              # 产出 pkg/team3-x.y.z.tgz，不会自动安装
npm install -g ./pkg/team3-*.tgz                # 必须加 ./，否则 npm 会当成 GitHub 仓库
team3 start -p 9001 --superman
```

---

## 源码 zip 打包

只打 git 已跟踪文件（`example/` 等已被 `.gitignore` 忽略，不会进包）。
- **会打进包**：顶层目录 `draft/`、`team3/`，以及 `.gitignore`。
- 跳过 `node_modules`、`.next`、`embedded-prompts.js` 等编译后产物。

### 打包

在 **仓库根目录**（`team_coding3/`）执行：

```bash
cd team_coding3
git archive --format=zip HEAD -o team_coding3.zip
```

### 使用

```bash
# 确认文件
unzip team_coding3.zip
ls .gitignore draft team3   
# 安装依赖
cd team3
npm install --prefix web && npm install --prefix daemon
# build
bash build/build.sh
npm install -g ./pkg/team3-*.tgz
# 启动 http://localhost:9001
team3 start -p 9001
```