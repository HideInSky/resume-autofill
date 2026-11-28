# 投简历神器 · Claude 订阅桥

用你自己的 Claude 订阅（Pro / Max）当 Autopilot 的 AI，不花 API 额度。

扩展把 AI 任务（给职位打分、回答表单里的意外问题）发到你电脑上的这个小程序，
Claude Code 领任务、作答、交回。扩展只和 `127.0.0.1`（你自己的电脑）通信，
看不到你的任何 Claude 账号信息。

## 安装

1. 安装 Node.js 18 或更新版本：https://nodejs.org
2. 安装依赖：

   ```
   cd agent && npm install
   ```

3. 把它加进 Claude Code（换成你电脑上的绝对路径）：

   ```
   claude mcp add toujianli -- node <绝对路径>/agent/server.mjs
   ```

4. 复制斜杠命令：

   ```
   mkdir -p ~/.claude/commands && cp commands/autopilot.md ~/.claude/commands/
   ```

## 使用

1. 打开 Claude Code，输入 `/autopilot`，然后让它一直开着。
2. 在扩展里选择「Claude 订阅（Claude Code）」作为 AI。
3. 启动 Autopilot。想停的时候，在 Claude Code 里按 Esc 或告诉它停下。

## 说明

- 默认端口 47321，一般不用改；需要时可用环境变量 `TOUJIANLI_PORT` 修改。
- 只接受来自 Chrome 扩展的请求，别的网页访问不了。
- Claude 只回答任务，不会去访问网站或操作你的账号。
