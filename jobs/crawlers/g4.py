#!/usr/bin/env python3
"""Group 4 job crawler (games / finance / logistics / misc).

python3 jobs/crawlers/g4.py            crawl every company in this group
python3 jobs/crawlers/g4.py mihoyo cmb only those slugs

Standard library only. Writes jobs/companies/<slug>.json (format in jobs/README.md).
Only public, login-free endpoints that the official careers pages call themselves.
"""
import datetime
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

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "companies")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
MAX_JOBS = 400
MAX_TEXT = 2000
DELAY = 1.1  # seconds between requests

# --------------------------------------------------------------------------- http


class Http:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.last = 0.0

    def _wait(self):
        d = time.time() - self.last
        if d < DELAY:
            time.sleep(DELAY - d)
        self.last = time.time()

    def raw(self, url, data=None, headers=None, method=None, timeout=30):
        self._wait()
        h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*",
             "Accept-Language": "zh-CN,zh;q=0.9"}
        if headers:
            h.update(headers)
        if isinstance(data, (dict, list)):
            data = json.dumps(data).encode()
            h.setdefault("Content-Type", "application/json;charset=UTF-8")
        elif isinstance(data, str):
            data = data.encode()
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        last_err = None
        for attempt in range(3):
            try:
                with self.op.open(req, timeout=timeout) as r:
                    b = r.read()
                    enc = r.headers.get("Content-Encoding", "")
                    if enc == "gzip":
                        import gzip
                        b = gzip.decompress(b)
                    return b.decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                    last_err = e
                    time.sleep(2 + attempt * 2)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last_err = e
                time.sleep(2 + attempt * 2)
        raise last_err

    def json(self, url, data=None, headers=None, method=None):
        return json.loads(self.raw(url, data, headers, method))

    def cookie(self, name):
        for c in self.cj:
            if c.name == name:
                return c.value
        return None


# --------------------------------------------------------------------------- utils


def clean(s):
    """HTML / rich text -> plain text with \n line breaks."""
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    if "<" in s and ">" in s:
        s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", s)
        s = re.sub(r"(?i)<br\s*/?>", "\n", s)
        s = re.sub(r"(?i)</(p|div|li|h\d|tr|ul|ol)>", "\n", s)
        s = re.sub(r"(?i)<li[^>]*>", "", s)
        s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ").replace("​", "").replace("﻿", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.split("\n")]
    s = "\n".join(ln for ln in lines if ln)
    return s.strip()


def trunc(s):
    s = clean(s)
    return s[:MAX_TEXT]


def ymd(v):
    """epoch seconds/ms or date-ish string -> YYYY-MM-DD"""
    if v in (None, "", 0):
        return ""
    try:
        if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
            n = float(v)
            if n > 1e11:
                n /= 1000.0
            return datetime.datetime.fromtimestamp(n, datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")
    except Exception:
        return ""
    m = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", str(v))
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    return ""


def city_list(v):
    out = []
    if not v:
        return out
    if isinstance(v, str):
        v = re.split(r"[,，、/;；|]\s*", v)
    for c in v:
        if isinstance(c, dict):
            c = c.get("name") or c.get("city") or c.get("cityName") or c.get("addressDetail") or ""
        c = str(c).strip()
        if c.endswith("市") and len(c) > 2:
            c = c[:-1]
        if c and c not in out:
            out.append(c)
    return out


def split_desc_req(text):
    """Split a combined block into (description, requirement) at a 任职要求-like heading."""
    t = clean(text)
    m = re.search(r"((?:(?:^|\n)\s*(?:[一二三四五六七八九十\d]+\s*[、.．]\s*)?|(?=[【\[]))[【\[]?\s*"
                  r"([一-龥]{0,4}要求|任职资格|任职条件|我们希望你|希望你|你需要|我们期待|Requirements?|Qualifications?)"
                  r"\s*[】\]]?\s*[:：]?)", t)
    if m and m.start() > 0:
        return t[:m.start()].strip(), t[m.start():].strip()
    return t, ""


def job(id, title, cities=None, recruitType="", category="", experience="", posted="",
        url="", description="", requirement=""):
    return {
        "id": str(id or ""),
        "title": clean(title),
        "cities": city_list(cities),
        "recruitType": recruitType or "",
        "category": clean(category),
        "experience": clean(experience),
        "posted": posted or "",
        "url": url or "",
        "description": trunc(description),
        "requirement": trunc(requirement),
    }


class Collector:
    """Accumulates jobs in priority buckets: campus, intern, social."""

    def __init__(self):
        self.buckets = {"campus": [], "intern": [], "social": []}
        self.seen = set()

    def add(self, bucket, j):
        key = j["id"] or (j["title"] + "|" + j["url"])
        if key in self.seen:
            return False
        self.seen.add(key)
        self.buckets[bucket].append(j)
        return True

    def count(self, *buckets):
        return sum(len(self.buckets[b]) for b in (buckets or self.buckets))

    def room(self):
        return MAX_JOBS - self.count()

    def jobs(self):
        out = self.buckets["campus"] + self.buckets["intern"] + self.buckets["social"]
        return out[:MAX_JOBS]


def bucket_of(text, default="social"):
    t = (text or "").lower()
    if "实习" in t or "intern" in t:
        return "intern"
    if "校" in t or "应届" in t or "campus" in t or "graduate" in t or "届" in t or "管培" in t:
        return "campus"
    if "社" in t or "social" in t or "experienced" in t:
        return "social"
    return default


# --------------------------------------------------------------------------- Feishu Hire


def feishu(host, portals):
    """portals: list of (website_path, bucket). Detail url: https://host/<path>/position/<id>/detail"""
    def run(h, col):
        base = "https://%s" % host
        tok = h.json(base + "/api/v1/csrf/token", {"portal_entrance": 1})["data"]["token"]
        for path, bucket in portals:
            offset = 0
            while col.room() > 0:
                body = {"keyword": "", "limit": 50, "offset": offset, "job_category_id_list": [],
                        "location_code_list": [], "subject_id_list": [], "recruitment_id_list": [],
                        "portal_type": 2, "job_function_id_list": [], "portal_entrance": 1}
                d = h.json(base + "/api/v1/search/job/posts", body, headers={
                    "x-csrf-token": tok, "Referer": base + "/" + path, "website-path": path,
                    "portal-channel": "office", "portal-platform": "pc", "Origin": base})
                data = d.get("data") or {}
                lst = data.get("job_post_list") or []
                for p in lst:
                    rt = p.get("recruit_type") or {}
                    par = rt.get("parent") or {}
                    rtype = "/".join(x for x in [par.get("name"), rt.get("name")] if x) or bucket
                    cat = p.get("job_category") or {}
                    cname = cat.get("name") or ""
                    if cat.get("parent") and cat["parent"].get("name"):
                        cname = cat["parent"]["name"] + "-" + cname
                    cities = [c.get("name") for c in (p.get("city_list") or [])]
                    if not cities and p.get("city_info"):
                        cities = [p["city_info"].get("name")]
                    b = bucket
                    if "实习" in rtype:
                        b = "intern"
                    info = p.get("job_post_info") or {}
                    desc, req = p.get("description") or "", p.get("requirement") or ""
                    if not clean(req):
                        desc, req = split_desc_req(desc)
                    col.add(b, job(p.get("id"), p.get("title"), cities, rtype, cname,
                                   info.get("experience") or "",
                                   ymd(p.get("publish_time")),
                                   "%s/%s/position/%s/detail" % (base, path, p.get("id")),
                                   desc, req))
                offset += len(lst)
                if not lst or offset >= (data.get("count") or 0):
                    break
    return run


# --------------------------------------------------------------------------- Moka api-platform
# Public career-site API (api.mokahr.com/api-platform/v1/jobs/<org>?mode=campus|social) that
# Moka-hosted career pages call; returns plain JSON incl. description.


def moka(org, campus_url=None, social_url=None, api="https://api.mokahr.com/api-platform/v1/jobs/"):
    """campus_url / social_url: job page prefix; job id is appended (e.g. '...#/job/')."""
    def run(h, col):
        for mode, prefix in (("campus", campus_url), ("social", social_url)):
            if not prefix:
                continue
            offset = 0
            while col.room() > 0:
                d = h.json(api + org + "?mode=%s&offset=%d&limit=100" % (mode, offset))
                lst = d.get("jobs") or []
                for it in lst:
                    commit = it.get("commitment") or ""
                    cf = {c.get("name"): c.get("value") for c in (it.get("customFields") or [])}
                    title = it.get("title") or ""
                    if mode == "campus":
                        b = "intern" if ("实习" in commit or "实习" in title) else "campus"
                    else:
                        b = "intern" if "实习" in commit else "social"
                    rtype = "/".join(x for x in [("校园招聘" if mode == "campus" else "社会招聘"), commit] if x)
                    exp = ""
                    if it.get("minExperience"):
                        exp = "%s年以上" % it["minExperience"]
                    cat = (it.get("zhineng") or {}).get("name") or (it.get("department") or {}).get("name") or ""
                    desc, req = split_desc_req(it.get("description") or "")
                    cities = [l.get("city") or l.get("province") for l in (it.get("locations") or [])]
                    col.add(b, job(it.get("id"), title, cities, rtype, cat, exp,
                                   ymd(it.get("publishedAt") or it.get("openedAt")),
                                   prefix + it.get("id", ""), desc, req))
                offset += len(lst)
                if not lst or offset >= (d.get("total") or 0):
                    break
    return run


# --------------------------------------------------------------------------- Beisen (*.zhiye.com)


def beisen(host, portal_id, plans):
    """plans: list of (category_id, bucket, label, detail_path) e.g. (3, 'intern', '项目实习', 'custom/projectxq?jc=3&hideMenu=1')."""
    def run(h, col):
        base = "https://%s" % host
        for cat_id, b, label, detail in plans:
            page = 0  # PageIndex is 0-based
            while col.room() > 0:
                body = {"Category": [cat_id], "PageIndex": page, "PageSize": 50,
                        "DisplayFields": ["Category", "Kind", "LocId", "Org", "HeadCount", "Station", "EndTime",
                                          "PostDate", "Salary", "ClassificationOne", "ClassificationTwo"]}
                if portal_id:
                    body["PortalId"] = portal_id
                d = h.json(base + "/api/Jobad/GetJobAdPageList", body,
                           headers={"Referer": base + "/", "Origin": base})
                lst = d.get("Data") or []
                for it in lst:
                    cat = "/".join(x for x in [it.get("ClassificationOne"), it.get("ClassificationTwo"), it.get("Org")]
                                   if x and isinstance(x, str))
                    sep = "&" if "?" in detail else "?"
                    col.add(b, job(it.get("Id"), it.get("JobAdName"), it.get("LocNames"),
                                   it.get("Category") or label, cat, it.get("YearsOfWorking") or "",
                                   ymd(it.get("PostDate")) if not str(it.get("PostDate", "")).startswith("0001") else "",
                                   "%s/%s%sjobAdId=%s" % (base, detail, sep, it.get("Id")),
                                   it.get("Duty"), it.get("Require")))
                if not lst or (page + 1) * 50 >= (d.get("Count") or 0):
                    break
                page += 1
    return run


# --------------------------------------------------------------------------- companies


def crawl_mihoyo(h, col):
    api = "https://ats.openout.mihoyo.com/ats-portal/v1"
    for hire_type, path, default in ((1, "#/campus/position/", "campus"), (0, "#/position/", "social")):
        page = 1
        ids = []
        while True:
            d = h.json(api + "/job/list", {"pageNo": page, "pageSize": 50, "channelDetailIds": [1], "hireType": hire_type})["data"]
            lst = d.get("list") or []
            ids += lst
            if not lst or len(ids) >= d.get("total", 0):
                break
            page += 1
        for it in ids:
            nature = it.get("jobNature") or ""
            b = "intern" if "实习" in nature else default
            if col.room() <= 0:
                return
            if default == "social" and col.count() >= MAX_JOBS:
                return
            try:
                info = h.json(api + "/job/info", {"id": it["id"], "channelDetailIds": [1], "hireType": hire_type})["data"]
            except Exception:
                info = {}
            req = info.get("jobRequire") or ""
            if info.get("addition"):
                req = (req + "\n加分项：\n" + info["addition"]) if req else info["addition"]
            rtype = "/".join(x for x in [info.get("hireTypeName") or ("校园招聘" if hire_type == 1 else "社会招聘"),
                                         it.get("projectName"), nature, it.get("objectName")] if x)
            col.add(b, job(it["id"], it.get("title"), it.get("addressDetailList"), rtype,
                           it.get("competencyType"), "", "",
                           "https://jobs.mihoyo.com/" + path + str(it["id"]),
                           info.get("description") or it.get("jobSummary"), req))


def crawl_g37(h, col):
    base = "https://zhaopin.37.com"
    hdr = {"X-Requested-With": "XMLHttpRequest", "Referer": base + "/index.php?m=Home&c=recruit&a=index"}
    # campus first
    for kind, listurl in (("campus", "/index.php?m=Home&c=campus&a=getIndexPage"),
                          ("social", "/index.php?m=Home&c=society&a=getIndexPage&category=")):
        page = 1
        while col.room() > 0:
            d = h.json(base + listurl + "&key=&post_type=&place_type=&page=%d" % page, headers=hdr)
            data = d.get("data") or {}
            lst = data.get("list") or []
            for it in lst:
                url = it.get("url") or ""
                if url.startswith("/"):
                    url = base + url
                m = re.search(r"id=(\d+)", url) or re.search(r"job/([0-9a-f-]{20,})", url)
                jid = m.group(1) if m else url
                desc, req = split_desc_req(it.get("duty"))
                if kind == "social" and "post_info" in url:
                    try:
                        page_html = h.raw(url, headers={"Referer": base})
                        t = clean(re.sub(r"(?is)<(script|style).*?</\1>", "", page_html))
                        m1 = re.search(r"职位描述[:：](.*?)任职要求[:：](.*?)(投递简历|$)", t, re.S)
                        if m1:
                            desc, req = m1.group(1).strip(), m1.group(2).strip()
                    except Exception:
                        pass
                b = kind
                if kind == "campus" and "实习" in (it.get("name") or ""):
                    b = "intern"
                col.add(b, job(jid, it.get("name"), it.get("work_place"), it.get("cate_name") or kind,
                               it.get("pname"), "", "", url, desc, req))
            if page >= int(data.get("pageCount") or 0) or not lst:
                break
            page += 1


def crawl_seasun(h, col):
    api = "https://ssg-recruiting-api.seasungames.cn/api/ssg_recruiting_cn/v1/api-platform/v1/jobs/xishanju"
    for mode in ("campus", "social"):
        offset = 0
        items = []
        while True:
            d = h.json(api + "?mode=%s&offset=%d&limit=100" % (mode, offset))
            lst = d.get("jobs") or []
            items += lst
            offset += len(lst)
            if not lst or offset >= (d.get("total") or 0):
                break
        for it in items:
            if col.room() <= 0:
                return
            try:
                det = h.json(api + "/" + it["id"])
            except Exception:
                det = {}
            cf = {c.get("name"): c.get("value") for c in (it.get("customFields") or [])}
            commit = it.get("commitment") or ""
            b = "intern" if "实习" in commit else ("campus" if mode == "campus" else "social")
            rtype = "/".join(x for x in [("校园招聘" if mode == "campus" else "社会招聘"), cf.get("项目"), commit] if x)
            page = "campusArticle.html" if mode == "campus" else "jobArticle.html"
            desc, req = split_desc_req(det.get("description") or "")
            cities = [l.get("city") for l in (it.get("locations") or [])]
            col.add(b, job(it["id"], it.get("title"), cities, rtype, (it.get("zhineng") or {}).get("name"),
                           det.get("experience") or "", ymd(det.get("publishedAt") or det.get("openedAt") or det.get("createdAt")),
                           "https://job.seasungames.cn/index/%s#/?jobId=%s&prior=%s" % (page, it["id"], it.get("prior", 1)),
                           desc, req))


def crawl_g4399(h, col):
    base = "https://hr.4399om.com"
    for typ, app, b, page in ((1, 1, "campus", "/campus/graduate/"), (1, 2, "intern", "/campus/internship/"),
                              (2, 1, "social", "/social-job/"), (2, 2, "intern", "/social-job/")):
        try:
            d = h.json(base + "/main/?r=officialSite/jobList&type=%d&applicationType=%d" % (typ, app))
        except Exception:
            continue
        for it in ((d.get("data") or {}).get("list") or []):
            rtype = ("校园招聘" if typ == 1 else "社会招聘") + "/" + (it.get("applicationTypeName") or "")
            col.add(b, job(it.get("jobID"), it.get("jobName"), it.get("workCity"), rtype,
                           it.get("jobTypeName") or it.get("jobTypeID"), "", "",
                           base + page + "?jobType=%s&jobID=%s" % (it.get("jobTypeID"), it.get("jobID")),
                           it.get("jobDesc"), it.get("requirement")))


def crawl_cmb(h, col):
    base = "https://career.cmbchina.com"
    hdr = {"X-B3-BusinessId": "LZ4101CMBRecruitmentPCFront", "Referer": base + "/home"}
    plans = (("campusRecruitmentWebsite", "96574F8D-C7ED-4772-AE7C-BAC896D190C1", "campus", "校园招聘", "school"),
             ("campusRecruitmentWebsite", "DF94FD6D-26D3-4A19-9E69-577C4BA1DE82", "intern", "实习生招聘", "school"),
             ("socialRecruitmentWebsite", "48E013CF-A9DE-4FA4-9CEE-4967B162CAEF", "social", "社会招聘", "social"))
    for api, rtid, b, label, kind in plans:
        page = 1
        items = []
        while True:
            d = h.json(base + "/api/%s/job/getList" % api,
                       {"jobTypeIdList": [], "orgIdList": [], "pageIndex": page, "pageSize": 50,
                        "recruitmentTypeId": rtid}, headers=hdr)
            body = d.get("body") or {}
            lst = body.get("data") or []
            items += lst
            if not lst or len(items) >= (body.get("total") or 0):
                break
            page += 1
        for it in items:
            if col.room() <= 0:
                return
            gid = it.get("publishGID")
            try:
                det = h.json(base + "/api/%s/job/getDetail?publishId=%s" % (api, gid), headers=hdr).get("body") or {}
            except Exception:
                det = {}
            cat = "/".join(x for x in [it.get("jobTypeName"), it.get("branchCodeName")] if x)
            col.add(b, job(gid, it.get("jobDisplay"), it.get("locationName"), label, cat, "", "",
                           base + "/positionDetail/%s?publishId=%s" % (kind, gid),
                           det.get("jobResponsibility"), det.get("jobRequirement")))


def crawl_pingan(h, col):
    base = "https://campus.pingan.com"
    api = base + "/zztj-recruit-talent-webserver/rctt/candidate/position/campus/positionSearch/queryPositionPage"
    hdr = {"Referer": base + "/freshGraduates", "Origin": base}
    # interns first (small list) so they are not crowded out by the 1000+ graduate posts
    for ptype, b, cap in (("2", "intern", MAX_JOBS), ("1", "campus", MAX_JOBS)):
        page = 1
        while col.room() > 0:
            d = h.json(api, {"PageNum": page, "businessUnitId": "", "pageSize": 50, "positionCategoryId": "",
                             "wecruitId": "6c1db1bba8c33deab19a733ec785711a", "positionType": ptype,
                             "wecruitPlatform": True, "workCity": "", "interviewCity": ""}, headers=hdr)
            data = d.get("data") or {}
            lst = data.get("list") or []
            for it in lst:
                if col.room() <= 0:
                    break
                cat = "/".join(x for x in [it.get("businessUnitName"), it.get("positionCategoryName")] if x)
                rtype = "校园招聘/" + (it.get("positionType") or ("实习" if b == "intern" else "全职"))
                col.add(b, job(it.get("idPosition"), it.get("positionName"), it.get("workCity"), rtype, cat, "",
                               ymd(it.get("publishDate")),
                               base + "/positionDetail?positionId=" + str(it.get("idPosition")),
                               it.get("duty"), it.get("qualification")))
            if not lst or page >= int(data.get("totalPage") or 0):
                break
            page += 1


def crawl_citics(h, col):
    api = "https://global-kong.citics.com/api/v1/recruit/"
    hdr = {"Origin": "https://careers.citics.com", "Referer": "https://careers.citics.com/",
           "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"}
    # (route name, params, bucket, resumeType) -- params mirror the official site's paramsData
    plans = (("branch", {"recruitType": "08", "deptype": "Branch"}, "campus", "0"),
             ("interns", {"recruitType": "08", "deptype": "Headquarter", "practice": "1"}, "intern", "1"),
             ("branchInterns", {"recruitType": "08", "deptype": "Branch", "practice": "1"}, "intern", "1"),
             ("socialHeadquarters", {"recruitType": "05", "deptype": "Headquarter"}, "social", "1"),
             ("socialBranch", {"recruitType": "05", "deptype": "Branch"}, "social", "1"))
    for route, params, b, rtype in plans:
        page = 1
        items = []
        while True:
            q = dict(params, sysNo="CSE001", pageSize="100", pageNo=str(page))
            d = h.json(api + "getPositionList", urllib.parse.urlencode(q), headers=hdr)
            lst = d.get("positionList") or []
            items += lst
            if not lst or len(items) >= int(d.get("count") or 0):
                break
            page += 1
        for it in items:
            if col.room() <= 0:
                return
            info = {}
            try:
                q = dict(params, sysNo="CSE001", positionNo=it.get("positionNo"), deptNo=it.get("deptNo"))
                info = h.json(api + "getPositionInfo", urllib.parse.urlencode(q), headers=hdr).get("positionInfo") or {}
            except Exception:
                pass
            url = "https://careers.citics.com/positonDetail?" + urllib.parse.urlencode(
                {"deptNo": it.get("deptNo"), "positionNo": it.get("positionNo"), "pageName": route, "resumeType": rtype})
            col.add(b, job("%s-%s" % (it.get("deptNo"), it.get("positionNo")), it.get("positionName"),
                           it.get("workplace"), info.get("type") or ("校园招聘" if b == "campus" else "实习" if b == "intern" else "社会招聘"),
                           "/".join(dict.fromkeys(x for x in [it.get("companyName"), it.get("deptName")] if x)),
                           "", "", url, info.get("positionDesc") or it.get("positionDesc"), info.get("qualification")))


def crawl_tongcheng(h, col):
    base = "https://mhr.ly.com"
    hdr = {"Referer": base + "/recruit/portal/", "Origin": base}
    for qtype, b, route in ((3, "campus", "schoolDetail"), (5, "intern", "traineeDetail"), (4, "social", "socialDetail")):
        page = 1
        items = []
        while True:
            d = h.json(base + "/recruit-api/external/portal/job-list",
                       {"jobName": "", "jobCategory": [], "workLocation": [], "schoolRecruitUnit": None,
                        "pageNo": page, "pageSize": 50, "queryType": qtype}, headers=hdr)
            data = d.get("data") or {}
            lst = data.get("content") or []
            items += lst
            if not lst or data.get("last") or page >= int(data.get("totalPages") or 0):
                break
            page += 1
        for it in items:
            if col.room() <= 0:
                return
            det = {}
            try:
                det = h.json(base + "/recruit-api/external/portal/job-detail",
                             {"jobId": it["jobId"], "queryType": qtype, "userId": ""}, headers=hdr).get("data") or {}
            except Exception:
                pass
            bb = "intern" if "实习" in (it.get("employmentTypeName") or "") and b != "social" else b
            rtype = "/".join(x for x in [det.get("recruitmentTypeName") or {3: "校园招聘", 4: "社会招聘", 5: "实习生招聘"}[qtype],
                                         det.get("schoolRecruitTypeDesc"), it.get("employmentTypeName")] if x)
            col.add(bb, job(it["jobId"], it.get("jobName"), det.get("addressName") or it.get("workPlace"), rtype,
                            det.get("jobCategoryName") or det.get("categoryName") or "", det.get("workExperience") or "",
                            ymd(it.get("publishTime")),
                            "%s/recruit/portal/#/%s?id=%s&type=%d" % (base, route, it["jobId"], qtype),
                            det.get("duty"), det.get("qualifications")))


def crawl_cainiao(h, col):
    base = "https://talent.cainiao.com"
    h.raw(base + "/social-recruitment", headers={"Accept": "text/html"})  # sets XSRF-TOKEN cookie
    tok = h.cookie("XSRF-TOKEN") or ""
    hdr = {"x-xsrf-token": tok, "Referer": base + "/social-recruitment", "Origin": base}
    plans = [("campus", {"channel": "campus_group_official_site", "batchId": bid, "regions": "", "subCategories": "",
                         "customDeptCode": "", "key": "", "language": "zh"}) for bid in ("4000000249", "4000000250")]
    plans.append(("social", {"channel": "group_official_site", "key": "", "regions": "", "subCategories": "",
                             "categoryType": "social", "language": "zh"}))
    for b, params in plans:
        page = 1
        while col.room() > 0:
            body = dict(params, pageIndex=page, pageSize=50, currentPage=page)
            d = h.json(base + "/position/search?_csrf=" + tok, body, headers=hdr)
            c = d.get("content") or {}
            lst = c.get("datas") or []
            for it in lst:
                url = it.get("positionUrl") or ""
                url = re.sub(r"[&?]track_id=[^&]*", "", url)
                if url.startswith("/"):
                    url = base + url
                bb = b
                if b == "campus" and "实习" in (it.get("name") or "") + str(it.get("batchName") or ""):
                    bb = "intern"
                cats = it.get("categories") or []
                col.add(bb, job(it.get("id"), it.get("name"), it.get("workLocations"),
                                it.get("batchName") or ("社会招聘" if b == "social" else "校园招聘"),
                                ("、".join(cats) if isinstance(cats, list) else cats) or it.get("categoryName") or "",
                                it.get("experience") if isinstance(it.get("experience"), str) else "",
                                ymd(it.get("publishTime")), url, it.get("description"), it.get("requirement")))
            if not lst or page * 50 >= int(c.get("totalCount") or 0):
                break
            page += 1


def crawl_sf(h, col):
    base = "https://campus.sf-express.com"
    hdr = {"Referer": base + "/"}
    for extra, b, route in (("&specialCategory=1", "intern", "traineePositionDetail"), ("", "campus", "postDetail")):
        page = 1
        while col.room() > 0:
            d = h.json(base + "/api/web/position/query?pageSize=50&pageNum=%d%s&time=%d" % (page, extra, int(time.time() * 1000)),
                       headers=hdr)
            lst = d.get("list") or []
            for it in lst:
                bb = "intern" if (b == "intern" or it.get("internTypeName")) else "campus"
                cat = "/".join(x for x in [it.get("orgSourceName"), it.get("positionTypeName")] if x)
                req = it.get("jobRequirement") or ""
                if it.get("otherRequirement"):
                    req += "\n" + it["otherRequirement"]
                col.add(bb, job(it.get("id"), it.get("positionName"), it.get("demandCity"),
                                "校园招聘" + ("/" + it["internTypeName"] if it.get("internTypeName") else ""),
                                cat, "", ymd(it.get("createDate")),
                                "%s/#/%s/%s" % (base, route, it.get("id")), it.get("postDuty"), req))
            if not lst or not d.get("hasNextPage"):
                break
            page += 1


def hotjob(su, plans):
    """Hotjob / wecruit.hotjob.cn. plans: list of (recruitType, bucket, label, postType for detail page)."""
    def run(h, col):
        base = "https://wecruit.hotjob.cn"
        q = "?iSaJAx=isAjax&request_locale=zh_CN&t=%d"
        hdr = {"X-Requested-With": "XMLHttpRequest", "Referer": "%s/%s/pb/index.html" % (base, su)}
        for rt, b, label, ptype in plans:
            page = 1
            items = []
            while True:
                d = h.json(base + "/wecruit/positionInfo/listPosition/" + su + q % int(time.time() * 1000),
                           "isFrompb=true&recruitType=%d&pageSize=15&currentPage=%d" % (rt, page),
                           headers=dict(hdr, **{"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}))
                pf = (d.get("data") or {}).get("pageForm") or {}
                lst = pf.get("pageData") or []
                items += lst
                if not lst or page >= int(pf.get("totalPage") or 0):
                    break
                page += 1
            for it in items:
                if col.room() <= 0:
                    return
                det = {}
                try:
                    det = h.json(base + "/wecruit/positionInfo/listPositionDetail/" + su + q % int(time.time() * 1000)
                                 + "&postId=" + it["postId"], headers=hdr).get("data") or {}
                except Exception:
                    pass
                bb = "intern" if "实习" in (it.get("workTypeStr") or "") and b != "social" else b
                rtype = "/".join(x for x in [label, it.get("projectName"), it.get("workTypeStr")] if x)
                cat = "/".join(x for x in [it.get("postTypeName"), it.get("company")] if x)
                col.add(bb, job(it.get("postId"), it.get("postName"), it.get("workPlaceStr"), rtype, cat,
                                it.get("workYears") or det.get("workYears") or "", ymd(it.get("publishDate")),
                                "%s/%s/pb/posDetail.html?postId=%s&postType=%s" % (base, su, it.get("postId"), ptype),
                                det.get("workContent"), det.get("serviceCondition")))
    return run


# --------------------------------------------------------------------------- registry

COMPANIES = {
    "mihoyo": ("米哈游", "https://jobs.mihoyo.com/", crawl_mihoyo),
    "lilith": ("莉莉丝", "https://lilithgames.jobs.feishu.cn/",
               feishu("lilithgames.jobs.feishu.cn", [("campus", "campus"), ("intern", "intern"), ("career", "social")])),
    "papergames": ("叠纸", "https://career.papegames.com/",
                   feishu("papergames.jobs.feishu.cn", [("campus", "campus"), ("social", "social")])),
    "g37": ("三七互娱", "https://zhaopin.37.com/", crawl_g37),
    "seasun": ("西山居", "https://job.seasungames.cn/", crawl_seasun),
    "g4399": ("4399", "https://hr.4399om.com/", crawl_g4399),
    "qunar": ("去哪儿", "https://zhaopin.qunar.com/",
              feishu("hf7l9aiqzx.jobs.feishu.cn", [("index", "social")])),
    "cmb": ("招商银行", "https://career.cmbchina.com/", crawl_cmb),
    "pingan": ("中国平安", "https://campus.pingan.com/", crawl_pingan),
    "yuewen": ("阅文集团", "https://join.yuewen.com/",
               beisen("yuewen.zhiye.com", None,
                      [(2, "campus", "校园招聘", "campus/detail"),
                       (3, "intern", "实习生招聘", "intern/detail"),
                       (1, "social", "社会招聘", "social/detail")])),
    "sf": ("顺丰", "https://campus.sf-express.com/", crawl_sf),
    "cainiao": ("菜鸟", "https://talent.cainiao.com/", crawl_cainiao),
    "tongcheng": ("同程旅行", "https://mhr.ly.com/recruit/portal/", crawl_tongcheng),
    "htsc": ("华泰证券", "https://job.htsc.com.cn/",
             hotjob("SU6013d14e5d83dc11e4a8ae4d",
                    [(1, "campus", "校园招聘", "campus"), (12, "intern", "实习生招聘", "campus"),
                     (2, "social", "社会招聘", "society")])),
    "citics": ("中信证券", "https://careers.citics.com/", crawl_citics),
    "ximalaya": ("喜马拉雅", "https://jobs.ximalaya.com/",
                 beisen("jobs.ximalaya.com", None,
                        [(2, "campus", "校园招聘", "campus/detail"),
                         (3, "intern", "实习生招聘", "intern/detail"),
                         (1, "social", "社会招聘", "social/detail")])),
    "cicc": ("中金公司", "https://cicc.zhiye.com/",
             beisen("cicc.zhiye.com", "1bb97a43-1bb9-42c2-b5c6-19ddc82c0cb9",
                    [(2, "intern", "暑期实习", "custom/summerxq?jc=2&hideMenu=1"),
                     (3, "intern", "项目实习", "custom/projectxq?jc=3&hideMenu=1"),
                     (1, "social", "社会招聘", "custom/socialxq?jc=1&hideMenu=1")])),
    "xd": ("心动网络", "https://hr.xd.cn/",
           feishu("hr.xd.cn", [("117745", "campus"), ("index", "social")])),
    "hypergryph": ("鹰角网络", "https://career.hypergryph.com/",
                   moka("hypergryph", "https://jobs.hypergryph.com/campus_apply/hypergryph/26326#/job/",
                        "https://jobs.hypergryph.com/apply/hypergryph/26325/#/job/")),
    "perfectworld": ("完美世界", "https://jobs.games.wanmei.com/",
                     moka("pwrd", "https://app.mokahr.com/campus-recruitment/pwrd/172467#/job/",
                          "https://app.mokahr.com/social-recruitment/pwrd/142341#/job/")),
    "youzu": ("游族网络", "https://campus.yoozoo.com/",
              moka("yoozoo", "https://app.mokahr.com/campus_apply/yoozoo/3728#/job/",
                   "https://app.mokahr.com/social-recruitment/yoozoo/91950#/job/")),
    "joyy": ("欢聚集团", "https://hr.joyy.com/",
             moka("hjsd", None, "https://hr.joyy.com/apply/hjsd/48/#/job/")),
    "momo": ("陌陌", "https://campus.immomo.com/",
             moka("immomo", "https://app.mokahr.com/campus-recruitment/immomo/54299#/job/",
                  "https://app.mokahr.com/social-recruitment/immomo/2049#/job/")),
    "zuoyebang": ("作业帮", "https://job.zuoyebang.com/",
                  moka("zuoyebang", "https://app.mokahr.com/campus-recruitment/zuoyebang/39595#/job/",
                       "https://job.zuoyebang.com/social-recruitment/zuoyebang/41328/#/job/")),
}


# Not crawled (see notes):
#   webank 微众银行 - hr.webank.com/apply/webankhr/68 is a Moka site whose job list is only served
#     AES-encrypted ("necromancer" payload); the open api-platform endpoint returns 0 jobs for it.


def run_one(slug):
    name, site, fn = COMPANIES[slug]
    h = Http()
    col = Collector()
    t0 = time.time()
    err = None
    try:
        fn(h, col)
    except Exception as e:
        err = e
        traceback.print_exc()
    jobs = col.jobs()
    if not jobs:
        print("[%s] FAILED / no jobs (%s)" % (slug, err), flush=True)
        return 0
    out = {"slug": slug, "company": name, "site": site,
           "fetched": datetime.date.today().isoformat(), "jobs": jobs}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, slug + ".json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("[%s] %d jobs (campus %d, intern %d, social %d)%s in %.0fs" % (
        slug, len(jobs), len(col.buckets["campus"]), len(col.buckets["intern"]), len(col.buckets["social"]),
        " partial: %s" % err if err else "", time.time() - t0), flush=True)
    return len(jobs)


def main(argv):
    slugs = argv or list(COMPANIES)
    bad = [s for s in slugs if s not in COMPANIES]
    if bad:
        print("unknown slug(s): %s; known: %s" % (", ".join(bad), ", ".join(COMPANIES)))
        slugs = [s for s in slugs if s in COMPANIES]
    total = 0
    for s in slugs:
        try:
            total += run_one(s)
        except Exception:
            traceback.print_exc()
    print("total %d jobs" % total)


if __name__ == "__main__":
    main(sys.argv[1:])
