# 隐私政策 / Privacy Policy

最后更新：2026-11-24

**投简历神器（Resume Autofill）不收集、不上传、不出售任何数据。**

- 你填写的资料（姓名、联系方式、教育和工作经历、网申账号、简历文件、照片）只保存在你自己电脑上这个浏览器的扩展存储里（`chrome.storage.local`）。
- 默认不联网：没有服务器、没有统计、没有广告、没有第三方代码。
- 唯一的网络请求是「岗位」的数据，而且只在你在资料页打开「在线更新岗位」（默认关闭）之后才会发生：扩展从 `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/` 下载公开的岗位列表（各大厂招聘官网公开发布的岗位）。这个请求只下载、不上传：不带 cookie、不带来源网址、不带你的任何资料、账号或标识，也不带统计参数。下载的数据只按 JSON 数据处理，不会当作代码执行。
- 扩展的内容安全策略把联网限定在上面这一个地址（`connect-src`），浏览器会拦下其他任何联网行为。关掉「在线更新岗位」后，扩展完全不联网。
- 数据由 GitHub 提供，GitHub 会像对待任何网页访问一样看到你的 IP 地址，这一点不在本扩展控制之内。
- 资料只在一种情况下离开扩展：你点「填写当前页面」或打开了自动填写时，扩展把资料写进**你正在看的那个网页的表单里**。之后是否提交给那个网站，由你自己决定——扩展不会替你点提交。
- 「打开网页时自动填写」需要访问网页的权限，这个权限由你开关，关掉后扩展碰不到任何网页。
- 卸载扩展，或在资料页点「清空全部数据」，资料就彻底删除。

代码全部公开，可以自己核对。有问题请到代码仓库提 issue。

---

**Resume Autofill does not collect, upload or sell any data.** Everything you enter (contact details, education and work history, application-site logins, résumé files, photo) is stored only in this browser's extension storage on your own computer. By default it makes no network requests — no server, analytics, ads or third-party code. The only request happens if you turn on "在线更新岗位" (off by default): the extension then downloads the public job list from `https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/`, without cookies, referrer, your data, any identifier or tracking parameters, and treats it as JSON data only. Its content security policy limits network access to that one address. GitHub, which serves the file, sees your IP address as with any web request. Your data leaves the extension only when it is written into the form on the page you are viewing, at your request; whether to submit that form is up to you. Uninstalling the extension or choosing "清空全部数据" deletes everything.
