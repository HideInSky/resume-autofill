"""生成商店截图用的预览页（虚构数据）：src/_preview_app.html、src/_preview_panel.html（不进仓库）。
需要本地的 test/shim.js（模拟 chrome.* 接口）。用法：python3 store/preview.py"""
import base64, json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def pdf(lines):
    content = "BT /F1 22 Tf 60 730 Td (%s) Tj ET\n" % lines[0]
    y = 690
    for l in lines[1:]:
        size = 12 if l.isupper() else 10
        content += "BT /F1 %d Tf 60 %d Td (%s) Tj ET\n" % (size, y, l)
        y -= 18 if l.isupper() else 15
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            "<< /Length %d >>\nstream\n%sendstream" % (len(content), content), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = "%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs):
        offs.append(len(out))
        out += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
    x = len(out)
    out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offs)
    out += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return base64.b64encode(out.encode()).decode()


BODY = ["zhangsan@example.com  |  +86 138 0000 0000", "EDUCATION", "Example University - M.S. Statistics, 2023 - 2025",
        "Sample College - B.S. Mathematics, 2019 - 2023", "EXPERIENCE", "Example Tech - Data Analyst Intern, Jun - Aug 2025",
        "- Built funnel dashboards; found the step with the largest drop-off", "- Designed A/B tests for onboarding",
        "Demo Studio - Research Assistant, 2024", "- Cleaned survey data and ran regression analysis", "PROJECTS",
        "Churn attribution - owner", "- Segmented users and ranked churn drivers", "SKILLS", "SQL, Python, Tableau, A/B testing"]
PDFS = [pdf(["ZHANG SAN"] + BODY), pdf(["ZHANG SAN  -  Product"] + BODY), pdf(["ZHANG SAN  -  English"] + BODY)]

SEED = r'''
  <script src="../test/shim.js"></script>
  <script>
    for (const a of ['local','session']) chrome.storage[a].onChanged = { addListener() {} };
    chrome.tabs.onActivated = { addListener() {} };
    chrome.runtime.getURL = (p) => '/' + p;
    chrome.storage.local.set({ settings: { onlineJobs: true } });
  </script>
  <script src="schema.js"></script>
  <script src="regions.js"></script>
  <script src="vault.js"></script>
  <script src="apps.js"></script>
  <script>
    window.__ready = (async () => {
      const day = 86400000;
      await Vault.saveBook({ active: 0, list: [
        { name: '数据分析', resume: 'resume-data.pdf', data: {
          basic: { name: '张三', gender: '女', email: 'zhangsan@example.com', phone: '13800000000', province: '浙江省', city: '杭州市', district: '西湖区', wechat: 'zhangsan_wx', birthday: '2001-05-06' },
          account: {}, intent: { position: '数据分析师', cities: [['上海', '杭州'], ['北京'], ['全国各地']], available: '1个月' },
          education: [{ school: '示例大学', degree: '硕士', major: '统计学', start: '2023-09', end: '2025-06', rank: '前10%' }, { school: '样例学院', degree: '本科', major: '数学与应用数学', start: '2019-09', end: '2023-06' }],
          work: [{ company: '示例科技', title: '数据分析实习生', city: '杭州', start: '2025-06', end: '2025-08', description: '搭建漏斗看板，定位流失最高的环节；为新手引导设计 A/B 实验。' }],
          project: [{ name: '用户流失归因', role: '负责人', start: '2024-03', end: '2024-06', description: '按行为分群，排出流失的主要原因。' }],
          language: [{ name: '英语', level: '熟练', cert: '六级', score: '600' }] } },
        { name: '产品', resume: 'resume-product.pdf', data: { basic: { name: '张三' } } } ] });
      const [a, b, c] = %PDFS%;
      await Vault.saveFiles({ resumes: [
        { name: 'resume-data.pdf', type: 'application/pdf', size: 133800, data: a, addedAt: Date.now() - 2 * day },
        { name: 'resume-product.pdf', type: 'application/pdf', size: 120400, data: b, addedAt: Date.now() - 17 * 60000 },
        { name: 'resume-english.pdf', type: 'application/pdf', size: 98000, data: c, addedAt: Date.now() - 9 * day } ] });
      await chrome.storage.local.set({ applications: [
        { id: '1', date: '2026-11-22', company: '示例游戏', position: '2027届秋招 - 数据分析师', status: '已投递', city: '杭州' },
        { id: '2', date: '2026-11-21', company: '样例视频', position: '数据科学家（校招）', status: '一面', city: '北京', history: [{ s: '已投递', at: '2026-11-21' }, { s: '一面', at: '2026-11-23' }] },
        { id: '3', date: '2026-11-23', company: '示例云', position: '商业分析（校招）', status: '收藏', city: '深圳' },
        { id: '4', date: '2026-11-20', company: '样例手机', position: '用户研究实习生', status: '已投递', city: '北京' },
        { id: '5', date: '2026-11-19', company: '示例电商', position: '经营分析师', status: '笔试', city: '上海' },
        { id: '6', date: '2026-11-18', company: '样例出行', position: '策略分析师', status: '已拒绝', city: '上海' },
        { id: '7', date: '2026-11-23', company: '示例汽车', position: '数据产品经理', status: '收藏', city: '广州' },
        { id: '8', date: '2026-11-17', company: '样例银行', position: '数据分析管培生', status: 'Offer', city: '深圳', history: [{ s: '已投递', at: '2026-11-17' }, { s: '笔试', at: '2026-11-19' }, { s: '一面', at: '2026-11-21' }, { s: 'Offer', at: '2026-11-23' }] },
        ...Array.from({ length: 26 }, (_, i) => { const d = new Date(Date.now() - (i % 19 + 1) * 86400000); const ds = d.toISOString().slice(0, 10); const st = i % 7 === 0 ? '一面' : i % 5 === 0 ? '笔试' : i % 9 === 0 ? '已拒绝' : '已投递';
          return { id: 'x' + i, date: ds, company: ['示例科技', '样例数据', '示例游戏', '样例云', '示例金融'][i % 5], position: '数据分析师', status: st, city: ['上海', '北京', '杭州'][i % 3], history: st === '已投递' ? [{ s: '已投递', at: ds }] : [{ s: '已投递', at: ds }, { s: st, at: new Date(d.getTime() + 3 * 86400000).toISOString().slice(0, 10) }] }; }) ] });
      await chrome.storage.session.set({ fills: { 7: { profile: '数据分析', frames: { 0: {
        done: ['基本信息 · 姓名','基本信息 · 性别','基本信息 · 手机号','基本信息 · 邮箱','教育经历 #1 · 学校','教育经历 #1 · 学历 / 学位','教育经历 #1 · 专业','教育经历 #2 · 学校','工作 / 实习经历 #1 · 公司','工作 / 实习经历 #1 · 职位','工作 / 实习经历 #1 · 工作描述','文件 · 简历'],
        missing: ['证件号码', '感兴趣的业务方向'], noData: [], unknown: 0 } } } } });
    })();
  </script>
'''.replace('%PDFS%', json.dumps(PDFS))


def write(name, src, scripts):
    s = open(os.path.join(ROOT, 'src', src), encoding='utf-8').read()
    i = s.index('  <script src="schema.js">')
    loader = '  <script>globalThis.__previewSources = ["/build/site/"];</script>\n  <script>window.__ready.then(() => { for (const f of %s) { const sc = document.createElement("script"); sc.src = f; sc.async = false; document.body.append(sc); } });</script>\n</body>\n</html>\n' % json.dumps(scripts)
    open(os.path.join(ROOT, 'src', name), 'w', encoding='utf-8').write(s[:i] + SEED + loader)


open(os.path.join(ROOT, 'src', '_preview_sources.js'), 'w').write('globalThis.JOB_SOURCES = globalThis.__previewSources;\n')
write('_preview_app.html', 'app.html', [f for f in ['options.js', 'tracker.js', 'documents.js', 'jobs-config.js', '_preview_sources.js', 'jobs.js', 'app.js'] if os.path.exists(os.path.join(ROOT, 'src', f))])
write('_preview_panel.html', 'panel.html', ['run.js', 'panel.js'])
print('ok')
