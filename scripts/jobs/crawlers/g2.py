#!/usr/bin/env python3
"""Group 2 crawler: hardware / auto / appliance companies.

python3 jobs/crawlers/g2.py            crawl every company in this group
python3 jobs/crawlers/g2.py xiaomi nio crawl only those slugs

Standard library only. Only public endpoints that the official careers pages call
for anonymous visitors. At least 1 second between requests. Campus and intern
jobs first, then social jobs, at most 400 per company.
"""
import base64
import datetime
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
import urllib.request

MAX_JOBS = 400
MAX_TEXT = 2000
DELAY = 1.1
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
# 输出目录：scripts/jobs/run.py 用环境变量 JOBS_RAW_DIR 指定；单独运行时写到 build/raw
OUT_DIR = os.environ.get('JOBS_RAW_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'build', 'raw')
TODAY = datetime.date.today().isoformat()


# ---------------------------------------------------------------- http helpers

class Client:
    """One cookie jar per site, and a polite delay before every request."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.last = 0.0

    def request(self, url, method='GET', json_body=None, form=None, headers=None, raw=False, tries=3):
        h = {'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
             'Accept-Language': 'zh-CN,zh;q=0.9'}
        if headers:
            h.update(headers)
        data = None
        if json_body is not None:
            data = json.dumps(json_body, ensure_ascii=False).encode('utf-8')
            h['Content-Type'] = 'application/json'
        elif form is not None:
            data = urllib.parse.urlencode(form).encode('utf-8')
            h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
        err = None
        for attempt in range(tries):
            wait = DELAY - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                req = urllib.request.Request(url, data=data, headers=h, method=method)
                with self.opener.open(req, timeout=30) as r:
                    body = r.read().decode('utf-8', 'replace')
                return body if raw else json.loads(body)
            except Exception as e:  # noqa: BLE001
                err = e
                time.sleep(2 * (attempt + 1))
        raise err

    def get(self, url, **kw):
        return self.request(url, 'GET', **kw)

    def post(self, url, **kw):
        return self.request(url, 'POST', **kw)


def clean(text):
    """HTML or plain text -> plain text with \\n line breaks, truncated."""
    if not text:
        return ''
    if not isinstance(text, str):
        text = str(text)
    t = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</li>|</h\d>', '\n', text)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ').replace('\r\n', '\n').replace('\r', '\n')
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    return t[:MAX_TEXT]


def ms_date(ms):
    try:
        return datetime.datetime.fromtimestamp(int(ms) / 1000).strftime('%Y-%m-%d')
    except Exception:  # noqa: BLE001
        return ''


def day(s):
    s = (s or '').strip()
    m = re.match(r'(\d{4}-\d{2}-\d{2})', s)
    if not m or m.group(1).startswith('0001'):
        return ''
    return m.group(1)


def split_cities(s, seps=r'[/,，、;；|]'):
    if not s:
        return []
    if isinstance(s, list):
        return [c for c in s if c]
    return [c.strip() for c in re.split(seps, s) if c.strip()]


def job(id_, title, cities, recruit, category, experience, posted, url, desc, req):
    return {
        'id': str(id_ or ''),
        'title': (title or '').strip(),
        'cities': cities or [],
        'recruitType': recruit or '',
        'category': category or '',
        'experience': experience or '',
        'posted': posted or '',
        'url': url or '',
        'description': clean(desc),
        'requirement': clean(req),
    }


def is_campus(label):
    return bool(re.search(r'校|实习|应届|毕业|管培|学生|博士|青苗|海东青|大使|intern|campus|graduate', label or '', re.I))


class Collector:
    """Holds jobs, de-duplicates by id and knows how many more are wanted."""

    def __init__(self):
        self.jobs = []
        self.seen = set()

    def add(self, j):
        if not j['id'] or j['id'] in self.seen:
            return False
        self.seen.add(j['id'])
        self.jobs.append(j)
        return True

    def campus_count(self):
        return sum(1 for j in self.jobs if is_campus(j['recruitType']))

    def full(self):
        return len(self.jobs) >= MAX_JOBS

    def final(self):
        campus = [j for j in self.jobs if is_campus(j['recruitType'])]
        social = [j for j in self.jobs if not is_campus(j['recruitType'])]
        return (campus + social)[:MAX_JOBS]


# ---------------------------------------------------------------- Feishu Hire

def feishu(host, paths):
    """paths: website paths on the Feishu portal, campus ones first."""
    col = Collector()
    for path in paths:
        if col.full():
            break
        c = Client()
        h = {'Referer': 'https://%s/%s/position' % (host, path), 'Origin': 'https://' + host,
             'website-path': path, 'portal-channel': 'saas-career', 'portal-platform': 'pc'}
        tok = c.post('https://%s/api/v1/csrf/token' % host, json_body={'portal_entrance': 1}, headers=h)
        h['x-csrf-token'] = tok['data']['token']
        offset = 0
        while not col.full():
            body = {'keyword': '', 'limit': 100, 'offset': offset, 'job_category_id_list': [],
                    'tag_id_list': [], 'location_code_list': [], 'subject_id_list': [],
                    'recruitment_id_list': [], 'portal_type': 6, 'job_function_id_list': [],
                    'storefront_id_list': [], 'portal_entrance': 1}
            d = c.post('https://%s/api/v1/search/job/posts' % host, json_body=body, headers=h)
            if d.get('code') != 0:
                print('   feishu %s/%s: %s' % (host, path, d.get('message')))
                break
            items = d['data'].get('job_post_list') or []
            for p in items:
                rt = p.get('recruit_type') or {}
                parent = (rt.get('parent') or {}).get('name') or ''
                name = rt.get('name') or ''
                if name == '实习' or '实习' in parent:
                    label = '实习'
                elif parent == '校招' or '校' in parent:
                    label = '校招'
                elif parent:
                    label = parent if name in ('', '全职') else '%s-%s' % (parent, name)
                else:
                    label = name
                cat = p.get('job_category') or {}
                cat_name = cat.get('name') or ''
                if cat.get('parent'):
                    cat_name = '%s-%s' % (cat['parent'].get('name') or '', cat_name)
                if not cat_name and p.get('job_function'):
                    jf = p['job_function']
                    cat_name = jf.get('name') or ''
                    if jf.get('parent'):
                        cat_name = '%s-%s' % (jf['parent'].get('name') or '', cat_name)
                cities = [x.get('name') for x in (p.get('city_list') or []) if x.get('name')]
                if not cities and p.get('city_info'):
                    cities = [p['city_info'].get('name')]
                col.add(job(p.get('id'), p.get('title'), cities, label, cat_name, '',
                            ms_date(p.get('publish_time')),
                            'https://%s/%s/position/%s/detail' % (host, path, p.get('id')),
                            p.get('description'), p.get('requirement')))
            offset += len(items)
            if not items or offset >= (d['data'].get('count') or 0):
                break
    return col.final()


# ---------------------------------------------------------------- Beisen (zhiye)

BEISEN_FIELDS = ['Category', 'Kind', 'LocId', 'ClassificationOne', 'PostDate', 'WorkYears', 'Org']


def beisen(host):
    c = Client()
    api = 'https://%s/api/Jobad/GetJobAdPageList' % host
    h = {'Referer': 'https://%s/' % host, 'Origin': 'https://' + host}

    def page(idx, size, cats=None):
        body = {'PageIndex': idx, 'PageSize': size, 'KeyWords': '', 'SpecialType': 0,
                'PortalId': '', 'DisplayFields': BEISEN_FIELDS}
        if cats:
            body['Category'] = cats
        return c.post(api, json_body=body, headers=h)

    # Which category ids exist and which are campus / intern ones.
    cats = {}
    for cid in range(1, 17):
        d = page(0, 1, [cid])
        data = d.get('Data') or []
        if data and d.get('Count'):
            cats[cid] = (data[0].get('Category') or '', d['Count'])
    campus_ids = [k for k, v in cats.items() if is_campus(v[0])]
    other_ids = [k for k in cats if k not in campus_ids]
    print('   beisen %s categories: %s' % (host, cats))
    col = Collector()
    for cid in campus_ids + other_ids:
        idx = 0
        while not col.full():
            d = page(idx, 100, [cid])
            items = d.get('Data') or []
            for p in items:
                label = p.get('Category') or cats[cid][0]
                if p.get('Kind') and p.get('Kind') not in label:
                    label = '%s/%s' % (label, p['Kind'])
                portal = 'campus' if is_campus(label) else 'social'
                col.add(job(p.get('Id'), p.get('JobAdName'), p.get('LocNames') or [], label,
                            p.get('ClassificationOne') or p.get('Org') or '',
                            p.get('WorkYears') or '',
                            day(p.get('PostDate')) or day(p.get('ChangeDate')),
                            'https://%s/%s/detail?jobAdId=%s' % (host, portal, p.get('Id')),
                            p.get('Duty'), p.get('Require')))
            idx += 1
            if not items or idx * 100 >= (d.get('Count') or 0):
                break
        if col.full():
            break
    return col.final()


# ---------------------------------------------------------------- Wecruit (hotjob)

def wecruit(host, suite, kinds):
    """kinds: list of (recruitType number, postType for the detail URL, label)."""
    c = Client()
    q = '?iSaJAx=isAjax&request_locale=zh_CN'
    h = {'Referer': 'https://%s/%s/pb/index.html' % (host, suite), 'Origin': 'https://' + host}
    col = Collector()
    for rtype, post_type, label in kinds:
        cur, total = 1, 1
        while cur <= total and not col.full():
            d = c.post('https://%s/wecruit/positionInfo/listPosition/%s%s' % (host, suite, q),
                       form={'isFrompb': 'true', 'recruitType': rtype, 'pageSize': 15, 'currentPage': cur},
                       headers=h)
            pf = (d.get('data') or {}).get('pageForm') or {}
            total = pf.get('totalPage') or 0
            for p in pf.get('pageData') or []:
                if col.full():
                    break
                pid = p.get('postId')
                if not pid or pid in col.seen:
                    continue
                desc = req = ''
                cities = split_cities(p.get('workPlaceStr'))
                try:
                    dd = c.post('https://%s/wecruit/positionInfo/listPositionDetail/%s%s' % (host, suite, q),
                                form={'postId': pid}, headers=h).get('data') or {}
                    desc, req = dd.get('workContent'), dd.get('serviceCondition')
                    cities = [w.get('name') for w in dd.get('workPlaceList') or [] if w.get('name')] or cities
                except Exception as e:  # noqa: BLE001
                    print('   detail failed %s: %s' % (pid, e))
                proj = p.get('projectName') or ''
                lab = '实习' if '实习' in proj else label
                if proj and proj not in ('日常招聘',):
                    lab = '%s（%s）' % (lab, proj)
                col.add(job(pid, p.get('postName'), cities, lab, p.get('postTypeName') or '', '',
                            day(p.get('publishDate')) or day(p.get('publishFirstDate')),
                            'https://%s/%s/pb/posDetail.html?postId=%s&postType=%s' % (host, suite, pid, post_type),
                            desc, req))
            cur += 1
    return col.final()


# ---------------------------------------------------------------- Moka

def split_desc(text):
    """Split one combined JD into (duties, requirements) at the first requirements heading."""
    t = clean(text if len(text or '') < 20000 else text[:20000])
    m = re.search(r'\n\s*[【\[]?\s*(任职要求|岗位要求|任职资格|职位要求|任职条件|岗位资格|我们希望你|你需要具备)', t)
    if not m:
        return t, ''
    return t[:m.start()].strip(), t[m.start():].strip()


def moka(org, sites):
    """Moka's public career-site API (api.mokahr.com/api-platform/v1/jobs/<org>?mode=...), plain JSON.

    The SPA endpoints under app.mokahr.com/api/outer return encrypted payloads and are not used.
    sites: list of (mode, official job-site URL); '#/job/<id>' is appended for the job link."""
    c = Client()
    col = Collector()
    for mode, site in sites:
        offset = 0
        while not col.full():
            d = c.get('https://api.mokahr.com/api-platform/v1/jobs/%s?mode=%s&offset=%d&limit=100'
                      % (org, mode, offset))
            rows = d.get('jobs') or []
            for x in rows:
                title = x.get('title') or ''
                commit = x.get('commitment') or ''
                if '实习' in commit or (mode == 'campus' and '实习' in title):
                    label = '实习'
                else:
                    label = '校招' if mode == 'campus' else '社招'
                exp = ''
                if x.get('minExperience'):
                    exp = '%s年以上' % x['minExperience']
                cities = []
                for loc in x.get('locations') or []:
                    city = loc.get('city') or loc.get('province') or loc.get('country') or ''
                    if city and city not in cities:
                        cities.append(city)
                cat = (x.get('zhineng') or {}).get('name') or (x.get('department') or {}).get('name') or ''
                desc, req = split_desc(x.get('description') or '')
                col.add(job(x.get('id'), title, cities, label, cat, exp,
                            day(x.get('publishedAt') or x.get('openedAt')),
                            site.split('#')[0].rstrip('/') + '#/job/' + (x.get('id') or ''), desc, req))
            offset += len(rows)
            if not rows or offset >= (d.get('total') or 0):
                break
    return col.final()


# ---------------------------------------------------------------- Huawei

def huawei():
    c = Client()
    base = 'https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/'
    h = {'X-HW-ID': 'app_000000035886', 'x-jalor-tenantAlias': 'hcm', 'x-language': 'zh_CN',
         'x-Referer': 'https://career.huawei.com/cn', 'Origin': 'https://career.huawei.com',
         'Referer': 'https://career.huawei.com/'}
    col = Collector()

    def add(p, label):
        desc, req = p.get('mainBusiness') or '', p.get('jobRequire') or ''
        if desc.startswith('请您详见') or req.startswith('请您详见'):
            try:
                ints = c.post(base + 'getPositionIntentionList', json_body={'jobId': p.get('jobId')},
                              headers=h).get('data') or []
                ds, rs = [], []
                for it in ints:
                    name = it.get('positionIntention') or ''
                    ds.append('【%s】\n%s' % (name, clean(it.get('jobResponsibilities'))))
                    rs.append('【%s】\n%s' % (name, clean(it.get('jobDemand'))))
                if ints:
                    desc, req = '\n\n'.join(ds), '\n\n'.join(rs)
            except Exception as e:  # noqa: BLE001
                print('   huawei intention failed %s: %s' % (p.get('jobId'), e))
        col.add(job(p.get('advertisementId') or p.get('jobId'), p.get('jobName'),
                    split_cities(p.get('workPlace') or p.get('jobArea') or ''),
                    label, p.get('categoryName') or p.get('jobFamilyName') or '', p.get('workYear') or '',
                    day(p.get('lastUpdateDate')) or day(p.get('releaseDate')),
                    'https://career.huawei.com/cn/job-details?advertisementId=%s' % p.get('advertisementId'),
                    desc, req))

    for body, label in (({'jobType': 'CR', 'recruitmentType': ['FRESH_GRADUATE']}, '校招'),
                        ({'jobType': 'CR', 'recruitmentType': ['INTERN']}, '实习'),
                        ({'jobType': 'SR'}, '社招')):
        cur, pages = 1, 1
        while cur <= pages and not col.full():
            b = dict(body, curPage=cur, pageSize=50)
            d = c.post(base + 'getJobPage', json_body=b, headers=h).get('data') or {}
            pages = (d.get('pageVO') or {}).get('totalPages') or 0
            for p in d.get('result') or []:
                if col.full():
                    break
                add(p, p.get('scenarioName') if label != '社招' and p.get('scenarioName') else label)
            cur += 1
    return col.final()


# ---------------------------------------------------------------- OPPO

def oppo():
    c = Client()
    col = Collector()
    cur = 1
    while not col.full():
        d = c.post('https://careers.oppo.com/openapi/position/pageNew',
                   json_body={'pageNum': cur, 'pageSize': 50},
                   headers={'Referer': 'https://careers.oppo.com/university/oppo/campus/post'}).get('data') or {}
        recs = d.get('records') or []
        for p in recs:
            req = p.get('positionRequire') or p.get('projectPositionRequire') or ''
            if not req and p.get('knowledgeSkill'):
                req = p['knowledgeSkill']
            cities = [x.get('workCityName') for x in p.get('workCityVOList') or [] if x.get('workCityName')] \
                or split_cities(p.get('workCityName'))
            label = p.get('recruitmentTypeName') or p.get('recruitmentType') or ''
            if p.get('projectName'):
                label = '%s（%s）' % (label, p['projectName'])
            col.add(job(p.get('idRecruitPosition'), p.get('positionName'), cities, label,
                        p.get('positionTypeName') or '', '', day(p.get('releaseTime')),
                        'https://careers.oppo.com/university/oppo/campus/post/%s?recruitType=%s'
                        % (p.get('idRecruitPosition'), p.get('recruitmentType') or ''),
                        p.get('positionDesc') or p.get('projectPositionDesc'), req))
        cur += 1
        if not recs or (cur - 1) * 50 >= (d.get('total') or 0):
            break
    return col.final()


# ---------------------------------------------------------------- vivo

def vivo():
    col = Collector()
    for j in beisen('hr-campus.vivo.com'):
        col.add(j)
    c = Client()
    page = 1
    while not col.full():
        d = c.post('https://hr.vivo.com/api/social/webSite/portal/page',
                   json_body={'city_code_list': [], 'company_id': 1, 'group_id': 1, 'user_id': None,
                              'job_category_id_list': [], 'keyword': '', 'max_results': 50,
                              'page': page, 'yoe_list': []},
                   headers={'Referer': 'https://hr.vivo.com/jobs', 'Origin': 'https://hr.vivo.com'})
        items = d.get('data') or []
        for p in items:
            if col.full():
                break
            exp = ''
            if p.get('yoe_min') is not None:
                exp = '%s-%s年' % (p.get('yoe_min'), p.get('yoe_max')) if p.get('yoe_max') else '%s年以上' % p['yoe_min']
            col.add(job(p.get('job_id'), p.get('job_title'),
                        list(dict.fromkeys(x.get('city') for x in p.get('job_location_list') or [] if x.get('city'))),
                        '社招', p.get('job_category') or '', exp, '',
                        'https://hr.vivo.com/job-detail?_irjc=%s&_irjid=%s' % (p.get('job_category_id'), p.get('job_id')),
                        p.get('job_desc'), ''))
        page += 1
        if len(items) < 50:
            break
    return col.final()


# ---------------------------------------------------------------- Li Auto

def lixiang():
    """Campus / intern jobs from lixiang.com's own site, then social jobs from its Feishu portal."""
    c = Client()
    base = 'https://api-web.lixiang.com/osd-hr-recruitment-website/v1/recruit/'
    h = {'Origin': 'https://www.lixiang.com', 'Referer': 'https://www.lixiang.com/'}
    col = Collector()
    page, pages = 1, 1
    try:
        while page <= pages and not col.full():
            d = c.get(base + 'school/job-page?page=%d&page_size=50' % page, headers=h).get('data') or {}
            pages = d.get('total_pages') or 0
            for p in d.get('items') or []:
                if col.full():
                    break
                jid = p.get('id')
                if not jid or str(jid) in col.seen:
                    continue
                dd = {}
                try:
                    dd = c.get(base + 'job/detail?job_id=%s' % jid, headers=h).get('data') or {}
                except Exception as e:  # noqa: BLE001
                    print('   lixiang detail failed %s: %s' % (jid, e))
                mode = p.get('job_mode_name') or ''
                label = '实习' if '实习' in mode else '校招'
                if dd.get('subject_name'):
                    label = '%s（%s）' % (label, dd['subject_name'])
                cat = '-'.join(x for x in (p.get('first_job_function_title'), p.get('second_job_function_title')) if x)
                col.add(job(jid, p.get('title'), split_cities(p.get('location_title')), label, cat, '', '',
                            'https://www.lixiang.com/employ/detail/%s.html?jobCode=%s' % (jid, p.get('code') or ''),
                            dd.get('description'), dd.get('requirements')))
            page += 1
    except Exception as e:  # noqa: BLE001
        print('   lixiang campus list failed: %s' % e)
    if not col.full():
        for j in feishu('li.jobs.feishu.cn', ['index']):
            if col.full():
                break
            col.add(j)
    return col.final()


# ---------------------------------------------------------------- BYD

_SBOX = None


def _aes_sbox():
    sb = [0] * 256
    p = q = 1
    sb[0] = 0x63
    while True:
        p = p ^ ((p << 1) & 0xff) ^ (0x1b if p & 0x80 else 0)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xff
        if q & 0x80:
            q ^= 0x09
        x = q ^ ((q << 1 | q >> 7) & 0xff) ^ ((q << 2 | q >> 6) & 0xff) ^ ((q << 3 | q >> 5) & 0xff) ^ ((q << 4 | q >> 4) & 0xff)
        sb[p] = x ^ 0x63
        if p == 1:
            return sb


def _xt(a):
    return ((a << 1) ^ 0x1b) & 0xff if a & 0x80 else a << 1


def cryptojs_aes_ecb(plain, key):
    """AES-ECB + PKCS7, base64, the way CryptoJS does it (rounds = key words + 6).

    BYD's job page puts its own route query through this, so this builds the same
    link the site itself shows for a job. It is not used to read any data."""
    global _SBOX
    if _SBOX is None:
        _SBOX = _aes_sbox()
    S = _SBOX
    kw = len(key) // 4
    nr = kw + 6
    w = [int.from_bytes(key[i * 4:i * 4 + 4], 'big') for i in range(kw)]
    rcon = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54] + [0] * 64
    for r in range(kw, (nr + 1) * 4):
        t = w[r - 1]
        if r % kw == 0:
            t = ((t << 8) | (t >> 24)) & 0xffffffff
            t = (S[t >> 24] << 24) | (S[(t >> 16) & 255] << 16) | (S[(t >> 8) & 255] << 8) | S[t & 255]
            t ^= rcon[r // kw] << 24
        elif kw > 6 and r % kw == 4:
            t = (S[t >> 24] << 24) | (S[(t >> 16) & 255] << 16) | (S[(t >> 8) & 255] << 8) | S[t & 255]
        w.append(w[r - kw] ^ t)
    rk = [list(b''.join(w[r * 4 + i].to_bytes(4, 'big') for i in range(4))) for r in range(nr + 1)]
    pad = 16 - len(plain) % 16
    data = plain + bytes([pad]) * pad
    out = b''
    for o in range(0, len(data), 16):
        s = [data[o + i] ^ rk[0][i] for i in range(16)]
        for r in range(1, nr + 1):
            s = [S[x] for x in s]
            s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]
            if r != nr:
                n = []
                for col in range(4):
                    a = s[col * 4:col * 4 + 4]
                    n += [_xt(a[0]) ^ _xt(a[1]) ^ a[1] ^ a[2] ^ a[3],
                          a[0] ^ _xt(a[1]) ^ _xt(a[2]) ^ a[2] ^ a[3],
                          a[0] ^ a[1] ^ _xt(a[2]) ^ _xt(a[3]) ^ a[3],
                          _xt(a[0]) ^ a[0] ^ a[1] ^ a[2] ^ _xt(a[3])]
                s = n
            s = [s[i] ^ rk[r][i] for i in range(16)]
        out += bytes(s)
    return base64.b64encode(out).decode()


def byd():
    c = Client()
    base = 'https://job.byd.com/portal/api/portal-api/schoolPortal/'
    h = {'lang': 'zh_CN', 'Referer': 'https://job.byd.com/portal/pc/'}
    natures = {'008501': '校招-应届生'}
    col = Collector()
    for batch in ('2027', '2028', '2026'):
        cur, pages = 1, 1
        while cur <= pages and not col.full():
            d = c.post(base + 'queryPositionList', headers=h,
                       json_body={'topicCode': '', 'batch': batch, 'campusNature': '', 'abroad': '', 'degree': '',
                                  'jobType': [], 'researchDirection': [], 'workPlace': [], 'keywords': '',
                                  'pageSize': 50, 'pageIndex': cur})
            if not d.get('page'):
                break
            pages = d['page'].get('totalPage') or 0
            for p in d.get('data') or []:
                if col.full():
                    break
                pid = p.get('id')
                if not pid or pid in col.seen:
                    continue
                desc = req = ''
                try:
                    dd = c.get(base + 'queryPosition?' + urllib.parse.urlencode({'id': pid, 'abroad': '', 'degree': ''}),
                               headers=h).get('data') or {}
                    infos = dd.get('positionInfoList') or []
                    if len(infos) == 1:
                        desc, req = infos[0].get('jobDuty'), infos[0].get('jobRequirements')
                    else:
                        desc = '\n\n'.join('【%s】\n%s' % (i.get('researchDirection') or i.get('division') or '', clean(i.get('jobDuty'))) for i in infos)
                        req = '\n\n'.join('【%s】\n%s' % (i.get('researchDirection') or i.get('division') or '', clean(i.get('jobRequirements'))) for i in infos)
                except Exception as e:  # noqa: BLE001
                    print('   byd detail failed %s: %s' % (pid, e))
                label = natures.get(p.get('campusNature'), '校招')
                label = '%s（%s届）' % (label, p.get('batch') or batch)
                link_q = urllib.parse.urlencode({'id': pid, 'abroad': '', 'degree': ''})
                url = 'https://job.byd.com/portal/pc/#/school/schoolPositionDetail?' + \
                    cryptojs_aes_ecb(link_q.encode(), b'ehrPortalKey')
                col.add(job(pid, p.get('jobName'), split_cities(p.get('workPlace')), label,
                            p.get('jobType') or '', '', day(p.get('updateTime')), url, desc, req))
            cur += 1
    return col.final()


# ---------------------------------------------------------------- Midea

def midea():
    c = Client()
    h = {'Referer': 'https://careers.midea.com/schoolOut/post', 'Origin': 'https://careers.midea.com'}
    projects = c.get('https://careers.midea.com/backend/school/position/common/project/list', headers=h).get('data') or []
    col = Collector()
    for pr in projects:
        name = pr.get('projectRuleName') or ''
        label = '实习' if ('实习' in name or pr.get('employementCategory') == 4) else '校招'
        label = '%s（%s）' % (label, name)
        cur, pages = 1, 1
        while cur <= pages and not col.full():
            d = c.post('https://careers.midea.com/backend/school/position/common/position/list', headers=h,
                       json_body={'keyword': None, 'superiorIds': [], 'recruitCategoryIds': [], 'workPlaceCodes': [],
                                  'projectRuleId': pr.get('projectRuleId'), 'pageIndex': cur, 'pageSize': 50}).get('data') or {}
            pages = (d.get('info') or {}).get('totalPage') or 0
            for p in d.get('data') or []:
                pp = p.get('projectPositionDto') or {}
                cities = [w.get('workPlaceName') for w in p.get('workplaceDtoList') or [] if w.get('workPlaceName')] \
                    or split_cities(p.get('workPlaceCode'))
                col.add(job(p.get('positionId'), p.get('projectPositionName') or pp.get('positionName'), cities, label,
                            p.get('recruitCategoryName') or pp.get('largeTypeName') or '', '', '',
                            'https://careers.midea.com/schoolOut/post/details?positionId=%s' % p.get('positionId'),
                            pp.get('jobResponsibility'), pp.get('jobRequirement')))
            cur += 1
    return col.final()


# ---------------------------------------------------------------- Haier

def _between(text, start, ends):
    i = text.find(start)
    if i < 0:
        return ''
    i += len(start)
    j = len(text)
    for e in ends:
        k = text.find(e, i)
        if 0 <= k < j:
            j = k
    return text[i:j].strip().strip('"').strip()


def haier():
    c = Client()
    base = 'https://maker.haier.net'
    page = c.get(base + '/client/campus/activityindex.html', raw=True)
    aids = []
    for aid, title in re.findall(r'aid"\s+value="(\d+)"\s+title="([^"]*)"', page):
        if aid not in [a for a, _ in aids]:
            aids.append((aid, html.unescape(title)))
    col = Collector()
    for aid, title in aids:
        cur = 1
        while not col.full():
            d = c.post(base + '/client/campus/getactivityresearchlist.html',
                       form={'from': 'jituan', 'page': cur, 'pagesize': 50, 'place': '', 'keyword': '', 'aid': aid},
                       headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': base + '/client/campus/activityindex.html'})
            data = d.get('data') or {}
            items = data.get('list') or []
            for p in items:
                if col.full():
                    break
                jid = '%s-%s' % (aid, p.get('id'))
                if jid in col.seen:
                    continue
                url = base + (p.get('click_url') or '')
                desc = req = ''
                try:
                    t = c.get(url, raw=True)
                    t = re.sub(r'(?s)<script.*?</script>|<style.*?</style>', '', t)
                    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
                    t = re.sub(r'\n\s*\n+', '\n', t)
                    desc = _between(t, '岗位描述', ['岗位要求', '工作地点'])
                    req = _between(t, '岗位要求', ['工作地点', '招聘部门'])
                except Exception as e:  # noqa: BLE001
                    print('   haier detail failed %s: %s' % (url, e))
                label = '博士' if '博士' in title else '校招'
                col.add(job(jid, p.get('name'), split_cities(p.get('addr')), '%s（%s）' % (label, title),
                            '-'.join(x for x in (p.get('fun_name'), p.get('department')) if x), '', '', url, desc, req))
            cur += 1
            if not items or (cur - 1) * 50 >= int(data.get('count') or 0):
                break
    return col.final()


# ---------------------------------------------------------------- Hikvision

def hikvision():
    c = Client()
    base = 'https://campushr.hikvision.com'
    h = {'Referer': base + '/school', 'Origin': base}
    col = Collector()
    cur, pages = 1, 1
    while cur <= pages and not col.full():
        d = c.post(base + '/api/search/crsPositionSearch/getPositionByQuery', headers=h,
                   form={'batchId': '', 'postAdSnList': '', 'interviewMethodList': '', 'keyWord': '',
                         'jobNature': '', 'pageNum': cur, 'pageSize': 50}).get('data') or {}
        total = d.get('total') or 0
        pages = (total + 49) // 50
        for p in d.get('list') or []:
            name = p.get('postAdName') or ''
            if p.get('techDire'):
                name = '%s（%s）' % (name, p['techDire'])
            label = p.get('jobNature') or '校招'
            if p.get('batchName'):
                label = '%s %s' % (label, p['batchName'])
            col.add(job(p.get('id'), name, p.get('workPlaceList') or split_cities(p.get('workPlace')), label,
                        p.get('postAdSn') or p.get('postStdName') or '', '',
                        day(p.get('updateTime')) or day(p.get('createTime')),
                        '%s/JobDetails.html?id=%s&type=0&batchId=%s' % (base, p.get('id'), p.get('batchId') or ''),
                        p.get('postContent'), p.get('postRequire')))
        cur += 1
    return col.final()


# ---------------------------------------------------------------- registry

COMPANIES = {
    'huawei': ('华为', 'https://career.huawei.com/cn/', huawei),
    'honor': ('荣耀', 'https://career.honor.com/', lambda: wecruit(
        'career.honor.com', 'SU5ff669649b0d78e6f4296c9a', [(1, 'campus', '校招'), (2, 'society', '社招')])),
    'xiaomi': ('小米', 'https://xiaomi.jobs.f.mioffice.cn/', lambda: feishu(
        'xiaomi.jobs.f.mioffice.cn', ['campus', 'internship', 'index'])),
    'oppo': ('OPPO', 'https://careers.oppo.com/', oppo),
    'vivo': ('vivo', 'https://hr.vivo.com/', vivo),
    'lenovo': ('联想', 'https://talent.lenovo.com.cn/', None),
    'zte': ('中兴', 'https://job.zte.com.cn/', lambda: moka('zte', [
        ('campus', 'https://app.mokahr.com/campus-recruitment/zte/46903'),
        ('social', 'https://app.mokahr.com/social-recruitment/zte/47588')])),
    'dji': ('大疆', 'https://careers.dji.com/', lambda: moka('dji', [
        ('campus', 'https://apply.careers.dji.com/campus-recruitment/dji/143359'),
        ('social', 'https://apply.careers.dji.com/social-recruitment/dji/170070')])),
    'nio': ('蔚来', 'https://nio.jobs.feishu.cn/', lambda: feishu('nio.jobs.feishu.cn', ['campus', 'intern', 'index'])),
    'xpeng': ('小鹏汽车', 'https://xiaopeng.jobs.feishu.cn/', lambda: feishu('xiaopeng.jobs.feishu.cn', ['campus', 'index'])),
    'lixiang': ('理想汽车', 'https://www.lixiang.com/employ/campus.html', lixiang),
    'byd': ('比亚迪', 'https://job.byd.com/', byd),
    'geely': ('吉利', 'https://campus.geely.com/', lambda: moka('geely', [
        ('campus', 'https://campus.geely.com/campus-recruitment/geely/78436')])),
    'greatwall': ('长城汽车', 'https://zhaopin.gwm.cn/', lambda: wecruit(
        'zhaopin.gwm.cn', 'SU692d37b4ea11b01b6c54e0e5', [(1, 'campus', '校招'), (2, 'society', '社招')])),
    'leapmotor': ('零跑汽车', 'https://leapmotor.zhiye.com/', lambda: beisen('leapmotor.zhiye.com')),
    # CATL's campus Moka site id could not be found, so only its social site is linked.
    'catl': ('宁德时代', 'https://talent.catl.com/', lambda: moka('catlhr', [
        ('social', 'https://talent.catl.com/social-recruitment/catlhr/96144')])),
    'boe': ('京东方', 'https://boe.zhiye.com/', lambda: beisen('boe.zhiye.com')),
    'hikvision': ('海康威视', 'https://campushr.hikvision.com/', hikvision),
    'dahua': ('大华', 'https://dahua.zhiye.com/', lambda: beisen('dahua.zhiye.com')),
    'midea': ('美的', 'https://careers.midea.com/', midea),
    'haier': ('海尔', 'https://maker.haier.net/', haier),
    'gree': ('格力', 'https://www.gree.com/', None),
    'tcl': ('TCL', 'https://campus.tcl.com/', lambda: wecruit(
        'wecruit.hotjob.cn', 'SU64893571bef57c16d356b99e', [(1, 'campus', '校招'), (2, 'society', '社招')])),
    'anker': ('安克创新', 'https://career.anker.com.cn/', lambda: feishu(
        'anker-in.jobs.feishu.cn', ['campushirecn', 'index'])),
    'transsion': ('传音', 'https://transsion.zhiye.com/', lambda: beisen('transsion.zhiye.com')),
}

# Why the None entries are skipped (checked 2026-11-24):
SKIPPED = {
    'lenovo': 'campus site talent.lenovo.com.cn has every program closed; social site jobs.lenovo.com '
              '(Avature) rejects non-browser TLS clients',
    'gree': 'no public web job list found; applications go through the WeChat account',
}


def crawl(slug):
    name, site, fn = COMPANIES[slug]
    if fn is None:
        print('%s: skipped (%s)' % (slug, SKIPPED.get(slug, 'no crawler')))
        return None
    t0 = time.time()
    jobs = fn()
    out = {'slug': slug, 'company': name, 'site': site, 'fetched': TODAY, 'jobs': jobs}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, slug + '.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    campus = sum(1 for j in jobs if is_campus(j['recruitType']))
    print('%s: %d jobs (%d campus/intern) in %.0fs' % (slug, len(jobs), campus, time.time() - t0))
    return len(jobs)


def main(argv):
    slugs = argv or list(COMPANIES)
    bad = [s for s in slugs if s not in COMPANIES]
    if bad:
        print('unknown slug(s): %s' % ', '.join(bad))
        slugs = [s for s in slugs if s in COMPANIES]
    for slug in slugs:
        try:
            crawl(slug)
        except Exception:  # noqa: BLE001
            print('%s: FAILED' % slug)
            traceback.print_exc()


if __name__ == '__main__':
    main(sys.argv[1:])
