# 隐私政策 / Privacy Policy

最后更新：2026-11-28

**投简历神器（Resume Autofill）不出售任何数据。你的资料只存在你自己的浏览器里；只有你主动选择「用 AI 整理简历」时，那一份简历 PDF 才会离开你的电脑。**

## 存在你电脑上的

- 你填写的资料（姓名、联系方式、教育和工作经历、网申账号、简历文件、照片）只保存在你自己电脑上这个浏览器的扩展存储里（`chrome.storage.local`）。
- 卸载扩展，或在资料页点「清空全部数据」，资料就彻底删除。

## 会联网的情况

扩展的内容安全策略（`connect-src`）把联网限定在下面列出的地址，浏览器会拦下其他任何联网行为。

1. **用插件自带的 AI 整理简历（只在你点了才发生）。** 在「文档」里上传简历只是存在你的浏览器里，不会发到任何地方。只有你在「我的资料 → 导入简历」里选了一份 PDF、点「用 AI 整理」，扩展才把**这一份 PDF**发到投简历神器的服务器（Cloudflare Workers），服务器交给 Anthropic 的 Claude 读出姓名、学校、经历等内容，再把整理结果返回给扩展，写进「我的资料」。
   - 服务器不保存简历，也不保存整理结果，不写进日志。数据库里只记：时间、扩展的随机编号、用了多少 token、成功没有（用来限额和控制费用），以及你当天 IP 地址加盐后的哈希（用来防止滥用，从哈希认不出 IP）。
   - Anthropic 按它的商业服务条款处理这份简历，默认不用来训练模型。
   - 不想上传：用旁边的「用你自己的 AI」：复制提示词，自己用 ChatGPT 或 Claude 整理后粘贴回来，这条路不经过我们的服务器。
2. **匿名使用统计。** 扩展会发送少量匿名事件，比如「第一次打开后先点了哪一页」「上传了几份简历」「AI 整理成功没有」。事件里只有事件名和几个数字或选项，**不含任何资料、简历内容、网址或账号**；用来区分安装的编号是第一次打开时随机生成的，和你本人对不上。可以在「我的资料 → 隐私」里关掉。
3. **在线更新岗位（默认打开，可以关掉）。** 扩展从投简历神器的服务器下载公开的岗位列表；服务器转发的是 `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/` 上每天更新的那份，服务器连不上时直接从 GitHub 下载。只下载、不上传：不带 cookie、来源网址、你的资料或任何标识。数据只按 JSON 处理，不会当作代码执行。可以在「我的资料」里关掉。
4. **Autopilot 用的 AI（只在你选了一家之后）。** Autopilot 匹配岗位、回答申请表里的开放问题时，会把你的资料摘要（意向、教育、经历、技能）和岗位介绍发给你在「Autopilot → AI 设置」里选的那一家：DeepSeek、阿里千问、OpenAI 或 Anthropic，用的是你自己填的 API Key（只存在你的浏览器里），不经过我们的服务器，按那一家的条款处理。选「Claude 订阅（Claude Code）」时，只发给你自己电脑上运行的程序（`127.0.0.1`），再由你的 Claude Code 处理。不选就不发。
5. **反馈。** 你在右下角「反馈」里写的话和选填的联系方式，发到投简历神器的服务器。不写不发。

## 写进网页的

- 你点「填写当前页面」或打开了自动填写时，扩展把资料写进**你正在看的那个网页的表单里**。之后是否提交给那个网站，由你自己决定——扩展不会替你点提交。
- 「打开网页时自动填写」需要访问网页的权限，这个权限由你开关，关掉后扩展碰不到任何网页。
- **Autopilot** 只投你确认过的岗位（或你打开了「自动确认」后达到分数的岗位）：在后台标签页打开那家公司的招聘官网，用你的资料登录、注册、填表并提交。验证码发到你资料里的手机号，由你自己在 Autopilot 页面输入；人机验证由你自己完成。

有问题请到代码仓库提 issue。

---

**Resume Autofill does not sell any data.** Everything you enter (contact details, education and work history, application-site logins, résumé files, photo) is stored only in this browser's extension storage on your own computer. The extension's content security policy limits network access to the addresses below:

1. **AI résumé import, only when you start it.** Uploading a résumé under "文档" only stores it in your browser. When you pick a PDF under "我的资料 → 导入简历" and click "用 AI 整理", that one PDF is sent to the Resume Autofill server (Cloudflare Workers), which passes it to Anthropic's Claude to extract your details and returns the result to the extension. The server does not store the PDF or the result and does not log them; it records only the time, the extension's random install ID, token usage and success (for quotas and cost control), and a salted daily hash of your IP address (for abuse prevention). Anthropic processes the file under its commercial terms and by default does not train on it. You can instead copy the prompt into any AI tool yourself ("用你自己的 AI"), which bypasses our server.
2. **Anonymous usage events**, such as which page you opened first, how many résumés you uploaded and whether AI import succeeded. They contain no profile data, résumé content, URLs or accounts, and use a random install ID. You can turn them off under "我的资料 → 隐私".
3. **Online job updates (on by default, can be turned off)**: downloads the public job list from the Resume Autofill server, which relays `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/`, or from GitHub directly, without cookies, referrer, your data or any identifier.
4. **Autopilot AI, only after you pick a provider**: a summary of your profile and the job text go directly to the provider you chose (DeepSeek, Alibaba Qwen, OpenAI or Anthropic) with your own API key, or to a program on your own computer (127.0.0.1) when you choose Claude Code.
5. **Feedback**: what you write in "反馈", plus any contact you choose to add, goes to the Resume Autofill server.

Your data is otherwise written only into the form on the page you are viewing, at your request; whether to submit it is up to you. Autopilot applies only to jobs you confirmed (or that passed your auto-confirm score), signing in, registering, filling and submitting on the company's own site; SMS codes and human verification are done by you. Uninstalling the extension or choosing "清空全部数据" deletes everything stored locally.
