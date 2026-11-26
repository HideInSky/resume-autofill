# 隐私政策 / Privacy Policy

最后更新：2026-11-26

**投简历神器（Resume Autofill）不出售任何数据。你的资料只存在你自己的浏览器里；只有你主动选择「用 AI 整理简历」时，那一份简历 PDF 才会离开你的电脑。**

## 存在你电脑上的

- 你填写的资料（姓名、联系方式、教育和工作经历、网申账号、简历文件、照片）只保存在你自己电脑上这个浏览器的扩展存储里（`chrome.storage.local`）。
- 卸载扩展，或在资料页点「清空全部数据」，资料就彻底删除。

## 会联网的三种情况

扩展的内容安全策略（`connect-src`）把联网限定在下面两个地址，浏览器会拦下其他任何联网行为。

1. **用 AI 整理简历（你每次确认后才发生）。** 在「文档」里上传简历后，扩展会问你要不要「整理进我的资料」。你点了「整理进我的资料」，扩展才把**这一份 PDF**发到投简历神器的服务器（Cloudflare Workers），服务器交给 Anthropic 的 Claude 读出姓名、学校、经历等内容，再把整理结果返回给扩展，写进「我的资料」。
   - 服务器不保存简历，也不保存整理结果，不写进日志。数据库里只记：时间、扩展的随机编号、用了多少 token、成功没有（用来限额和控制费用），以及你当天 IP 地址加盐后的哈希（用来防止滥用，从哈希认不出 IP）。
   - Anthropic 按它的商业服务条款处理这份简历，默认不用来训练模型。
   - 不想上传：点「只保存文件」。也可以到「我的资料」第 1 步复制提示词，自己用 ChatGPT 或 Claude 整理后粘贴回来，这条路不经过我们的服务器。
2. **匿名使用统计。** 扩展会发送少量匿名事件，比如「第一次打开后先点了哪一页」「上传了几份简历」「AI 整理成功没有」。事件里只有事件名和几个数字或选项，**不含任何资料、简历内容、网址或账号**；用来区分安装的编号是第一次打开时随机生成的，和你本人对不上。可以在「我的资料 → 隐私」里关掉。
3. **在线更新岗位（默认关闭）。** 打开后，扩展从 `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/` 下载公开的岗位列表。只下载、不上传：不带 cookie、来源网址、你的资料或任何标识。数据只按 JSON 处理，不会当作代码执行。GitHub 会像对待任何网页访问一样看到你的 IP 地址。

## 写进网页的

- 你点「填写当前页面」或打开了自动填写时，扩展把资料写进**你正在看的那个网页的表单里**。之后是否提交给那个网站，由你自己决定——扩展不会替你点提交。
- 「打开网页时自动填写」需要访问网页的权限，这个权限由你开关，关掉后扩展碰不到任何网页。

有问题请到代码仓库提 issue。

---

**Resume Autofill does not sell any data.** Everything you enter (contact details, education and work history, application-site logins, résumé files, photo) is stored only in this browser's extension storage on your own computer. The extension's content security policy limits network access to the addresses below:

1. **AI résumé import, only when you confirm it.** After you upload a résumé under "文档" and choose "整理进我的资料", that one PDF is sent to the Resume Autofill server (Cloudflare Workers), which passes it to Anthropic's Claude to extract your details and returns the result to the extension. The server does not store the PDF or the result and does not log them; it records only the time, the extension's random install ID, token usage and success (for quotas and cost control), and a salted daily hash of your IP address (for abuse prevention). Anthropic processes the file under its commercial terms and by default does not train on it. You can decline and instead copy the prompt from "我的资料" step 1 into any AI tool yourself, which bypasses our server.
2. **Anonymous usage events**, such as which page you opened first, how many résumés you uploaded and whether AI import succeeded. They contain no profile data, résumé content, URLs or accounts, and use a random install ID. You can turn them off under "我的资料 → 隐私".
3. **Online job updates (off by default)**: downloads the public job list from `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/` without cookies, referrer, your data or any identifier.

Your data is otherwise written only into the form on the page you are viewing, at your request; whether to submit it is up to you. Uninstalling the extension or choosing "清空全部数据" deletes everything stored locally.
