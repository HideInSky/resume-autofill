# 岗位数据（只在商店版 store 分支）

各大厂招聘官网公开的岗位，抓下来随扩展一起打包，扩展本身不联网。

```
jobs/crawlers/gN.py        抓取脚本（python3，只用标准库）。python3 jobs/crawlers/g1.py [slug ...]
jobs/companies/<slug>.json 每家公司一份原始结果
jobs/build.py              把 companies/*.json 统一整理成扩展读的 src/jobs-data/
```

## companies/<slug>.json 格式

```json
{
  "slug": "tencent",
  "company": "腾讯",
  "site": "https://join.qq.com/",
  "fetched": "2026-11-24",
  "jobs": [
    {
      "id": "原站岗位 id",
      "title": "数据分析师",
      "cities": ["深圳", "北京"],
      "recruitType": "校招 / 实习 / 社招，或原站写法（如 campus、intern、2027届）",
      "category": "原站的职位类别（如 技术类-数据）",
      "experience": "原站写的经验要求（没有就空）",
      "posted": "YYYY-MM-DD（没有就空）",
      "url": "能直接打开这个岗位详情 / 投递的网址",
      "description": "岗位职责，纯文本，换行用 \\n",
      "requirement": "任职要求，纯文本"
    }
  ]
}
```

规则：每家最多 400 条，校招和实习优先；description / requirement 各截到 2000 字；请求间隔至少 1 秒；只抓不用登录就能看到的公开岗位，不绕过验证码或签名校验。
