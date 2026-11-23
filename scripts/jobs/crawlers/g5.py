#!/usr/bin/env python3
"""Group 5 crawler: education, hardware / new energy, logistics and healthcare companies.

python3 jobs/crawlers/g5.py              # crawl every company in this group
python3 jobs/crawlers/g5.py tal longi    # crawl only these

Only public postings that the official careers sites show without login.
Standard library only. At least 1 second between requests.
Env LIMIT=n caps jobs per company (for quick tests).

Platforms used:
  Beisen (*.zhiye.com, join.huolala.cn): POST /api/Jobad/GetJobAdPageList
  Moka: public career-site API api.mokahr.com/api-platform/v1/jobs/<org>?mode=campus|social
        (the encrypted app.mokahr.com SPA endpoints are not used)
  Feishu Hire (*.jobs.feishu.cn): /api/v1/search/job/posts
  Hotjob / Dayee wecruit (longi.hotjob.cn): /wecruit/positionInfo/listPosition
  Own sites: job.tal.com (job-api.100tal.com), recruit.inovance.com (prod-portal-api)
"""
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 输出目录：scripts/jobs/run.py 用环境变量 JOBS_RAW_DIR 指定；单独运行时写到 build/raw
OUT_DIR = os.environ.get('JOBS_RAW_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'build', 'raw')
MAX_JOBS = int(os.environ.get('LIMIT') or 400)
TEXT_MAX = 2000
DELAY = 1.1
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
TODAY = time.strftime('%Y-%m-%d')


# ---------------------------------------------------------------- http

class Client:
    """One cookie jar per company; sleeps so requests are >= DELAY apart."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.last = 0.0

    def request(self, url, data=None, json_body=None, headers=None, method=None, raw=False):
        wait = self.last + DELAY - time.time()
        if wait > 0:
            time.sleep(wait)
        h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
             'Accept-Language': 'zh-CN,zh;q=0.9'}
        body = None
        if json_body is not None:
            body = json.dumps(json_body, ensure_ascii=False).encode('utf-8')
            h['Content-Type'] = 'application/json;charset=UTF-8'
        elif data is not None:
            body = data.encode('utf-8') if isinstance(data, str) else urllib.parse.urlencode(data).encode('utf-8')
            h['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
        if headers:
            h.update(headers)
        req = urllib.request.Request(url, data=body, headers=h, method=method)
        err = None
        for attempt in range(3):
            try:
                with self.opener.open(req, timeout=30) as r:
                    text = r.read().decode('utf-8', 'replace')
                self.last = time.time()
                return text if raw else json.loads(text)
            except urllib.error.HTTPError as e:
                self.last = time.time()
                err = e
                if e.code < 500:
                    break
            except Exception as e:  # network hiccup
                self.last = time.time()
                err = e
            time.sleep(2 + attempt * 2)
        raise err

    def get(self, url, **kw):
        return self.request(url, **kw)

    def post(self, url, json_body=None, **kw):
        return self.request(url, json_body=json_body, method='POST', **kw)

    def cookie(self, name):
        for c in self.jar:
            if c.name == name:
                return c.value
        return ''


# ---------------------------------------------------------------- helpers

def clean(text):
    """HTML / rich text -> plain text with \\n line breaks."""
    if text is None:
        return ''
    if not isinstance(text, str):
        text = str(text)
    t = text.replace('\r\n', '\n').replace('\r', '\n')
    if '<' in t and '>' in t:
        t = re.sub(r'(?i)<br\s*/?>', '\n', t)
        t = re.sub(r'(?i)</(p|div|li|h\d|tr)>', '\n', t)
        t = re.sub(r'(?i)<li[^>]*>', '- ', t)
        t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ').replace('​', '').replace('\t', ' ')
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n\s*\n+', '\n', t)
    return t.strip()[:TEXT_MAX]


def ms_date(v):
    """epoch ms / s or date string -> YYYY-MM-DD."""
    if v in (None, '', 0):
        return ''
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
        n = float(v)
        if n > 1e11:
            n /= 1000
        return time.strftime('%Y-%m-%d', time.localtime(n))
    s = str(v)
    if s.startswith('0001'):
        return ''
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$', s)
    if m:  # UTC -> local date
        import calendar
        ts = calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))
        return time.strftime('%Y-%m-%d', time.localtime(ts))
    m = re.search(r'(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})', s)
    if m:
        return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    return ''


def city_list(v):
    if not v:
        return []
    if isinstance(v, str):
        v = re.split(r'[,，、/;；|\s]+', v)
    out = []
    for c in v:
        if isinstance(c, dict):
            c = c.get('name') or c.get('city') or c.get('cityName') or c.get('province') or ''
        c = str(c or '').strip()
        if not c:
            continue
        parts = [x for x in c.split('·') if x]  # 江苏省·苏州市·吴中区
        if len(parts) > 1:
            cand = [x for x in parts if x.endswith('市')]
            c = cand[0] if cand else parts[1] if parts[0].endswith('省') else parts[0]
        if '-' in c and not c.startswith('-'):
            parts = [x for x in c.split('-') if x]
            cand = [x for x in parts if x.endswith('市')]
            c = cand[0] if cand else parts[-1]
        c = re.sub(r'(?<=..)(市|特别行政区)$', '', c)
        c = re.sub(r'^(.{2,})(省|自治区)$', r'\1', c)
        if c and c not in out:
            out.append(c)
    return out


def job(id, title, url, cities=None, recruit='', category='', experience='', posted='',
        description='', requirement=''):
    return {
        'id': str(id),
        'title': clean(title)[:200],
        'cities': city_list(cities),
        'recruitType': recruit or '',
        'category': category or '',
        'experience': experience or '',
        'posted': posted or '',
        'url': url,
        'description': clean(description),
        'requirement': clean(requirement),
    }


def kind(recruit):
    r = recruit or ''
    if re.search(r'实习|intern|见习', r, re.I):
        return 1
    if re.search(r'校|应届|campus|graduate|届|管培|培训生', r, re.I):
        return 0
    return 2


REQ_HEAD = (r'任职要求|任职资格|岗位要求|职位要求|招聘要求|任职条件|岗位资格|应聘要求|岗位需求|职位需求|任职需求|'
            r'岗位条件|我们希望你|我们期待你|'
            r'希望你|你需要具备|你需要|技能要求|基本要求|能力要求|欢迎这样的你|Requirements?|Qualifications?')
DUTY_HEAD = r'岗位职责|工作职责|职位描述|岗位描述|工作内容|职位职责|你将负责|你将会负责|Responsibilities'


def split_duty(text):
    """'岗位职责：... 任职要求：...' (plain text) -> (duty, requirement)."""
    t = clean(text) if text else ''
    pat = (r'(?:^|\n|\s|[。；;]|[一二三四五六七八九十\d][、.．]\s*|[(（][一二三四五六七八九十\d][)）]\s*|【|\[|-)(?:'
           + REQ_HEAD + r')(?:[】\]][\s:：]*|-?[ \t]*(?:[:：]|(?=\n)|$))')
    m = next((x for x in re.finditer(pat, t) if x.start() >= 5), None)
    if not m:
        return t, ''
    duty = t[:m.end()][:m.start() + (1 if t[m.start():m.start() + 1] in '。；;' else 0)].rstrip(' \n【[（(一二三四五六七八九十、.．')
    duty = re.sub(r'^\s*[【\[]?(?:[一二三四五六七八九十\d][、.．]|[(（][一二三四五六七八九十\d][)）])?\s*(?:' + DUTY_HEAD + r')[】\]]?\s*[:：]?\s*', '', duty)
    req = t[m.end():].lstrip(' \n】]:：')
    return duty.strip(), req.strip()


class Collector:
    """Accumulates jobs, dedups by id, knows when the cap is reached."""

    def __init__(self, cap=None):
        self.cap = cap or MAX_JOBS
        self.jobs = []
        self.ids = set()

    def add(self, j):
        if self.full() or not j['id'] or j['id'] in self.ids:
            return False
        self.ids.add(j['id'])
        self.jobs.append(j)
        return True

    def full(self):
        return len(self.jobs) >= self.cap

    def room(self):
        return self.cap - len(self.jobs)


def strip_code(title):
    """Drop trailing requisition codes like (J12345) / （J12345）."""
    return re.sub(r'\s*(?<![A-Za-z])M?\s*[(（]\s*[A-Z]{0,3}\d{3,}\s*[)）]\s*$', '', title or '')


# ---------------------------------------------------------------- Feishu Hire (ByteDance ATS)

def feishu(c, base, path, col, recruit_default='', portal_type=None, page=100):
    """base: https://xxx.jobs.feishu.cn ; path: website path like 'campus'."""
    referer = '%s/%s/position' % (base, path)
    tok = c.post(base + '/api/v1/csrf/token', {'portal_entrance': 1},
                 headers={'Referer': referer, 'website-path': path})
    token = (tok.get('data') or {}).get('token') or urllib.parse.unquote(c.cookie('atsx-csrf-token'))
    headers = {'Referer': referer, 'x-csrf-token': token, 'website-path': path,
               'Portal-Channel': path, 'Portal-Platform': 'pc', 'Origin': base}
    offset = 0
    while not col.full():
        body = {'keyword': '', 'limit': page, 'offset': offset, 'job_category_id_list': [],
                'tag_id_list': [], 'location_code_list': [], 'subject_id_list': [],
                'recruitment_id_list': [], 'portal_entrance': 1, 'job_function_id_list': []}
        if portal_type is not None:
            body['portal_type'] = portal_type
        d = c.post(base + '/api/v1/search/job/posts', body, headers=headers)
        data = d.get('data') or {}
        lst = data.get('job_post_list') or []
        for p in lst:
            rt = p.get('recruit_type') or {}
            parent = (rt.get('parent') or {}).get('name') or ''
            rname = rt.get('name') or ''
            if rname in ('正式', '全职') and parent:
                rname = parent
            elif parent and parent not in rname:
                rname = parent + '-' + rname
            cat = p.get('job_category') or {}
            catname = cat.get('name') or ''
            if cat.get('parent'):
                catname = (cat['parent'].get('name') or '') + '-' + catname
            cities = [x.get('name') for x in (p.get('city_list') or [])] or [(p.get('city_info') or {}).get('name')]
            col.add(job(p['id'], p.get('title'), '%s/%s/position/%s/detail' % (base, path, p['id']),
                        cities, rname or recruit_default, catname, '', ms_date(p.get('publish_time')),
                        p.get('description'), p.get('requirement')))
        offset += page
        if not lst or offset >= (data.get('count') or 0):
            break


# ---------------------------------------------------------------- Beisen (*.zhiye.com and custom domains)

def beisen(c, base, col, plans=((2, '校招', 'campus'), (3, '实习', 'intern'), (1, '社招', 'social'))):
    """plans: (Category id, fallback label, detail path). 2 campus, 3 intern, 1 social on these tenants.
    When campus postings alone would fill the cap, up to a quarter of it is kept for internships."""
    hdr = {'Origin': base, 'X-Requested-With': 'xmlhttprequest', 'langType': 'zh_CN'}

    def fetch(cat_id, path, page, size):
        return c.post(base + '/api/Jobad/GetJobAdPageList',
                      {'PageIndex': page, 'PageSize': size, 'Category': [cat_id], 'KeyWords': '', 'SpecialType': 0,
                       'PortalId': '', 'DisplayFields': ['Category', 'Kind', 'LocId', 'ClassificationOne',
                                                         'PostDate', 'WorkYears', 'Org']},
                      headers=dict(hdr, Referer='%s/%s/jobs' % (base, path)))

    reserve = 0
    if [p[0] for p in plans[:2]] == [2, 3]:
        n_intern = fetch(3, 'intern', 0, 1).get('Count') or 0
        reserve = min(n_intern, col.cap // 4)
    full_cap = col.cap
    for cat_id, label, path in plans:
        col.cap = full_cap - reserve if cat_id == 2 else full_cap
        page = 0
        while not col.full():
            d = fetch(cat_id, path, page, 50)
            lst = d.get('Data') or []
            for p in lst:
                r = p.get('Category') or label
                if label == '实习' and '实习' not in r:
                    r = '实习' + ('/' + r if r else '')
                cat = p.get('ClassificationOne')
                cat = cat if isinstance(cat, str) else ''
                col.add(job(p['Id'], strip_code(p.get('JobAdName')), '%s/%s/detail?jobAdId=%s' % (base, path, p['Id']),
                            p.get('LocNames') or [], r, cat, p.get('WorkYears') or '',
                            ms_date(p.get('PostDate') or p.get('PublishDate')), p.get('Duty'), p.get('Require')))
            page += 1
            if len(lst) < 50 or page * 50 >= (d.get('Count') or 0):
                break
    col.cap = full_cap


# ---------------------------------------------------------------- Moka public career-site API

def moka(c, org, col, sites, dept_filter=None):
    """sites: list of (mode, job url prefix ending in '#/job/'). Collects everything, then adds
    campus, intern and social jobs in that order so the cap keeps campus/intern first."""
    found = []
    for mode, prefix in sites:
        offset = 0
        while offset < 3000:
            d = c.get('https://api.mokahr.com/api-platform/v1/jobs/%s?mode=%s&offset=%d&limit=100'
                      % (org, mode, offset))
            lst = d.get('jobs') or []
            for it in lst:
                if it.get('status') not in (None, 'open'):
                    continue
                dept = (it.get('department') or {}).get('name') or ''
                if dept_filter and not dept_filter(it):
                    continue
                commit = it.get('commitment') or ''
                title = it.get('title') or ''
                if commit == '实习' or '实习生' in title or re.search(r'实习(?!转正)', title):
                    rt = '实习'
                elif mode == 'campus':
                    rt = '校招'
                else:
                    rt = '社招'
                exp = '%s年以上' % it['minExperience'] if it.get('minExperience') else ''
                cat = (it.get('zhineng') or {}).get('name') or dept
                duty, req = split_duty(it.get('description') or '')
                cities = [l.get('city') or l.get('province') for l in (it.get('locations') or [])]
                found.append(job(it['id'], title, prefix + it['id'], cities, rt, cat, exp,
                                 ms_date(it.get('publishedAt') or it.get('openedAt')), duty, req))
            offset += len(lst)
            if not lst or offset >= (d.get('total') or 0):
                break
    found.sort(key=lambda j: kind(j['recruitType']))
    for j in found:
        col.add(j)


# ---------------------------------------------------------------- Hotjob / Dayee wecruit

def hotjob(c, base, su, col, plans):
    """plans: (recruitType number, postType for the detail URL, label)."""
    q = '?iSaJAx=isAjax&request_locale=zh_CN'
    hdr = {'Referer': '%s/%s/pb/index.html' % (base, su), 'Origin': base, 'X-Requested-With': 'XMLHttpRequest'}
    for rtype, post_type, label in plans:
        cur, total = 1, 1
        while cur <= total and not col.full():
            d = c.request('%s/wecruit/positionInfo/listPosition/%s%s' % (base, su, q),
                          data={'isFrompb': 'true', 'recruitType': rtype, 'pageSize': 15, 'currentPage': cur},
                          headers=hdr)
            pf = (d.get('data') or {}).get('pageForm') or {}
            total = int(pf.get('totalPage') or 0)
            for p in pf.get('pageData') or []:
                if col.full():
                    break
                pid = p.get('postId')
                if not pid or pid in col.ids:
                    continue
                try:
                    dd = c.request('%s/wecruit/positionInfo/listPositionDetail/%s%s' % (base, su, q),
                                   data={'postId': pid}, headers=hdr).get('data') or {}
                except Exception:
                    dd = {}
                proj = p.get('projectName') or ''
                lab = label
                if '实习' in proj or '实习' in (p.get('workTypeStr') or ''):
                    lab = '实习'
                if proj and proj != '日常招聘':
                    lab += '/' + proj
                cities = [w.get('name') for w in dd.get('workPlaceList') or [] if w.get('name')] or p.get('workPlaceStr')
                col.add(job(pid, strip_code(p.get('postName')),
                            '%s/%s/pb/posDetail.html?postId=%s&postType=%s' % (base, su, pid, post_type),
                            cities, lab, p.get('postTypeName') or dd.get('postTypeName') or '',
                            p.get('workYears') or dd.get('workYears') or '',
                            ms_date(p.get('publishDate') or dd.get('publishDate')),
                            dd.get('workContent'), dd.get('serviceCondition')))
            cur += 1


# ---------------------------------------------------------------- companies

def crawl_tal(c, col):
    # job.tal.com (own site, Moka-backed). The campus channel lists campus + intern postings.
    api = 'https://job-api.100tal.com/sapi/activities/c/jobs/list'
    hdr = {'Referer': 'https://job.tal.com/', 'Origin': 'https://job.tal.com'}
    found = []
    page = 1
    while page < 60:
        d = c.post(api, {'orgId': 'tal', 'route_code': 'kg8Meh', 'limit': 20, 'offset': page, 'site': 'campus',
                         'keyword': '', 'locations': [], 'commitments': [], 'zhinengIds': [], 'tag_ids': []},
                   headers=hdr).get('data') or {}
        lst = d.get('list') or []
        for p in lst:
            title = p.get('title') or ''
            tags = p.get('tag_names') or []
            if p.get('commitment') == '实习' or '实习生' in tags or re.search(r'实习(?!转正)', title):
                rt = '实习'
            else:
                rt = p.get('hire_mode') or '校招'
                if '实习转正' in title:
                    rt += '/实习转正'
            duty, req = split_duty(p.get('description'))
            found.append(job(p['job_id'], title, 'https://job.tal.com/campus/positions/' + p['job_id'],
                             p.get('Locations'), rt, (p.get('zhineng') or {}).get('name') or p.get('department_name') or '',
                             '', ms_date(p.get('updated_at') or p.get('created_at')), duty, req))
        if not lst or page * 20 >= (d.get('total') or 0):
            break
        page += 1
    found.sort(key=lambda j: kind(j['recruitType']))
    for j in found:
        col.add(j)


def crawl_yuanfudao(c, col):
    moka(c, 'fenbi', col, [('campus', 'https://hr.yuanfudao.com/campus-recruitment/fenbi/47742/#/job/'),
                           ('social', 'https://app.mokahr.com/social-recruitment/fenbi/45505#/job/')])


def crawl_xdf(c, col):
    beisen(c, 'https://xdf.zhiye.com', col)


def crawl_kingdee(c, col):
    # Only the campus site is on the public Moka API (social mode is empty).
    moka(c, 'kingdeehr', col, [('campus', 'https://app.mokahr.com/campus-recruitment/kingdeehr/166565#/job/')])


def crawl_inovance(c, col):
    base = 'https://recruit.inovance.com'
    hdr = {'Referer': base + '/', 'Origin': base, 'X-Portal-Id': '019daf7d-4d1a-7634-87af-1f089498b6f2'}
    for rtype, label in ((1, '校招'), (5, '实习'), (2, '社招')):
        page = 1
        while not col.full():
            d = c.post(base + '/prod-portal-api/position/ad/search',
                       {'pageNum': page, 'pageSize': 50, 'keyword': '', 'recruitTypes': [rtype],
                        'sortBy': 'recommended'}, headers=hdr).get('data') or {}
            lst = d.get('records') or []
            for p in lst:
                exp = p.get('yearsOfWorkingDesc') or ''
                col.add(job(p['adId'], p.get('adJobName'), '%s/#/jobs/%s' % (base, p['adId']),
                            p.get('workLocation'), label, p.get('segment') or '', '' if exp == '不限' else exp,
                            ms_date(p.get('publishTime')), p.get('jobDescription'), p.get('jobRequirement')))
            if not lst or not d.get('hasMore') or page * 50 >= (d.get('total') or 0):
                break
            page += 1


def crawl_sungrow(c, col):
    # jobs.sungrowpower.com links to these Moka sites.
    moka(c, 'sungrow', col, [('campus', 'https://app.mokahr.com/campus-recruitment/sungrow/94416#/job/'),
                             ('social', 'https://app.mokahr.com/social-recruitment/sungrow/94415#/job/')])


def crawl_longi(c, col):
    hotjob(c, 'https://longi.hotjob.cn', 'SU649d2f9c0dcad4644b43df7e', col,
           [(1, 'campus', '校招'), (2, 'society', '社招')])


def crawl_zeekr(c, col):
    # zeekrlife.com "加入我们" opens the 极氪科技集团 social site on Geely's Moka org (site 102003).
    # The public API returns all Geely postings, so keep the ones whose department code belongs to the
    # ZEEKR group units (388 极氪整车研究院, 389 service, 411 sales regions, E000 ZEEKR tech, 380 领克研究院,
    # 450 极氪供应链) or whose title names ZEEKR / 领克. Campus postings link to Geely's campus site.
    units = ('388', '389', '411', 'E000', '380', '450')

    def is_zeekr(it):
        code = (it.get('departmentCode') or '').split('#')[0]
        dept = (it.get('department') or {}).get('name') or ''
        return code in units or bool(re.search(r'极氪|ZEEKR|领克', (it.get('title') or '') + dept, re.I))
    moka(c, 'geely', col, [('campus', 'https://campus.geely.com/campus-recruitment/geely/78436#/job/'),
                           ('social', 'https://app.mokahr.com/social-recruitment/geely/102003#/job/')],
         dept_filter=is_zeekr)


def crawl_seres(c, col):
    # seres.cn career page links to sokon.zhiye.com (赛力斯 was 小康股份).
    beisen(c, 'https://sokon.zhiye.com', col)


def crawl_roborock(c, col):
    beisen(c, 'https://roborock.zhiye.com', col)


def crawl_ecovacs(c, col):
    # hr.ecovacs.cn links to these Moka sites; they carry very few postings.
    moka(c, 'ecovacs', col, [('campus', 'https://app.mokahr.com/apply/ecovacs/36792#/job/'),
                             ('social', 'https://app.mokahr.com/social-recruitment/ecovacs/102402#/job/')])


def crawl_dreame(c, col):
    beisen(c, 'https://dreame.zhiye.com', col)


def crawl_insta360(c, col):
    base = 'https://arashivision.jobs.feishu.cn'
    for path in ('campus', 'index', 'social'):
        if not col.full():
            feishu(Client(), base, path, col)


def crawl_bambulab(c, col):
    base = 'https://bambulab.jobs.feishu.cn'
    for path in ('campus', 'experienced'):
        if not col.full():
            feishu(Client(), base, path, col)


def crawl_jtexpress(c, col):
    base = 'https://jtexpress.jobs.feishu.cn'
    feishu(c, base, '478610', col, '校招')
    if not col.full():
        feishu(Client(), base, 'index', col, '社招')


def crawl_fulltruck(c, col):
    moka(c, 'manbang', col, [
        ('campus', 'https://campus.fulltruckalliance.com/campus-recruitment/manbang/94191/#/job/'),
        ('social', 'https://jobs.fulltruckalliance.com/social-recruitment/manbang/96016/#/job/')])


def crawl_lalamove(c, col):
    # join.huolala.cn (Beisen) for social + intern; its 校园招聘 tab links to Moka huolalahr.
    moka(c, 'huolalahr', col, [('campus', 'https://app.mokahr.com/campus-recruitment/huolalahr/98660#/job/')])
    beisen(Client(), 'https://join.huolala.cn', col, ((3, '实习', 'intern'), (1, '社招', 'social')))


def crawl_mindray(c, col):
    beisen(c, 'https://mindray.zhiye.com', col)


def crawl_unitedimaging(c, col):
    beisen(c, 'https://united-imaging.zhiye.com', col)


def crawl_wuxiapptec(c, col):
    beisen(c, 'https://wuxiapptec.zhiye.com', col)


# ---------------------------------------------------------------- registry

COMPANIES = [
    # slug, name, site, crawler
    ('tal', '好未来', 'https://job.tal.com/', crawl_tal),
    ('yuanfudao', '猿辅导', 'https://hr.yuanfudao.com/', crawl_yuanfudao),
    ('xdf', '新东方', 'https://xdf.zhiye.com/', crawl_xdf),
    ('kingdee', '金蝶', 'https://app.mokahr.com/campus-recruitment/kingdeehr/166565', crawl_kingdee),
    ('inovance', '汇川技术', 'https://recruit.inovance.com/', crawl_inovance),
    ('sungrow', '阳光电源', 'https://jobs.sungrowpower.com/', crawl_sungrow),
    ('longi', '隆基绿能', 'https://longi.hotjob.cn/', crawl_longi),
    ('zeekr', '极氪', 'https://app.mokahr.com/social-recruitment/geely/102003', crawl_zeekr),
    ('seres', '赛力斯', 'https://sokon.zhiye.com/', crawl_seres),
    ('roborock', '石头科技', 'https://roborock.zhiye.com/', crawl_roborock),
    ('ecovacs', '科沃斯', 'https://hr.ecovacs.cn/', crawl_ecovacs),
    ('dreame', '追觅科技', 'https://dreame.zhiye.com/', crawl_dreame),
    ('insta360', '影石', 'https://arashivision.jobs.feishu.cn/', crawl_insta360),
    ('bambulab', '拓竹科技', 'https://bambulab.jobs.feishu.cn/', crawl_bambulab),
    ('jtexpress', '极兔速递', 'https://jtexpress.jobs.feishu.cn/', crawl_jtexpress),
    ('fulltruck', '满帮', 'https://jobs.fulltruckalliance.com/', crawl_fulltruck),
    ('lalamove', '货拉拉', 'https://join.huolala.cn/', crawl_lalamove),
    ('mindray', '迈瑞医疗', 'https://mindray.zhiye.com/', crawl_mindray),
    ('unitedimaging', '联影医疗', 'https://united-imaging.zhiye.com/', crawl_unitedimaging),
    ('wuxiapptec', '药明康德', 'https://wuxiapptec.zhiye.com/', crawl_wuxiapptec),
]


def run(slug, name, site, fn):
    if fn is None:
        print('[%s] skipped: no crawler' % slug, flush=True)
        return None
    c = Client()
    col = Collector()
    t0 = time.time()
    try:
        fn(c, col)
    except Exception:
        print('[%s] error after %d jobs:' % (slug, len(col.jobs)), flush=True)
        traceback.print_exc()
    if not col.jobs:
        print('[%s] no jobs, not writing' % slug, flush=True)
        return 0
    jobs = sorted(col.jobs, key=lambda j: kind(j['recruitType']))[:MAX_JOBS]
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, slug + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'slug': slug, 'company': name, 'site': site, 'fetched': TODAY, 'jobs': jobs},
                  f, ensure_ascii=False, indent=1)
    print('[%s] %d jobs in %.0fs' % (slug, len(jobs), time.time() - t0), flush=True)
    return len(jobs)


def main(argv):
    want = set(argv)
    unknown = want - {s for s, *_ in COMPANIES}
    if unknown:
        print('unknown slug(s): ' + ' '.join(sorted(unknown)))
    total = 0
    for slug, name, site, fn in COMPANIES:
        if want and slug not in want:
            continue
        total += run(slug, name, site, fn) or 0
    print('total %d' % total)


if __name__ == '__main__':
    main(sys.argv[1:])
