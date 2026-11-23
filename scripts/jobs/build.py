"""把这次抓到的各公司原始数据整理成扩展下载的数据：
  <out>/index.json      列表和筛选用（每个岗位一行：公司、id、职位、城市、类型、经验、类别、发布日期）
  <out>/c/<slug>.json   每家公司的岗位详情（官网链接、职责、要求）
  <out>/report.json     这次运行的结果：哪些公司成功、失败（沿用上一份）、被排除
统一 类型（校招 / 实习 / 社招）、经验、类别、城市 的写法。
某家这次没抓到：沿用上一份发布的数据（--prev），并记为失败。
用法：python3 scripts/jobs/build.py --raw build/raw --prev build/prev --out build/site [--since <unix 秒>]"""
import argparse, json, os, re, glob, time, shutil

HERE = os.path.dirname(os.path.abspath(__file__))


def district_map():
    # 区县 → 所在城市（用扩展自带的 src/regions.js）
    text = open(os.path.join(HERE, '..', '..', 'src', 'regions.js'), encoding='utf-8').read()
    data = json.loads(text[text.index('{'):text.rindex('}') + 1])
    out = {}
    for prov, cities in data.items():
        for city, districts in (cities or {}).items():
            for d in districts or []:
                out.setdefault(d, re.sub(r'市$', '', city))
    return out


DISTRICTS = district_map()

CATEGORIES = [
    ('算法', r'算法|机器学习|深度学习|nlp|cv\b|计算机视觉|大模型|llm|aigc|推荐|搜索|多模态|语音|自动驾驶感知|规划控制|ai\b|人工智能'),
    ('数据', r'数据|分析|\bbi\b|数仓|统计|商业智能|增长分析|用户研究'),
    ('游戏', r'策划|原画|美术|动画|特效|关卡|游戏|角色|场景'),
    ('硬件', r'硬件|芯片|电子|射频|结构|嵌入式|电路|\bic\b|半导体|工艺|制造|机械|电机|电池|材料|光学|封装|器件|模拟|数字前端|验证|版图|质量|测试工程师（硬件|热设计|电源'),
    ('技术', r'开发|工程师|后端|前端|客户端|服务端|测试|运维|架构|java|c\+\+|golang|python|安全|sre|android|ios|全栈|研发|技术|程序|软件|系统|网络|云'),
    ('产品', r'产品'),
    ('设计', r'设计|交互|\bui\b|\bux\b|视觉'),
    ('运营', r'运营|内容|社区|审核|直播|电商'),
    ('市场', r'市场|品牌|公关|营销|广告|媒介|推广'),
    ('销售', r'销售|商务|\bbd\b|客户经理|渠道|大客户|解决方案'),
    ('金融', r'资金|财资|投资|投行|研究员|风控|金融|证券|基金|量化|行研|资管|财富|信贷|银行|保险|精算'),
    ('职能', r'人力|\bhr\b|hrbp|财务|会计|法务|行政|审计|采购|招聘|培训|合规|税务|秘书|助理|供应链|物流|管培'),
]


def norm_type(job):
    t = ' '.join([job.get('recruitType') or '', job.get('title') or '']).lower()
    if re.search(r'实习|intern', t):
        return '实习'
    if re.search(r'校招|校园|应届|campus|graduate|届|毕业生|管培|new grad|fresh', t):
        return '校招'
    if re.search(r'社招|social|experienced|社会', t):
        return '社招'
    if re.search(r'\d+\s*年', job.get('experience') or ''):
        return '社招'
    return '社招'


def norm_level(job, typ):
    if typ in ('实习', '校招'):
        return '应届'
    e = (job.get('experience') or '') + ' ' + (job.get('requirement') or '')[:300]
    m = re.search(r'(\d+)\s*(?:-|~|至|到)?\s*(\d+)?\s*年(?:以上|及以上)?(?:工作|相关|的)?(?:经验|经历)', e)
    if not m:
        m = re.search(r'(\d+)\s*年以上', e)
    if not m:
        return '不限'
    n = int(m.group(1))
    if n <= 0:
        return '不限'
    if n < 3:
        return '1-3年'
    if n < 5:
        return '3-5年'
    if n < 10:
        return '5-10年'
    return '10年以上'


def norm_category(job):
    # 先看职位名称，认不出再看原站的类别
    for text in ((job.get('title') or '').lower(), (job.get('category') or '').lower()):
        for name, pat in CATEGORIES:
            if re.search(pat, text):
                return name
    return '其他'


def norm_cities(cities):
    out = []
    for c in cities or []:
        for part in re.split(r'[,，、/|;；]+', str(c)):
            part = part.strip()
            # 「浙江省·杭州」「中国-上海」：只留城市
            part = re.split(r'\s*[·\-–—]\s*', part)[-1] if re.search(r'[·\-–—]', part) and re.search(r'[\u4e00-\u9fa5]', part) else part
            part = re.sub(r'^(中国大陆|中国)', '', part).strip()
            part = re.sub(r'(市|特别行政区)$', '', part)
            if re.fullmatch(r'[\u4e00-\u9fa5]{2,}省', part) or not part:
                continue
            part = DISTRICTS.get(part, part)
            if part not in out and len(part) <= 20:
                out.append(part)
    return out


def clean(text, limit=1000):
    text = re.sub(r'<[^>]+>', '\n', text or '')
    text = re.sub(r'&nbsp;', ' ', text)
    text = '\n'.join(l for l in text.split('\n') if l.strip().lower() not in ('null', 'none', 'undefined'))
    text = re.sub(r'\n\s*\n+', '\n', text).strip()
    return text[:limit]


def load_sources():
    return json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf-8'))


def build_company(slug, data):
    """一家公司的原始数据 → (公司信息, 列表行, 详情)"""
    jobs = [j for j in data.get('jobs') or [] if j.get('title') and j.get('url')]
    rows, detail, seen = [], {}, set()
    for j in jobs:
        jid = str(j.get('id') or j['url'])
        if jid in seen:
            continue
        seen.add(jid)
        typ = norm_type(j)
        rows.append([slug, jid, j['title'].strip()[:80], '|'.join(norm_cities(j.get('cities'))), typ, norm_level(j, typ), norm_category(j), (j.get('posted') or '')[:10]])
        detail[jid] = {'u': j['url'], 'd': clean(j.get('description')), 'r': clean(j.get('requirement'))}
    info = {'slug': slug, 'name': data.get('company') or slug, 'site': data.get('site') or '', 'count': len(rows), 'fetched': data.get('fetched') or ''}
    return info, rows, detail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', required=True, help='这次抓到的原始数据目录（<slug>.json）')
    ap.add_argument('--prev', default='', help='上一份发布的数据目录（index.json + c/）')
    ap.add_argument('--out', required=True)
    ap.add_argument('--since', type=float, default=0, help='只认这个时间之后写出的原始文件（防止拿到旧文件当成这次的）')
    a = ap.parse_args()

    sources = load_sources()
    prev_index = {}
    prev_path = os.path.join(a.prev, 'index.json') if a.prev else ''
    if prev_path and os.path.exists(prev_path):
        prev_index = json.load(open(prev_path, encoding='utf-8'))
    prev_rows = {}
    for r in prev_index.get('jobs', []):
        prev_rows.setdefault(r[0], []).append(r)
    prev_info = {c['slug']: c for c in prev_index.get('companies', [])}

    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(os.path.join(a.out, 'c'))
    companies, rows = [], []
    report = {'ok': [], 'failed': [], 'kept': [], 'excluded': [], 'prevTotal': len(prev_index.get('jobs', []))}
    today = time.strftime('%Y-%m-%d')
    for slug, src in sources.items():
        if src.get('status') != 'ok':
            report['excluded'].append({'slug': slug, 'name': src.get('name'), 'why': src.get('note', src.get('status'))})
            continue
        path = os.path.join(a.raw, slug + '.json')
        fresh = None
        try:
            if os.path.exists(path) and os.path.getmtime(path) >= a.since:
                fresh = json.load(open(path, encoding='utf-8'))
                if not [j for j in fresh.get('jobs') or [] if j.get('title') and j.get('url')]:
                    fresh = None
        except Exception:
            fresh = None
        if fresh is not None:
            fresh.setdefault('company', src.get('name'))
            info, r, detail = build_company(slug, fresh)
            info['fetched'] = info['fetched'] or today
            report['ok'].append(slug)
        elif slug in prev_rows and os.path.exists(os.path.join(a.prev, 'c', slug + '.json')):
            # 这次失败：沿用上一份
            info = dict(prev_info.get(slug) or {'slug': slug, 'name': src.get('name'), 'site': '', 'count': len(prev_rows[slug])})
            info['stale'] = True
            r = prev_rows[slug]
            detail = json.load(open(os.path.join(a.prev, 'c', slug + '.json'), encoding='utf-8'))
            report['failed'].append(slug)
            report['kept'].append(slug)
        else:
            report['failed'].append(slug)
            continue
        companies.append(info)
        rows.extend(r)
        with open(os.path.join(a.out, 'c', slug + '.json'), 'w', encoding='utf-8') as f:
            json.dump(detail, f, ensure_ascii=False, separators=(',', ':'))
    rows.sort(key=lambda r: r[7], reverse=True)
    index = {'fetched': today, 'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'companies': companies, 'jobs': rows}
    with open(os.path.join(a.out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    report['total'] = len(rows)
    with open(os.path.join(a.out, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"{len(companies)} 家公司，{len(rows)} 个岗位；这次成功 {len(report['ok'])}，失败 {len(report['failed'])}（其中沿用上一份 {len(report['kept'])}），排除 {len(report['excluded'])}")


if __name__ == '__main__':
    main()
