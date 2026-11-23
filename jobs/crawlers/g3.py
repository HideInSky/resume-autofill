#!/usr/bin/env python3
"""Group 3 crawler: AI / autonomous driving / chips / enterprise software companies.

Usage:
    python3 jobs/crawlers/g3.py            # crawl every company in this group
    python3 jobs/crawlers/g3.py horizon pony

Standard library only. Only public, no-login endpoints that the official careers
pages call themselves. At least 1 second between requests to the same host.
Writes jobs/companies/<slug>.json (see jobs/README.md for the format).

Platforms used:
  Feishu Hire (*.jobs.feishu.cn), Moka (public api.mokahr.com/api-platform JSON; the
  encrypted app.mokahr.com SPA endpoints are not used), Beisen (new portal
  /api/Jobad/GetJobAdPageList and old server-rendered CMS), Hotjob wecruit
  (/wecruit/positionInfo/*), Lever public postings API, plus self-built sites
  (Sangfor hr.sangfor.com, Qianxin campus JSONP as fallback).

Not crawled (see SKIPPED below): sites behind a WAF / bot challenge, and companies
where no official careers page could be found.
"""
import gzip
import html
import http.cookiejar
import json
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "companies")
MAX_JOBS = 400
MAX_TEXT = 2000
MIN_INTERVAL = 1.1  # seconds between requests to the same host
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
CST = timezone(timedelta(hours=8))
TODAY = datetime.now(CST).strftime("%Y-%m-%d")

# ---------------------------------------------------------------- http helpers

_host_lock = threading.Lock()
_host_last = {}
_host_locks = {}


def _throttle(url):
    host = urllib.parse.urlsplit(url).hostname or ""
    with _host_lock:
        lk = _host_locks.setdefault(host, threading.Lock())
    lk.acquire()
    try:
        wait = _host_last.get(host, 0) + MIN_INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _host_last[host] = time.time()
    finally:
        lk.release()


class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

    def cookie(self, name):
        for c in self.cj:
            if c.name == name:
                return c.value
        return None

    def request(self, url, data=None, headers=None, method=None, retries=2):
        hdr = {"User-Agent": UA, "Accept": "application/json, text/plain, */*",
               "Accept-Language": "zh-CN,zh;q=0.9", "Accept-Encoding": "gzip"}
        hdr.update(headers or {})
        body = None
        if data is not None:
            if isinstance(data, (dict, list)):
                if "form" in hdr.get("Content-Type", ""):
                    body = urllib.parse.urlencode(data).encode()
                else:
                    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
                    hdr.setdefault("Content-Type", "application/json;charset=UTF-8")
            elif isinstance(data, str):
                body = data.encode("utf-8")
            else:
                body = data
        last = None
        for attempt in range(retries + 1):
            _throttle(url)
            try:
                req = urllib.request.Request(url, data=body, headers=hdr, method=method)
                with self.opener.open(req, timeout=30) as r:
                    raw = r.read()
                    enc = (r.headers.get("Content-Encoding") or "").lower()
                if enc == "gzip" or raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                elif enc == "deflate":
                    raw = zlib.decompress(raw)
                return raw.decode("utf-8", errors="replace")
            except Exception as e:  # network hiccup: retry a couple of times
                last = e
                time.sleep(2 + attempt * 2)
        raise last

    def json(self, url, data=None, headers=None, method=None):
        return json.loads(self.request(url, data, headers, method))


# ---------------------------------------------------------------- text helpers

def clean(text):
    """HTML or plain text -> plain text with \\n line breaks."""
    if not text:
        return ""
    s = str(text)
    if "<" in s and ">" in s:
        s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", s)
        s = re.sub(r"(?i)<br\s*/?>", "\n", s)
        s = re.sub(r"(?i)</(p|div|li|h\d|tr|ul|ol)>", "\n", s)
        s = re.sub(r"(?i)<li[^>]*>", "\n", s)
        s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\r\n", "\n").replace("\r", "\n").replace("\xa0", " ")
    s = s.replace("​", "")
    lines = [ln.strip() for ln in s.split("\n")]
    out, blank = [], False
    for ln in lines:
        if not ln:
            if out and not blank:
                out.append("")
            blank = True
        else:
            out.append(ln)
            blank = False
    return "\n".join(out).strip()


def trunc(s):
    s = s or ""
    return s if len(s) <= MAX_TEXT else s[:MAX_TEXT]


REQ_HEAD = re.compile(r"\n\s*(?:[【\[]?\s*)(任职要求|任职资格|岗位要求|职位要求|任职条件|我们希望你|我们期待|岗位条件|应聘要求|你需要具备|要求)\s*(?:[】\]])?\s*[:：]?\s*\n?")


def split_desc(text):
    """Split one combined JD into (duties, requirements) at a requirements heading."""
    text = clean(text)
    m = REQ_HEAD.search("\n" + text)
    if m and m.start() > 0:
        i = m.start() - 1
        return text[:max(i, 0)].strip(), text[i:].strip()
    return text, ""


def norm_type(*hints):
    """Map platform labels to 校招 / 实习 / 社招 (first decisive hint wins)."""
    joined = " ".join(h for h in hints if h)
    if re.search(r"实习|intern", joined, re.I):
        return "实习"
    if re.search(r"校招|校园|应届|届|campus|graduate|new grad|school|飞星|领航|星火|X-STAR", joined, re.I):
        return "校招"
    if re.search(r"社招|社会|experienced|social|全职|full", joined, re.I):
        return "社招"
    return ""


def ms_to_date(ms):
    try:
        return datetime.fromtimestamp(int(ms) / 1000, CST).strftime("%Y-%m-%d")
    except Exception:
        return ""


def date10(s):
    s = (s or "").strip()
    m = re.match(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})", s)
    if not m or m.group(1) == "0001":
        return ""
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))


def job(id, title, cities, rtype, category="", experience="", posted="", url="",
        description="", requirement=""):
    if isinstance(cities, str):
        cities = [c.strip() for c in re.split(r"[,，、/;；|]", cities) if c.strip()]
    seen, cs = set(), []
    for c in cities or []:
        c = (c or "").strip()
        if c and c not in seen:
            seen.add(c)
            cs.append(c)
    return {
        "id": str(id),
        "title": (title or "").strip(),
        "cities": cs,
        "recruitType": rtype or "",
        "category": category or "",
        "experience": experience or "",
        "posted": posted or "",
        "url": url,
        "description": trunc(clean(description)),
        "requirement": trunc(clean(requirement)),
    }


PRIORITY = {"校招": 0, "实习": 0}


def finalize(jobs):
    """Dedup by id, put 校招/实习 first, cap at MAX_JOBS."""
    seen, uniq = set(), []
    for j in jobs:
        if j["id"] in seen or not j["title"]:
            continue
        seen.add(j["id"])
        uniq.append(j)
    uniq.sort(key=lambda j: PRIORITY.get(j["recruitType"], 1))  # stable
    return uniq[:MAX_JOBS]


def campus_count(jobs):
    return sum(1 for j in jobs if j["recruitType"] in PRIORITY)


# ---------------------------------------------------------------- Feishu Hire

def crawl_feishu(host, paths):
    """paths: list of (website_path, default_type). Campus/intern sites first.

    Uses the same public endpoints the Feishu Hire career site calls anonymously:
    POST /api/v1/csrf/token then POST /api/v1/search/job/posts.
    """
    c = Client()
    base = "https://" + host
    c.json(base + "/api/v1/csrf/token", {"portal_entrance": 1})
    token = urllib.parse.unquote(c.cookie("atsx-csrf-token") or "")
    out = []
    for path, default in paths:
        is_social = default == "社招"
        if is_social and len(out) >= MAX_JOBS:
            continue
        offset, total = 0, None
        while True:
            body = {"keyword": "", "limit": 100, "offset": offset, "job_category_id_list": [],
                    "tag_id_list": [], "location_code_list": [], "subject_id_list": [],
                    "recruitment_id_list": [], "portal_type": 6, "job_function_id_list": [],
                    "storefront_id_list": [], "portal_entrance": 1}
            d = c.json(base + "/api/v1/search/job/posts", body,
                       {"x-csrf-token": token, "website-path": path,
                        "Referer": "%s/%s/position" % (base, path)})
            if d.get("code") != 0:
                raise RuntimeError("feishu %s/%s: %s" % (host, path, d.get("message")))
            data = d.get("data") or {}
            total = data.get("count") or 0
            posts = data.get("job_post_list") or []
            for p in posts:
                rt = p.get("recruit_type") or {}
                parent = (rt.get("parent") or {}).get("name") or ""
                subj = ((p.get("job_subject") or {}).get("name") or {}).get("zh_cn") or ""
                child = rt.get("name") or ""
                if "实习" in child or "实习" in subj:
                    rtype = "实习"
                elif "校" in parent or re.search(r"校园|届|校招", subj):
                    rtype = "校招"
                elif "社" in parent:
                    rtype = "社招"
                else:
                    rtype = default
                info = p.get("job_post_info") or {}
                exp = info.get("experience")
                if isinstance(exp, dict):
                    exp = exp.get("name") or ""
                cities = [x.get("name") for x in (p.get("city_list") or []) if x.get("name")]
                if not cities and p.get("city_info"):
                    cities = [p["city_info"].get("name")]
                out.append(job(
                    p.get("id"), p.get("title"), cities, rtype,
                    category=(p.get("job_category") or {}).get("name") or "",
                    experience=exp or "",
                    posted=ms_to_date(p.get("publish_time")) if p.get("publish_time") else "",
                    url="%s/%s/position/%s/detail" % (base, path, p.get("id")),
                    description=p.get("description"), requirement=p.get("requirement")))
            offset += len(posts)
            if not posts or offset >= total or offset >= 1500:
                break
            # a campus/intern site already gives more than we can keep
            if not is_social and campus_count(out) >= MAX_JOBS and len(out) >= MAX_JOBS:
                break
    return out


# ---------------------------------------------------------------- Beisen (new portal)

def crawl_beisen(host):
    """Beisen recruitment portal (iflytek.zhiye.com style): POST /api/Jobad/GetJobAdPageList."""
    c = Client()
    base = "https://" + host
    out, page, total = [], 0, None
    while True:
        d = c.json(base + "/api/Jobad/GetJobAdPageList",
                   {"PageIndex": page, "PageSize": 100, "KeyWords": "", "SpecialType": 0,
                    "PortalId": "", "DisplayFields": ["Category", "Kind", "LocId", "PostDate",
                                                      "ClassificationOne", "YearsOfWorking"]},
                   {"Referer": base + "/campus/jobs"})
        if d.get("Code") != 200:
            raise RuntimeError("beisen %s: %s" % (host, d.get("Message")))
        total = d.get("Count") or 0
        rows = d.get("Data") or []
        for x in rows:
            cat = x.get("Category") or ""
            kind = x.get("Kind") or ""
            rtype = "社招" if "社会" in cat else ("实习" if ("实习" in cat or "实习" in kind) else
                                                ("校招" if cat else norm_type(kind)))
            portal = {"社招": "social", "实习": "intern"}.get(rtype, "campus")
            name = re.sub(r"\s*\(J\d+\)\s*$", "", x.get("JobAdName") or "")
            out.append(job(
                x.get("Id"), name, x.get("LocNames") or [], rtype,
                category=x.get("ClassificationOne") or "",
                experience=x.get("YearsOfWorking") or "",
                posted=date10(x.get("PostDate")),
                url="%s/%s/detail?jobAdId=%s" % (base, portal, x.get("Id")),
                description=x.get("Duty"), requirement=x.get("Require")))
        page += 1
        if not rows or page * 100 >= total or page >= 30:
            break
    return out


# ---------------------------------------------------------------- Beisen (old CMS, server-rendered)

def crawl_beisen_old(host, sections):
    """Old Beisen CMS portals (smics.zhiye.com): HTML list pages + HTML detail pages.

    sections: list of (list_path, detail_prefix, rtype), e.g. ("campus", "campusxq", "校招").
    """
    c = Client()
    base = "https://" + host
    hdr = {"Accept": "text/html,application/xhtml+xml"}
    items = []
    for list_path, detail_prefix, rtype in sections:
        if rtype == "社招" and len(items) >= MAX_JOBS:
            break
        page, maxpage = 1, 1
        while page <= maxpage and page <= 60:
            s = c.request("%s/%s/?PageIndex=%d" % (base, list_path, page), headers=hdr)
            pages = [int(n) for n in re.findall(r"PageIndex=(\d+)", s)]
            if pages:
                maxpage = max(maxpage, max(pages))
            found = 0
            for href, inner in re.findall(
                    r'<a href="(/%s\?jobId=\d+[^"]*)"[^>]*>(.*?)</a>' % detail_prefix, s, re.S):
                spans = [clean(x) for x in re.findall(r"<span[^>]*>(.*?)</span>", inner, re.S)]
                jid = re.search(r"jobId=(\d+)", href).group(1)
                items.append((jid, detail_prefix, rtype, spans))
                found += 1
            if not found:
                break
            page += 1
    # keep priority order and cap before fetching details
    seen, todo = set(), []
    for it in sorted(items, key=lambda t: PRIORITY.get(t[2], 1)):
        if it[0] not in seen:
            seen.add(it[0])
            todo.append(it)
    todo = todo[:MAX_JOBS]
    out = []
    for jid, prefix, rtype, spans in todo:
        url = "%s/%s?jobId=%s" % (base, prefix, jid)
        title = spans[1] if len(spans) > 1 else ""
        category = spans[0] if spans else ""
        cities = spans[3] if len(spans) > 3 else ""
        desc = req = posted = ""
        try:
            d = c.request(url, headers=hdr)
            m = re.search(r"<h2[^>]*>(.*?)</h2>", d, re.S)
            if m and clean(m.group(1)):
                title = clean(m.group(1))
            blocks = re.findall(r'<h3[^>]*>(.*?)</h3>\s*<div class="xqm">(.*?)</div>', d, re.S)
            for head, body in blocks:
                head = clean(head)
                if re.search(r"要求|资格|条件", head):
                    req = body
                elif not desc:
                    desc = body
            info = dict((clean(k).rstrip("：:"), clean(v)) for k, v in re.findall(
                r"<li><span>(.*?)</span><b[^>]*>(.*?)</b></li>", d, re.S))
            posted = date10(info.get("更新时间", ""))
            category = info.get("职位类别") or category
            cities = info.get("工作地点") or cities
        except Exception as e:
            print("  detail failed %s: %s" % (url, e), file=sys.stderr)
        title = re.sub(r"\s*\(J\d+\)\s*$", "", title)
        out.append(job(jid, title, cities, rtype, category=category, posted=posted, url=url,
                       description=desc, requirement=req))
    return out


# ---------------------------------------------------------------- Hotjob wecruit

HOTJOB_POSTTYPE = {1: "campus", 2: "society", 12: "intern", 13: "overseas"}
HOTJOB_TYPE = {1: "校招", 2: "社招", 12: "实习", 13: "社招"}


def crawl_hotjob(host, sites):
    """Hotjob wecruit portals: POST /wecruit/positionInfo/listPosition/<SU> for lists and
    /wecruit/positionInfo/listPositionDetail/<SU> for each job's text.

    sites: list of (SU key, [recruitType ...]) with campus/intern types first.
    """
    c = Client()
    base = "https://" + host
    rows = []
    for su, rtypes in sites:
        for rt in rtypes:
            if HOTJOB_TYPE.get(rt) == "社招" and len(rows) >= MAX_JOBS:
                continue
            page, total_page = 1, 1
            while page <= total_page and page <= 40:
                d = c.json("%s/wecruit/positionInfo/listPosition/%s?iSaJAx=isAjax&request_locale=zh_CN&t=%d"
                           % (base, su, int(time.time() * 1000)),
                           {"isFrompb": "true", "recruitType": rt, "pageSize": 50, "currentPage": page},
                           {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "Referer": "%s/%s/pb/index.html" % (base, su)})
                pf = ((d.get("data") or {}).get("pageForm") or {})
                total_page = pf.get("totalPage") or 0
                for p in pf.get("pageData") or []:
                    rows.append((su, rt, p))
                page += 1
                if len(rows) >= MAX_JOBS * 2:
                    break
    seen, todo = set(), []
    for su, rt, p in sorted(rows, key=lambda t: PRIORITY.get(HOTJOB_TYPE.get(t[1], "社招"), 1)):
        if p.get("postId") in seen:
            continue
        seen.add(p.get("postId"))
        todo.append((su, rt, p))
    todo = todo[:MAX_JOBS]
    out = []
    for su, rt, p in todo:
        pid = p.get("postId")
        prt = p.get("recruitType") or rt
        detail = {}
        try:
            dd = c.json("%s/wecruit/positionInfo/listPositionDetail/%s?iSaJAx=isAjax&request_locale=zh_CN&t=%d"
                        % (base, su, int(time.time() * 1000)), {"postId": pid},
                        {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                         "Referer": "%s/%s/pb/posDetail.html" % (base, su)})
            detail = dd.get("data") or {}
        except Exception as e:
            print("  detail failed %s: %s" % (pid, e), file=sys.stderr)
        cities = [w.get("name") for w in (detail.get("workPlaceList") or []) if w.get("name")] \
            or re.split(r"[、,，]", p.get("workPlaceStr") or "")
        rtype = HOTJOB_TYPE.get(prt, "")
        if p.get("recruitmentType") and "实习" in p.get("recruitmentType"):
            rtype = "实习"
        out.append(job(
            pid, p.get("postName"), cities, rtype,
            category=p.get("postTypeName") or "",
            experience=p.get("workYears") or detail.get("workYears") or "",
            posted=date10(p.get("publishDate") or p.get("publishFirstDate")),
            url="%s/%s/pb/posDetail.html?postId=%s&postType=%s" % (base, su, pid,
                                                                    HOTJOB_POSTTYPE.get(prt, "campus")),
            description=detail.get("workContent") or "",
            requirement=detail.get("serviceCondition") or ""))
    return out


# ---------------------------------------------------------------- Moka

def crawl_moka(org, campus_url=None, social_url=None):
    """Moka's public career-site API (api.mokahr.com/api-platform/v1/jobs/<org>?mode=campus|social),
    which returns plain JSON. (The app.mokahr.com/api/outer/... endpoints used by the SPA return
    encrypted payloads and are NOT used.) campus_url / social_url are the org's official Moka
    site URLs; '#/job/<id>' is appended to make the job page link."""
    c = Client()
    out = []
    for mode, site in (("campus", campus_url), ("social", social_url)):
        if not site:
            continue
        if mode == "social" and len(out) >= MAX_JOBS:
            break
        offset = 0
        while offset < 2000:
            d = c.json("https://api.mokahr.com/api-platform/v1/jobs/%s?mode=%s&offset=%d&limit=100"
                       % (org, mode, offset))
            rows = d.get("jobs") or []
            for x in rows:
                commit = x.get("commitment") or ""
                title = x.get("title") or ""
                if "实习" in commit or (mode == "campus" and "实习" in title):
                    rtype = "实习"
                else:
                    rtype = "校招" if mode == "campus" else "社招"
                exp = ""
                if x.get("minExperience"):
                    exp = "%s年以上" % x["minExperience"]
                cities = []
                for l in x.get("locations") or []:
                    cities.append(l.get("city") or l.get("province") or l.get("country") or "")
                cat = (x.get("zhineng") or {}).get("name") or (x.get("department") or {}).get("name") or ""
                desc, req = split_desc(x.get("description") or "")
                out.append(job(x.get("id"), title, cities, rtype, category=cat, experience=exp,
                               posted=date10(x.get("publishedAt") or x.get("openedAt")),
                               url=site.split("#")[0] + "#/job/" + (x.get("id") or ""),
                               description=desc, requirement=req))
            offset += len(rows)
            if not rows or offset >= (d.get("total") or 0):
                break
    return out


# ---------------------------------------------------------------- Lever

def crawl_lever(account):
    c = Client()
    d = c.json("https://api.lever.co/v0/postings/%s?mode=json" % account)
    out = []
    for p in d:
        cat = p.get("categories") or {}
        title = p.get("text") or ""
        rtype = norm_type(cat.get("commitment") if "intern" in (cat.get("commitment") or "").lower() else "",
                          "campus" if re.search(r"new grad|campus|校招|graduate", title, re.I) else "",
                          "social")
        req = "\n\n".join("%s\n%s" % (l.get("text", ""), clean(l.get("content", "")))
                          for l in (p.get("lists") or []))
        locs = cat.get("allLocations") or ([cat.get("location")] if cat.get("location") else [])
        out.append(job(p.get("id"), title, locs, rtype,
                       category=cat.get("team") or cat.get("department") or "",
                       posted=ms_to_date(p.get("createdAt")) if p.get("createdAt") else "",
                       url=p.get("hostedUrl") or "",
                       description=p.get("descriptionPlain") or p.get("description") or "",
                       requirement=req))
    return out


# ---------------------------------------------------------------- self-built sites

def crawl_sangfor():
    """hr.sangfor.com: the page fetches an anonymous bearer token from /api/api/connect/token
    on load, then POSTs /api/api/Jobs per channel."""
    c = Client()
    base = "https://hr.sangfor.com"
    tok = c.json(base + "/api/api/connect/token", headers={"X-Requested-With": "XMLHttpRequest"})["access_token"]
    hdr = {"Authorization": "Bearer " + tok, "X-Requested-With": "XMLHttpRequest",
           "Content-Type": "application/json;charset=UTF-8", "Referer": base + "/campuszp"}
    channels = [(101, "校招"), (121, "校招"), (102, "实习"), (110, "社招")]
    out = []
    for ch, rtype in channels:
        if rtype == "社招" and len(out) >= MAX_JOBS:
            break
        page = 1
        while page <= 40:
            d = c.json(base + "/api/api/Jobs", {"channelId": ch, "page": page, "pageSize": 50,
                                                "departmentId": 0, "functionId": 0, "kw": "",
                                                "locationId": 0, "workPlaceId": 0}, hdr)
            data = d.get("data") or {}
            rows = data.get("listData") or []
            for x in rows:
                desc, req = split_desc(x.get("description"))
                exp = ""
                if x.get("minExperience"):
                    exp = "%s年以上" % x["minExperience"]
                cities = x.get("workPlaceText") or x.get("locationText") or ""
                out.append(job(x.get("positionId"), x.get("title"), cities, rtype,
                               category=x.get("functionName") or "", experience=exp,
                               posted=date10(x.get("openedAt") or x.get("appendTime")),
                               url="%s/Delivery/%s" % (base, x.get("positionId")),
                               description=desc, requirement=req))
            if not rows or page * 50 >= (data.get("count") or 0):
                break
            page += 1
    return out


def crawl_qianxin():
    """campus.qianxin.com: GET /Job/Campus/lists (JSONP) used by the campus job search page.
    Social hiring (hotjob.cn/wt/qianxin) uses an encrypted mode, so it is not crawled."""
    c = Client()
    s = c.request("https://campus.qianxin.com/Job/Campus/lists?callback=jsonpReturn&_=%d" % int(time.time() * 1000),
                  headers={"Referer": "https://campus.qianxin.com/campus/jobSearch"})
    d = json.loads(s[s.find("(") + 1:s.rfind(")")])
    out = []
    for x in (d.get("data") or {}).get("jobs") or []:
        tag = x.get("jobTag") or ""
        rtype = "实习" if "实习" in tag else "校招"
        url = x.get("jobUrl") or "https://campus.qianxin.com/campus/jobSearch"
        out.append(job(x.get("id"), x.get("name"), x.get("jobCity") or "", rtype,
                       category=x.get("jobType") or "", posted="", url=url,
                       description=x.get("content"), requirement=x.get("description")))
    return out


# ---------------------------------------------------------------- company table

COMPANIES = {
    "iflytek": ("科大讯飞", "https://iflytek.zhiye.com/", lambda: crawl_beisen("iflytek.zhiye.com")),
    "sensetime": ("商汤", "https://hr.sensetime.com/", lambda: crawl_feishu(
        "sensetime.jobs.feishu.cn", [("edu", "校招"), ("exp", "社招")])),
    "horizon": ("地平线", "https://www.horizon.auto/", lambda: crawl_hotjob(
        "wecruit.hotjob.cn", [("SU6409ef49bef57c635fd390a6", [1, 12]),
                              ("SU64819a4f2f9d2433ba8b043a", [2])])),
    "zhuoyu": ("卓驭科技", "https://we.zyt.com/", lambda: crawl_beisen("we.zyt.com")),
    "weride": ("文远知行", "https://www.weride.ai/careers", lambda: crawl_moka(
        "jingchi", "https://app.mokahr.com/campus_apply/jingchi/2137",
        "https://app.mokahr.com/apply/jingchi/2138") + crawl_lever("weride")),
    "megvii": ("旷视", "https://www.megvii.com/join_us", lambda: crawl_moka(
        "megviihr", "https://app.mokahr.com/campus_apply/megviihr/38642",
        "https://app.mokahr.com/social-recruitment/megviihr/38641")),
    "cambricon": ("寒武纪", "https://www.cambricon.com/", lambda: crawl_moka(
        "cambricon", "https://app.mokahr.com/campus-recruitment/cambricon/44201",
        "https://app.mokahr.com/apply/cambricon/1113")),
    "gigadevice": ("兆易创新", "https://www.gigadevice.com.cn/about/career", lambda: crawl_moka(
        "gigadevice", "https://app.mokahr.com/campus-recruitment/gigadevice/92215",
        "https://app.mokahr.com/social-recruitment/gigadevice/100227")),
    "moonshot": ("月之暗面", "https://careers.kimi.com/", lambda: crawl_moka(
        "moonshot", "https://app.mokahr.com/campus-recruitment/moonshot/148507",
        "https://app.mokahr.com/apply/moonshot/148506")),
    "zhipu": ("智谱", "https://www.zhipuai.cn/zh/joinus", lambda: crawl_moka(
        "zphz", "https://app.mokahr.com/campus-recruitment/zphz/148984",
        "https://app.mokahr.com/social-recruitment/zphz/148983")),
    "stepfun": ("阶跃星辰", "https://www.stepfun.com/", lambda: crawl_moka(
        "step", "https://app.mokahr.com/campus-recruitment/step/94905",
        "https://app.mokahr.com/social-recruitment/step/94904")),
    "hygon": ("海光信息", "https://app.mokahr.com/campus-recruitment/hygon/169939", lambda: crawl_moka(
        "hygon", "https://app.mokahr.com/campus-recruitment/hygon/169939",
        "https://app.mokahr.com/social-recruitment/hygon/169938")),
    "4paradigm": ("第四范式", "https://www.4paradigm.com/", lambda: crawl_moka(
        "4paradigm", None,
        "https://app.mokahr.com/social-recruitment/4paradigm/102013")),
    "pony": ("小马智行", "https://careers.pony.ai/", lambda: crawl_feishu(
        "ponyai.jobs.feishu.cn", [("ponyai", "社招")])),
    "momenta": ("Momenta", "https://www.momenta.cn/join.html", lambda: crawl_feishu(
        "momenta.jobs.feishu.cn", [("campus", "校招"), ("intern", "实习"), ("talent", "社招")])),
    "agibot": ("智元机器人", "https://agirobot.jobs.feishu.cn/", lambda: crawl_feishu(
        "agirobot.jobs.feishu.cn", [("campusrecruitment", "校招"), ("internrecruitment", "实习"),
                                    ("socialrecruitment", "社招")])),
    "unisoc": ("紫光展锐", "https://www.unisoc.com/cn/about/join-us", lambda: crawl_hotjob(
        "wecruit.hotjob.cn", [("SU629649680dcad452299568a2", [1, 12]),
                              ("SU650d409e6202cc7d7a295264", [2])])),
    "smic": ("中芯国际", "https://smics.zhiye.com/", lambda: crawl_beisen_old(
        "smics.zhiye.com", [("campus", "campusxq", "校招"), ("social", "socialxq", "社招")])),
    "omnivision": ("豪威", "https://ovt-omnivision.zhiye.com/", lambda: crawl_beisen("ovt-omnivision.zhiye.com")),
    "minimax": ("MiniMax", "https://www.minimaxi.com/careers", lambda: crawl_feishu(
        "vrfi1sk8a0.jobs.feishu.cn", [("379481", "校招"), ("index", "社招")])),
    "baichuan": ("百川智能", "https://careers.baichuan-inc.com/", lambda: crawl_feishu(
        "cq6qe6bvfr6.jobs.feishu.cn", [("646926", "实习"), ("baichuanzhaopin", "社招")])),
    "sangfor": ("深信服", "https://hr.sangfor.com/", crawl_sangfor),
    "qianxin": ("奇安信", "https://campus.qianxin.com/", lambda: crawl_moka(
        "qianxin", "https://app.mokahr.com/campus-recruitment/qianxin/29182") or crawl_qianxin()),
    "yonyou": ("用友", "https://career.yonyou.com/", lambda: crawl_hotjob(
        "career.yonyou.com", [("SU67ac41886202cc7916ae3029", [1, 12, 2])])),
}

SKIPPED = {
    "unitree": "宇树: api.unitree.com/website/job/list and the position pages sit behind a WAF bot challenge",
}


def run(slug):
    name, site, fn = COMPANIES[slug]
    t0 = time.time()
    jobs = finalize(fn())
    data = {"slug": slug, "company": name, "site": site, "fetched": TODAY, "jobs": jobs}
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, slug + ".json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    by = {}
    for j in jobs:
        by[j["recruitType"] or "?"] = by.get(j["recruitType"] or "?", 0) + 1
    print("%-10s %4d jobs %s (%.0fs)" % (slug, len(jobs), by, time.time() - t0), flush=True)
    return len(jobs)


def main(argv):
    slugs = argv or list(COMPANIES)
    results = {}
    threads = []

    def worker(s):
        try:
            results[s] = run(s)
        except Exception as e:
            results[s] = "error: %s" % e
            print("%-10s FAILED: %s" % (s, e), file=sys.stderr, flush=True)
            traceback.print_exc()

    for s in slugs:
        if s in SKIPPED:
            print("%-10s skipped: %s" % (s, SKIPPED[s]))
            continue
        if s not in COMPANIES:
            print("%-10s unknown slug" % s)
            continue
        t = threading.Thread(target=worker, args=(s,))
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    total = sum(v for v in results.values() if isinstance(v, int))
    print("total %d jobs from %d companies" % (total, sum(1 for v in results.values() if isinstance(v, int))))


if __name__ == "__main__":
    main(sys.argv[1:])
