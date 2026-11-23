#!/usr/bin/env python3
"""Group 1 crawler: big Chinese internet companies.

python3 jobs/crawlers/g1.py            # crawl every company in this group
python3 jobs/crawlers/g1.py tencent jd # crawl only these

Only public postings that the official careers sites show without login.
Standard library only. At least 1 second between requests.
Env LIMIT=n caps jobs per company (for quick tests).
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
OUT_DIR = os.path.join(ROOT, 'companies')
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
    t = html.unescape(t).replace(' ', ' ').replace('​', '')
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
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
    m = re.search(r'(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})', str(v))
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
            c = c.get('name') or c.get('i18n_name') or c.get('cityName') or ''
        c = str(c).strip()
        if not c:
            continue
        c = c.split('·')[-1]
        if '-' in c and not c.startswith('-'):  # 北京市-北京市 / 中国-北京 / 江苏省-南京市-建邺区
            parts = [x for x in c.split('-') if x]
            cand = [x for x in parts if x.endswith('市')]
            c = cand[0] if cand else parts[-1]
        c = re.sub(r'(总部)$', '', c)
        c = re.sub(r'(?<=..)(市|特别行政区)$', '', c)
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
    if re.search(r'实习|intern', r, re.I):
        return 1
    if re.search(r'校|应届|campus|graduate|届|管培|培训生', r, re.I):
        return 0
    return 2


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


# ---------------------------------------------------------------- Feishu Hire (ByteDance ATS)

def feishu(c, base, path, col, recruit_default='', portal_type=None, extra_headers=None, page=100):
    """base: https://xxx.jobs.feishu.cn ; path: website path like 'campus'."""
    referer = '%s/%s/position' % (base, path)
    tok = c.post(base + '/api/v1/csrf/token', {'portal_entrance': 1},
                 headers={'Referer': referer, 'website-path': path})
    token = (tok.get('data') or {}).get('token') or urllib.parse.unquote(c.cookie('atsx-csrf-token'))
    headers = {'Referer': referer, 'x-csrf-token': token, 'website-path': path,
               'Portal-Channel': path, 'Portal-Platform': 'pc', 'Origin': base}
    if extra_headers:
        headers.update(extra_headers)
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
            if rname == '正式' and parent:
                rname = parent
            elif parent and parent not in rname:
                rname = parent + '-' + rname
            subj = ((p.get('job_subject') or {}).get('name') or {}).get('zh_cn') or ''
            if subj and not re.search(r'实习|校|应届|届', rname):
                rname = rname + '/' + subj if rname else subj
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

def beisen(c, base, category, col, rt, detail_path):
    """category: '2' campus, '3' intern, '1' social. detail_path like 'campus'."""
    page = 0
    while not col.full():
        d = c.post(base + '/api/Jobad/GetJobAdPageList',
                   {'PageIndex': page, 'PageSize': 20, 'Category': [category], 'KeyWords': '', 'SpecialType': 0,
                    'PortalId': '', 'DisplayFields': ['Category', 'Kind', 'LocId', 'Degree', 'ClassificationOne']},
                   headers={'Referer': '%s/%s/jobs' % (base, detail_path), 'Origin': base,
                            'X-Requested-With': 'xmlhttprequest', 'langType': 'zh_CN'})
        lst = d.get('Data') or []
        for p in lst:
            title = re.sub(r'\s*[(（][A-Z]+\d+[)）]\s*$', '', p.get('JobAdName') or '')
            r = p.get('Category') or rt
            col.add(job(p['Id'], title, '%s/%s/detail?jobAdId=%s' % (base, detail_path, p['Id']),
                        [re.sub(r'^.*·', '', x) for x in (p.get('LocNames') or [])], r,
                        p.get('ClassificationOne') or '', p.get('WorkYears') or '',
                        ms_date(p.get('PublishDate') or p.get('ChangeDate')), p.get('Duty'), p.get('Require')))
        page += 1
        if len(lst) < 20 or page * 20 >= (d.get('Count') or 0):
            break


# ---------------------------------------------------------------- companies

def crawl_tencent(c, col):
    base = 'https://join.qq.com'
    page = 1
    posts = []
    while page <= 30:
        d = c.post(base + '/api/v1/position/searchPosition',
                   {'projectIdList': [], 'projectMappingIdList': [], 'keyword': '', 'bgList': [],
                    'workCountryType': 0, 'workCityList': [], 'recruitCityList': [], 'positionFidList': [],
                    'pageIndex': page, 'pageSize': 100}, headers={'Referer': base + '/post.html'})
        lst = (d.get('data') or {}).get('positionList') or []
        posts += lst
        if len(lst) < 100:
            break
        page += 1
    # half graduates, half interns (whichever runs short gives its room to the other); site order kept
    grads = [p for p in posts if kind(p.get('projectName') or p.get('recruitLabelName')) != 1]
    interns = [p for p in posts if kind(p.get('projectName') or p.get('recruitLabelName')) == 1]
    half = col.cap // 2
    ng = max(half, col.cap - len(interns))
    posts = grads[:ng] + interns[:col.cap - min(ng, len(grads))]
    for p in posts:
        if col.full():
            break
        pid = p.get('postId')
        try:
            det = c.get(base + '/api/v1/jobDetails/getJobDetailsByPostId?postId=' + pid,
                        headers={'Referer': base + '/post_detail.html?postid=' + pid}).get('data') or {}
        except Exception:
            det = {}
        cities = det.get('workCityList') or (p.get('workCities') or '').split()
        col.add(job(pid, p.get('positionTitle'), base + '/post_detail.html?postid=' + pid, cities,
                    p.get('projectName') or p.get('recruitLabelName') or '', det.get('tidName') or '', '', '',
                    det.get('desc'), det.get('request')))
    # social hires if room (careers.tencent.com, description only)
    page = 1
    while not col.full():
        d = c.get('https://careers.tencent.com/tencentcareer/api/post/Query?timestamp=%d&countryId=&cityId='
                  '&bgIds=&productId=&categoryId=&parentCategoryId=&attrId=&keyword=&pageIndex=%d&pageSize=50'
                  '&language=zh-cn&area=cn' % (int(time.time() * 1000), page))
        lst = (d.get('Data') or {}).get('Posts') or []
        for p in lst:
            col.add(job(p['PostId'], p.get('RecruitPostName'),
                        'https://careers.tencent.com/jobdesc.html?postId=' + p['PostId'], [p.get('LocationName')],
                        '社招', p.get('CategoryName') or '', p.get('RequireWorkYearsName') or '',
                        ms_date(p.get('LastUpdateTime')), p.get('Responsibility'), ''))
        if len(lst) < 50:
            break
        page += 1


def crawl_bytedance(c, col):
    feishu(c, 'https://jobs.bytedance.com', 'campus', col, '校招', portal_type=3)
    if not col.full():
        feishu(c, 'https://jobs.bytedance.com', 'experienced', col, '社招', portal_type=2)


def alibaba_like(c, host, col, campus_channel='campus_group_official_site'):
    base = 'https://' + host
    c.get(base + '/campus/position?lang=zh', raw=True)
    tok = c.cookie('XSRF-TOKEN')
    q = '?_csrf=' + urllib.parse.quote(tok)
    hdr = {'Referer': base + '/campus/position?lang=zh', 'Origin': base}
    b = c.post(base + '/searchCondition/listBatch' + q, {'channel': campus_channel, 'language': 'zh'},
               headers=hdr).get('content') or {}
    batches = []
    for key in (b.get('sequence') or ['graduate', 'internship']):
        for x in b.get(key) or []:
            if x['id'] not in [y[0] for y in batches]:
                batches.append((x['id'], x['name']))
    # pass 1 gives each batch (graduates, daily interns, research interns) a fair share; pass 2 fills up
    share = max(1, col.cap // max(1, len(batches)))
    for quota in (share, col.cap):
        for bid, bname in batches:
            added, page = 0, 1
            while not col.full() and added < quota:
                d = c.post(base + '/position/search' + q,
                           {'channel': campus_channel, 'language': 'zh', 'batchId': str(bid), 'categories': '',
                            'deptCodes': [], 'key': '', 'pageIndex': page, 'pageSize': 20, 'regions': '',
                            'subCategories': ''}, headers=hdr).get('content') or {}
                lst = d.get('datas') or []
                for p in lst:
                    if added >= quota:
                        break
                    if col.add(job(p['id'], p.get('name'), '%s/campus/position/%s' % (base, p['id']),
                                   p.get('workLocations'), p.get('batchName') or bname, p.get('categoryName') or '',
                                   p.get('experience') or '', ms_date(p.get('publishTime') or p.get('modifyTime')),
                                   p.get('description'), p.get('requirement'))):
                        added += 1
                if len(lst) < 20 or page * 20 >= (d.get('totalCount') or 0):
                    break
                page += 1
        if col.full():
            break


def crawl_alibaba(c, col):
    alibaba_like(c, 'campus-talent.alibaba.com', col)


def crawl_meituan(c, col):
    base = 'https://zhaopin.meituan.com'
    for code, rt, hl in (('1', '校招', 'campus'), ('2', '实习', 'campus'), ('3', '社招', 'social')):
        page = 1
        while not col.full():
            d = c.post(base + '/api/official/job/getJobList',
                       {'page': {'pageNo': page, 'pageSize': 50}, 'jobShareType': '1', 'keywords': '',
                        'cityList': [], 'department': [], 'jfJgList': [], 'jobType': [{'code': code, 'subCode': []}],
                        'typeCode': [], 'specialCode': []},
                       headers={'Referer': base + '/web/position', 'Origin': base}).get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                cat = '-'.join(x for x in (p.get('jobFamily'), p.get('jobFamilyGroup')) if x)
                col.add(job(p['jobUnionId'], p.get('name'),
                            '%s/web/position/detail?jobUnionId=%s&highlightType=%s' % (base, p['jobUnionId'], hl),
                            p.get('cityList'), rt, cat, p.get('workYear') or '', ms_date(p.get('refreshTime')),
                            p.get('jobDuty'), p.get('jobRequirement')))
            if len(lst) < 50 or page >= ((d.get('page') or {}).get('totalPage') or 0):
                break
            page += 1


def crawl_baidu(c, col):
    base = 'https://talent.baidu.com'
    for rtype, rt in (('GRADUATE', '校招'), ('INTERN', '实习'), ('SOCIAL', '社招')):
        page = 1
        while not col.full():
            d = c.request(base + '/httservice/getPostListNew',
                          data={'recruitType': rtype, 'pageSize': 20, 'keyWord': '', 'curPage': page, 'projectType': ''},
                          headers={'Referer': base + '/jobs/list'}).get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                title = re.sub(r'\s*[(（][A-Z]*\d+[)）]\s*$', '', p.get('name') or '')
                pre = re.match(r'^([^-]{2,4})-', title)
                if pre and pre.group(1) in (p.get('workPlace') or ''):
                    title = title[pre.end():]
                col.add(job(p.get('postId'), title,
                            '%s/jobs/detail/%s/%s' % (base, rtype, p.get('postId')),
                            p.get('workPlace'), rt, p.get('postType') or '', p.get('workYears') or '',
                            ms_date(p.get('publishDate') or p.get('updateDate')),
                            p.get('workContent'), p.get('serviceCondition')))
            if len(lst) < 20 or page * 20 >= int(d.get('total') or 0):
                break
            page += 1


def kuaishou_like(c, base, api, col, codes, rt_name, url_tpl, referer, cats=None):
    page = 1
    while not col.full():
        body = {'pageNum': page, 'pageSize': 50}
        if codes:
            body['recruitSubProjectCodes'] = codes
        d = c.post(base + api, body, headers={'Referer': referer, 'Origin': base}).get('result') or {}
        lst = d.get('list') or []
        for p in lst:
            nature = p.get('positionNatureCode') or ''
            rt = rt_name(p)
            cities = [x.get('name') for x in (p.get('workLocationDicts') or [])]
            col.add(job(p['id'], p.get('name'), url_tpl % p['id'], cities, rt,
                        p.get('positionCategoryName') or (cats or {}).get(p.get('positionCategoryCode'), ''),
                        p.get('workExperienceName') or '', ms_date(p.get('releaseTime') or p.get('updateTime')),
                        p.get('description'), p.get('positionDemand')))
        if len(lst) < 50 or page * 50 >= (d.get('total') or 0):
            break
        page += 1


def crawl_kuaishou(c, col):
    base = 'https://campus.kuaishou.cn'
    d = c.get(base + '/recruit/campus/e/api/v1/dictionary/batch?types=recruitSubProject,positionCategory').get('result') or {}
    subs = d.get('recruitSubProject') or []
    cats = {x['code']: x['name'] for x in d.get('positionCategory') or []}
    years = [int(m.group(1)) for m in (re.match(r'(\d{4})', s['name']) for s in subs) if m]
    top = max(years) if years else 0
    names = {}
    order = []
    for want in ('应届', '实习'):
        for s in subs:
            if s['name'].startswith(str(top)) and want in s['name'] or (want == '实习' and s['name'].startswith(str(top - 1)) and want in s['name']):
                names[s['code']] = s['name']
                order.append(s['code'])
    for code in order:
        kuaishou_like(c, base, '/recruit/campus/e/api/v1/open/positions/simple', col, [code],
                      lambda p, n=names[code]: n, base + '/#/campus/job-info/%s', base + '/', cats)
    if not col.full():
        zb = 'https://zhaopin.kuaishou.cn'
        kuaishou_like(c, zb, '/recruit/e/api/v1/open/positions/simple', col, None,
                      lambda p: '社招', zb + '/#/official/social/job-info/%s', zb + '/')


def crawl_jd(c, col):
    base = 'https://campus.jd.com'
    for typ, rt in (('present', '校招'), ('internship', '实习'), ('talent', 'TGT专项')):
        page = 1
        while not col.full():
            d = c.post(base + '/api/wx/position/page?type=' + typ,
                       {'pageSize': 10, 'pageIndex': page,
                        'parameter': {'positionName': '', 'planIdList': [], 'jobDirectionCodeList': [],
                                      'workCityCodeList': [], 'positionDeptList': []}},
                       headers={'Referer': base + '/', 'Origin': base}).get('body') or {}
            lst = d.get('items') or []
            for p in lst:
                reqs = p.get('requirementVoList') or []
                cities = [r.get('workCity') for r in reqs]
                exp = next((r.get('workYears') for r in reqs if r.get('workYears')), '') or ''
                cat = '-'.join(x for x in (p.get('jobDirection'), p.get('jobCategory')) if x)
                col.add(job(p['publishId'], p.get('positionName'), '%s/#/details?id=%s' % (base, p['publishId']),
                            cities, rt, cat, exp, ms_date(p.get('publishTime')),
                            p.get('workContent'), p.get('qualification')))
            if not lst:  # totalNumber over-counts, and big pages come back short, so walk 10 at a time
                break
            page += 1


def crawl_netease(c, col):
    for host, pid in (('https://campus.163.com', 103), ('https://campus.game.163.com', 102)):
        page = 1
        while not col.full():
            d = c.get('%s/api/campuspc/position/getJobList?projectId=%d&pageNum=%d&pageSize=50&currentPage=%d'
                      % (host, pid, page, page), headers={'Referer': '%s/app/job/position?id=%d' % (host, pid)})
            d = d.get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                col.add(job('c%s' % p['id'], p.get('positionName'),
                            '%s/app/detail/index?id=%s&projectId=%s' % (host, p['id'], pid),
                            p.get('workPlaceName'), '校招', p.get('positionTypeName') or '', '',
                            ms_date(p.get('updateTime')), p.get('positionDescription'), p.get('positionRequirement')))
            if len(lst) < 50 or page >= (d.get('pages') or 0):
                break
            page += 1
    for wt, rt in (('1', '实习'), ('0', '社招')):
        page = 1
        while not col.full():
            d = c.post('https://hr.163.com/api/hr163/position/queryPage',
                       {'currentPage': page, 'pageSize': 50, 'workType': wt},
                       headers={'Referer': 'https://hr.163.com/job-list.html?workType=' + wt}).get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                cat = '-'.join(x for x in (p.get('productName'), p.get('firstPostTypeName')) if x)
                col.add(job(p['id'], p.get('name'), 'https://hr.163.com/job-detail.html?id=%s&lang=zh' % p['id'],
                            p.get('workPlaceNameList'), rt, cat, p.get('reqWorkYearsName') or '',
                            ms_date(p.get('updateTime')), p.get('description'), p.get('requirement')))
            if len(lst) < 50 or page >= (d.get('pages') or 0):
                break
            page += 1


def crawl_xiaohongshu(c, col):
    base = 'https://job.xiaohongshu.com'
    for rt in ('campus', 'social'):
        page = 1
        while not col.full():
            d = c.post(base + '/websiterecruit/position/pageQueryPosition',
                       {'positionName': '', 'pageNum': page, 'pageSize': 50, 'recruitType': rt},
                       headers={'Referer': base + '/' + rt, 'Origin': base}).get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                proj = p.get('jobProjectName') or ''
                if rt == 'campus':
                    rtype = proj if re.search(r'实习|校招|届|练习生|REDstar|Ace', proj) else ('实习' if '实习' in (p.get('positionName') or '') else '校招' + ('/' + proj if proj else ''))
                    url = '%s/campus/position/%s' % (base, p['positionId'])
                else:
                    rtype = '社招'
                    url = '%s/social/position/%s' % (base, p['positionId'])
                cat = '-'.join(x for x in (p.get('directionName'), p.get('subDirectionName'), p.get('jobType')) if x)
                col.add(job(p['positionId'], p.get('positionName'), url, p.get('workplace'), rtype, cat, '',
                            ms_date(p.get('publishTime')), p.get('duty'), p.get('qualification')))
            if not lst or page >= (d.get('totalPage') or 0):
                break
            page += 1


def split_duty(text):
    """'工作职责:...工作要求:...' -> (duty, requirement)."""
    t = text or ''
    m = re.search(r'\n?\s*【?(工作要求|任职要求|岗位要求|职位要求|任职资格|我们期望你|我们希望你|你需要具备|希望你)】?\s*[:：]?\s*(?=\n|$)', t)
    if not m:
        return t, ''
    duty = re.sub(r'^\s*【?(工作职责|岗位职责|职位描述|你将会负责)】?\s*[:：]?\s*', '', t[:m.start()])
    return duty, t[m.end():]


def crawl_bilibili(c, col):
    base = 'https://jobs.bilibili.com'
    for channel, rt in (('campus', ''), ('social', '社招')):
        hdr = {'X-AppKey': 'ops.ehr-api.auth', 'X-UserType': '2', 'X-Channel': channel,
               'Referer': '%s/%s/positions' % (base, channel), 'Origin': base}
        tok = c.get(base + '/api/auth/v1/csrf/token', headers=hdr).get('data')
        hdr['X-CSRF'] = tok
        api = '/api/campus/position/positionList' if channel == 'campus' else '/api/srs/position/positionList'
        page = 1
        while not col.full():
            d = c.post(base + api, {'pageSize': 50, 'pageNum': page, 'positionName': '', 'postCode': [],
                                    'postCodeList': [], 'workLocationList': [], 'workTypeList': [],
                                    'positionTypeList': [], 'deptCodeList': [], 'recruitType': None,
                                    'practiceTypes': [], 'onlyHotRecruit': 0}, headers=hdr).get('data') or {}
            lst = d.get('list') or []
            for p in lst:
                duty, req = split_duty(p.get('positionDescription'))
                ptype = p.get('positionTypeName') or ''
                r = rt or ('实习' if '实习' in ptype else '校招')
                col.add(job(p['id'], p.get('positionName'), '%s/%s/positions/%s' % (base, channel, p['id']),
                            p.get('workLocation'), r, p.get('postCodeName') or '', p.get('workYears') or '',
                            ms_date(p.get('pushTime')), duty, req))
            if not lst or page >= (d.get('pages') or 0):
                break
            page += 1


def crawl_dewu(c, col):
    feishu(c, 'https://campus.dewu.com', '578078', col, '校招')
    if not col.full():
        feishu(Client(), 'https://poizon.jobs.feishu.cn', 'index', col, '社招')


def crawl_iqiyi(c, col):
    for path in ('campus', 'intern', 'job'):
        if not col.full():
            feishu(Client(), 'https://careers.iqiyi.com', path, col)


def crawl_ke(c, col):
    base = 'https://campus.ke.com'
    for cat, rt, path in (('2', '校园招聘', 'campus'), ('3', '实习生招聘', 'intern'), ('1', '社会招聘', 'campus')):
        beisen(c, base, cat, col, rt, path)


def crawl_tme(c, col):
    base = 'https://join.tencentmusic.com'
    for api, info, path in (('/api/uc-job/list', '/api/uc-job/info', 'campus'), ('/api/job/list', '/api/job/info', 'social')):
        page = 1
        while not col.full():
            d = c.post(base + api, {'page': page, 'ss': 50, 'type': '', 'job_class': [], 'work_city': '',
                                    'setid': '', 'keyword': ''},
                       headers={'Referer': '%s/%s/post/' % (base, path), 'Origin': base}).get('data') or {}
            lst = d.get('items') or []
            for p in lst:
                if col.full():
                    break
                try:
                    det = c.get('%s%s?id=%s' % (base, info, p['id']),
                                headers={'Referer': '%s/%s/post-details?id=%s' % (base, path, p['id'])}).get('data') or {}
                except Exception:
                    det = {}
                wc = p.get('work_city') or det.get('work_city')
                cities = [x.get('label') for x in wc] if isinstance(wc, list) else wc
                rt = p.get('job_type_descr') or ('社招' if path == 'social' else '校招')
                if path == 'campus' and not re.search(r'实习|应届|校', rt):
                    rt = '校招/' + rt
                date = p.get('date') if re.match(r'\d{4}-', p.get('date') or '') else ''
                col.add(job(p['id'], p.get('name'), '%s/%s/post-details?id=%s' % (base, path, p['id']), cities, rt,
                            '-'.join(x for x in (p.get('jobf_descr'), p.get('position_nbr_descr')) if x),
                            det.get('work_year_descr') or '', date,
                            det.get('duty') or p.get('duty'), det.get('requirement')))
            if not lst or page >= ((d.get('_meta') or {}).get('page_count') or 0):
                break
            page += 1


def crawl_shein(c, col):
    base = 'https://careers.shein.cn'
    for tid, rt in (('CAMPUS', '校招'), ('PRACTICE', '实习'), ('SOCIAL', '社招')):
        page = 1
        while not col.full():
            d = c.post(base + '/api/v1/open/grw/front/jobPage',
                       {'current': page, 'cityName': '', 'jobCategoryIds': [], 'cityIds': [], 'jobTypeIds': [tid],
                        'key': '', 'langCode': 'CN', 'size': 50},
                       headers={'Referer': base + '/All-Jobs?jobTypeId=' + tid, 'Origin': base}).get('info') or {}
            lst = d.get('records') or []
            for p in lst:
                if p.get('countryId') not in (None, '', 'CHN'):
                    continue
                duty, req = split_duty(clean(p.get('description')))
                detail = p.get('jobDetailUrl') or ''
                if '#/job/' not in detail and 'mokahr.com' in detail:
                    detail = '%s#/job/%s' % (detail, p['jobId'])
                url = detail or base + '/All-Jobs'
                col.add(job(p['jobId'], p.get('jobTitle'), url, [x.get('cityName') for x in (p.get('cityInfos') or [])],
                            rt, p.get('jobCategoryName') or '', '', ms_date(p.get('releaseDate')), duty, req))
            if len(lst) < 50 or page * 50 >= (d.get('total') or 0):
                break
            page += 1


def crawl_shopee(c, col):
    # careers.shopee.cn reads the shared Sea ATS; there are no mainland-China postings at the moment,
    # so this keeps internships and entry-level roles first (Asia regions; Taipei is hidden by the site itself).
    ats = 'https://ats.workatsea.com/ats/api/v1/user'
    hdr = {'Referer': 'https://careers.shopee.cn/jobs/', 'Origin': 'https://careers.shopee.cn'}
    locs = c.get(ats + '/meta/slice/?flags=16&from_career=true', headers=hdr).get('data', {}).get('flat_locations') or []
    city = {x['city_id']: (x.get('city_name') or x.get('region_name')) for x in locs}
    depts = c.get(ats + '/meta/slice/?flags=262144&from_career=true', headers=hdr).get('data', {}).get('dept_list') or []
    dept = {x['dept_id']: x.get('dept_name') for x in depts}
    for emp, rt in (('4', '实习'), ('1', '校招/Entry Level'), ('2', '社招'), ('3', '社招')):
        off = 0
        while not col.full():
            d = c.get('%s/job/list/?limit=100&offset=%d&employment_ids=%s' % (ats, off, emp), headers=hdr).get('data') or {}
            lst = d.get('job_list') or []
            for p in lst:
                if p.get('region_id') in (1, 18, 28):  # Brazil / Mexico (non-Chinese/English ads), Taipei (hidden by site)
                    continue
                col.add(job(p['id'], p.get('job_name'), 'https://careers.shopee.cn/job-detail/%s/' % p['id'],
                            [city.get(p.get('city_id'), '')], rt, dept.get(p.get('department_id'), ''), '', '',
                            p.get('job_description'), p.get('requirements')))
            off += 100
            if len(lst) < 100 or off >= (d.get('total_count') or 0):
                break


def crawl_didi(c, col):
    # Campus and intern sites are on Moka (encrypted payload, skipped); this is the social-hire portal.
    base = 'https://talent.didiglobal.com'
    page = 1
    while not col.full():
        d = c.get('%s/recruit-portal-service/api/job/front/list?page=%d&size=50' % (base, page),
                  headers={'Referer': base + '/social'}).get('data') or {}
        lst = d.get('items') or []
        for p in lst:
            title = re.sub(r'\s*[(（]JR\d+[)）]\s*$', '', p.get('jobName') or '')
            col.add(job(p['jdId'], title, '%s/social/jobDetail?jdId=%s' % (base, p['jdId']), p.get('workArea'),
                        '社招', '-'.join(x for x in (p.get('jobTypeName'), p.get('deptName')) if x), '',
                        ms_date(p.get('refreshTime') or p.get('createTime')), p.get('jobDuty'), p.get('jobQualification')))
        if len(lst) < 50 or page * 50 >= (d.get('total') or 0):
            break
        page += 1


def crawl_pdd(c, col):
    # Campus site only; the social-hire list needs a signed anti-bot token, so it is skipped.
    base = 'https://careers.pddglobalhr.com'
    api = base + '/api/careers/api/recruit/position/'
    for kind_, path, rt in (('list', 'grad', '校招'), ('train/list', 'intern', '实习')):
        page = 1
        while not col.full():
            d = c.post(api + kind_, {'page': page, 'pageSize': 10},
                       headers={'Referer': '%s/campus/%s' % (base, path), 'Origin': base}).get('result') or {}
            lst = d.get('list') or []
            for p in lst:
                try:
                    det = c.post(api + 'detail', {'id': p['id']}, headers={'Referer': base + '/campus/' + path}).get('result') or {}
                except Exception:
                    det = {}
                r = rt if rt == '实习' else '-'.join(x for x in (rt, p.get('recruitTypeName')) if x)
                if p.get('graduationYear'):
                    r += '/%s届' % p['graduationYear']
                col.add(job(p['id'], p.get('name'), '%s/campus/%s/detail?positionId=%s' % (base, path, p['id']),
                            p.get('workLocationName'), r, p.get('jobName') or '', '', ms_date(p.get('releaseTime')),
                            det.get('jobDuty') or p.get('jobDuty'), det.get('serveRequirement')))
            page += 1
            if not lst or (page - 1) * 10 >= int(d.get('total') or 0):
                break


# ---------------------------------------------------------------- registry

COMPANIES = [
    # slug, name, site, crawler
    ('tencent', '腾讯', 'https://join.qq.com/', crawl_tencent),
    ('alibaba', '阿里巴巴', 'https://talent.alibaba.com/', crawl_alibaba),
    ('antgroup', '蚂蚁集团', 'https://talent.antgroup.com/',
     'skipped: list API needs a client-generated ctoken plus Alipay anti-bot/captcha checks'),
    ('bytedance', '字节跳动', 'https://jobs.bytedance.com/', crawl_bytedance),
    ('meituan', '美团', 'https://zhaopin.meituan.com/', crawl_meituan),
    ('jd', '京东', 'https://campus.jd.com/', crawl_jd),
    ('baidu', '百度', 'https://talent.baidu.com/', crawl_baidu),
    ('kuaishou', '快手', 'https://campus.kuaishou.cn/', crawl_kuaishou),
    ('pdd', '拼多多', 'https://careers.pddglobalhr.com/', crawl_pdd),
    ('netease', '网易', 'https://campus.163.com/', crawl_netease),
    ('xiaohongshu', '小红书', 'https://job.xiaohongshu.com/', crawl_xiaohongshu),
    ('bilibili', '哔哩哔哩', 'https://jobs.bilibili.com/', crawl_bilibili),
    ('didi', '滴滴', 'https://talent.didiglobal.com/', crawl_didi),
    ('ctrip', '携程', 'https://careers.ctrip.com/', 'skipped: API redirects scripted clients to verify.ctrip.com (anti-bot check)'),
    ('weibo', '微博', 'https://career.sina.com.cn/', 'skipped: Moka site, job list API returns an encrypted payload'),
    ('zhihu', '知乎', 'https://app.mokahr.com/apply/zhihu', 'skipped: Moka site, job list API returns an encrypted payload'),
    ('dewu', '得物', 'https://poizon.jobs.feishu.cn/', crawl_dewu),
    ('ke', '贝壳', 'https://campus.ke.com/', crawl_ke),
    ('iqiyi', '爱奇艺', 'https://careers.iqiyi.com/', crawl_iqiyi),
    ('tme', '腾讯音乐', 'https://join.tencentmusic.com/', crawl_tme),
    ('vipshop', '唯品会', 'https://campus.vip.com/', 'skipped: Moka site, job list API returns an encrypted payload'),
    ('shein', 'SHEIN', 'https://careers.shein.cn/', crawl_shein),
    ('shopee', 'Shopee', 'https://careers.shopee.cn/', crawl_shopee),
    ('wuba', '58同城', 'https://campus.58.com/', 'skipped: Moka site, job list API returns an encrypted payload'),
    ('kingsoft', '金山办公', 'https://join.wps.cn/', 'skipped: Moka site, job list API returns an encrypted payload'),
]


def run(slug, name, site, fn):
    if not callable(fn):
        print('[%s] %s' % (slug, fn or 'skipped'), flush=True)
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
