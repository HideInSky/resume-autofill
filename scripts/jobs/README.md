# 岗位数据（商店版）

各大厂招聘官网公开发布的岗位。每天由 GitHub Actions（`.github/workflows/jobs-data.yml`）抓一次，发布到本仓库的 `jobs-data` 分支（只保留最新一份，不进 main / store 的历史）。扩展在用户打开「在线更新岗位」后从这里下载：

```
https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/index.json
https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/c/<slug>.json
```

## 文件

```
scripts/jobs/run.py          抓一遍 + 整理；判断这次能不能发布（退出码 0 = 可以）
scripts/jobs/build.py        原始数据 → index.json + c/<slug>.json；某家失败时沿用上一份
scripts/jobs/sources.json    每家公司：名字、所在脚本、数据来源、是否抓取（ok / pending / skipped）
scripts/jobs/crawlers/gN.py  各组抓取脚本（只用 Python 标准库）
```

本机试跑（数据写到 build/，不进仓库）：

```bash
python3 scripts/jobs/run.py --prev build/site --out build/site-new
python3 scripts/jobs/run.py --only tencent xiaomi   # 只抓几家（这时大部分公司算失败，会显示不发布，正常）
```

## 规则

- 只抓不用登录就能看到的公开岗位；不绕过验证码、签名、人机验证，不解密加密接口
- 同一个网站的请求间隔至少 1 秒；每家最多 400 条，校招、实习优先
- 详情只留展示需要的内容：职责、要求各最多 1000 字，每个岗位都带回到官网原页面的链接
- robots.txt 不允许的来源标为 pending，等维护者决定，自动任务不抓也不发布

## 数据格式

`index.json`：`{ fetched, generated, companies: [{slug, name, site, count, fetched, stale?}], jobs: [[slug, id, 职位, 城市(用 | 分隔), 类型, 经验, 类别, 发布日期], ...] }`
`c/<slug>.json`：`{ "<id>": { "u": 官网链接, "d": 职责, "r": 要求 } }`

## 每家公司的数据从哪来

| 公司 | slug | 脚本 | 来源 | 状态 |
| --- | --- | --- | --- | --- |
| 腾讯 | `tencent` | g1 | join.qq.com 自有接口（列表 + 详情） | 抓取 |
| 阿里巴巴 | `alibaba` | g1 | campus-talent.alibaba.com 自有接口（正常打开页面得到的 csrf cookie） | 抓取 |
| 蚂蚁集团 | `antgroup` | g1 | hrcareersweb.antgroup.com | 不抓：需要页面生成的 ctoken 和人机验证，不抓 |
| 字节跳动 | `bytedance` | g1 | jobs.bytedance.com（飞书招聘，正常打开页面得到的 csrf cookie） | 抓取 |
| 美团 | `meituan` | g1 | zhaopin.meituan.com 自有接口 | 抓取 |
| 京东 | `jd` | g1 | campus.jd.com 自有接口 | 抓取 |
| 百度 | `baidu` | g1 | talent.baidu.com 自有接口 | 抓取 |
| 快手 | `kuaishou` | g1 | campus.kuaishou.cn 自有接口 | **等你决定**：robots.txt 写了 Disallow: /，等你决定 |
| 拼多多 | `pdd` | g1 | careers.pddglobalhr.com 自有接口（只抓校招；社招要签名 token，不抓） | 抓取 |
| 网易 | `netease` | g1 | campus.163.com、campus.game.163.com、hr.163.com 自有接口 | 抓取 |
| 小红书 | `xiaohongshu` | g1 | job.xiaohongshu.com 自有接口 | 抓取 |
| 哔哩哔哩 | `bilibili` | g1 | jobs.bilibili.com 自有接口（页面公开的 AppKey 请求头 + csrf cookie） | 抓取 |
| 滴滴 | `didi` | g1 | talent.didiglobal.com 自有接口（只有社招；校招在 Moka 加密接口上） | 抓取 |
| 携程 | `ctrip` | g1 | careers.ctrip.com | 不抓：接口会把程序访问引到 verify.ctrip.com 人机验证，不抓 |
| 微博 | `weibo` | g1 | career.sina.com.cn（Moka） | 不抓：Moka 列表接口返回加密数据，不解密 |
| 知乎 | `zhihu` | g1 | Moka | 不抓：Moka 列表接口返回加密数据，不解密 |
| 得物 | `dewu` | g1 | campus.dewu.com + poizon.jobs.feishu.cn（飞书招聘） | 抓取 |
| 贝壳 | `ke` | g1 | campus.ke.com 自有接口 | 抓取 |
| 爱奇艺 | `iqiyi` | g1 | careers.iqiyi.com（飞书招聘） | 抓取 |
| 腾讯音乐 | `tme` | g1 | join.tencentmusic.com 自有接口 | 抓取 |
| 唯品会 | `vipshop` | g1 | campus.vip.com（Moka） | 不抓：Moka 列表接口返回加密数据，不解密 |
| SHEIN | `shein` | g1 | careers.shein.cn 自有接口 | 抓取 |
| Shopee | `shopee` | g1 | ats.workatsea.com（Sea 招聘系统，careers.shopee.cn 用的就是它） | 抓取 |
| 58同城 | `wuba` | g1 | campus.58.com（Moka） | 不抓：Moka 列表接口返回加密数据，不解密 |
| 金山办公 | `kingsoft` | g1 | join.wps.cn（Moka） | 不抓：Moka 列表接口返回加密数据，不解密 |
| 华为 | `huawei` | g2 | career.huawei.com 自有接口 | 抓取 |
| 荣耀 | `honor` | g2 | career.honor.com（Hotjob） | 抓取 |
| 小米 | `xiaomi` | g2 | xiaomi.jobs.f.mioffice.cn（飞书招聘） | 抓取 |
| OPPO | `oppo` | g2 | careers.oppo.com 自有接口 | 抓取 |
| vivo | `vivo` | g2 | hr-campus.vivo.com（北森）+ hr.vivo.com 自有接口 | 抓取 |
| 联想 | `lenovo` | g2 | talent.lenovo.com.cn / jobs.lenovo.com | 不抓：校招项目都已关闭；社招站拒绝程序连接 |
| 中兴 | `zte` | g2 | Moka 公开接口 api.mokahr.com/api-platform | 抓取 |
| 大疆 | `dji` | g2 | Moka 公开接口（apply.careers.dji.com） | 抓取 |
| 蔚来 | `nio` | g2 | nio.jobs.feishu.cn（飞书招聘） | 抓取 |
| 小鹏汽车 | `xpeng` | g2 | 飞书招聘 | 抓取 |
| 理想汽车 | `lixiang` | g2 | lixiang.com 自有接口 + 飞书招聘 | 抓取 |
| 比亚迪 | `byd` | g2 | job.byd.com 自有接口（岗位链接按官网页面的规则生成） | 抓取 |
| 吉利 | `geely` | g2 | Moka 公开接口（campus.geely.com） | 抓取 |
| 长城汽车 | `greatwall` | g2 | zhaopin.gwm.cn（Hotjob） | 抓取 |
| 零跑汽车 | `leapmotor` | g2 | leapmotor.zhiye.com（北森） | 抓取 |
| 宁德时代 | `catl` | g2 | Moka 公开接口（只有社招有可用链接） | 抓取 |
| 京东方 | `boe` | g2 | boe.zhiye.com（北森） | 抓取 |
| 海康威视 | `hikvision` | g2 | campushr.hikvision.com 自有接口 | 抓取 |
| 大华 | `dahua` | g2 | dahua.zhiye.com（北森） | 抓取 |
| 美的 | `midea` | g2 | careers.midea.com 自有接口 | 抓取 |
| 海尔 | `haier` | g2 | maker.haier.net 列表接口 + 详情页 | 抓取 |
| 格力 | `gree` | g2 | — | 不抓：没有公开的网页岗位列表（走微信公众号） |
| TCL | `tcl` | g2 | Hotjob | 抓取 |
| 安克创新 | `anker` | g2 | anker-in.jobs.feishu.cn（飞书招聘） | 抓取 |
| 传音 | `transsion` | g2 | transsion.zhiye.com（北森） | 抓取 |
| 科大讯飞 | `iflytek` | g3 | iflytek.zhiye.com（北森） | 抓取 |
| 商汤 | `sensetime` | g3 | sensetime.jobs.feishu.cn（飞书招聘） | 抓取 |
| 旷视 | `megvii` | g3 | Moka 公开接口 | 抓取 |
| 地平线 | `horizon` | g3 | wecruit.hotjob.cn（Hotjob） | 抓取 |
| 卓驭科技 | `zhuoyu` | g3 | we.zyt.com（北森） | 抓取 |
| 文远知行 | `weride` | g3 | Moka 公开接口 + Lever | 抓取 |
| 小马智行 | `pony` | g3 | ponyai.jobs.feishu.cn（飞书招聘） | 抓取 |
| Momenta | `momenta` | g3 | 飞书招聘 | 抓取 |
| 智元机器人 | `agibot` | g3 | agirobot.jobs.feishu.cn（飞书招聘） | 抓取 |
| 宇树科技 | `unitree` | g3 | api.unitree.com | 不抓：接口返回防机器人验证页，不抓 |
| 寒武纪 | `cambricon` | g3 | Moka 公开接口 | 抓取 |
| 海光信息 | `hygon` | g3 | Moka 公开接口 | 抓取 |
| 紫光展锐 | `unisoc` | g3 | wecruit.hotjob.cn（Hotjob） | 抓取 |
| 兆易创新 | `gigadevice` | g3 | Moka 公开接口 | 抓取 |
| 中芯国际 | `smic` | g3 | smics.zhiye.com（北森旧版页面） | 抓取 |
| 豪威 | `omnivision` | g3 | ovt-omnivision.zhiye.com（北森） | 抓取 |
| 月之暗面 | `moonshot` | g3 | Moka 公开接口 | 抓取 |
| 智谱 | `zhipu` | g3 | Moka 公开接口 | 抓取 |
| MiniMax | `minimax` | g3 | 飞书招聘 | 抓取 |
| 百川智能 | `baichuan` | g3 | 飞书招聘 | 抓取 |
| 阶跃星辰 | `stepfun` | g3 | Moka 公开接口 | 抓取 |
| 第四范式 | `4paradigm` | g3 | Moka 公开接口 | 抓取 |
| 深信服 | `sangfor` | g3 | hr.sangfor.com 自有接口（页面加载时取的匿名 token） | 抓取 |
| 奇安信 | `qianxin` | g3 | Moka 公开接口（只有校招） | 抓取 |
| 用友 | `yonyou` | g3 | career.yonyou.com（Hotjob） | 抓取 |
| 米哈游 | `mihoyo` | g4 | ats.openout.mihoyo.com 自有接口 | 抓取 |
| 莉莉丝 | `lilith` | g4 | lilithgames.jobs.feishu.cn（飞书招聘） | 抓取 |
| 叠纸 | `papergames` | g4 | papergames.jobs.feishu.cn（飞书招聘） | 抓取 |
| 鹰角网络 | `hypergryph` | g4 | Moka 公开接口 | 抓取 |
| 完美世界 | `perfectworld` | g4 | Moka 公开接口 | 抓取 |
| 三七互娱 | `g37` | g4 | zhaopin.37.com 自有页面 | 抓取 |
| 心动网络 | `xd` | g4 | hr.xd.cn（飞书招聘） | 抓取 |
| 西山居 | `seasun` | g4 | job.seasungames.cn（Moka 公开接口的官方代理） | 抓取 |
| 游族网络 | `youzu` | g4 | Moka 公开接口 | 抓取 |
| 4399 | `g4399` | g4 | hr.4399om.com 的 officialSite 接口 | **等你决定**：robots.txt 只允许 /campus/ 页面，接口路径不在允许范围，等你决定 |
| 招商银行 | `cmb` | g4 | career.cmbchina.com 自有接口 | 抓取 |
| 中国平安 | `pingan` | g4 | campus.pingan.com 自有接口（只有校招） | 抓取 |
| 微众银行 | `webank` | g4 | hr.webank.com（Moka） | 不抓：列表只返回加密数据，不解密 |
| 中金公司 | `cicc` | g4 | cicc.zhiye.com（北森） | 抓取 |
| 中信证券 | `citics` | g4 | careers.citics.com 自有接口 | 抓取 |
| 华泰证券 | `htsc` | g4 | wecruit.hotjob.cn（Hotjob） | 抓取 |
| 顺丰 | `sf` | g4 | campus.sf-express.com 自有接口（只有校招） | 抓取 |
| 阅文集团 | `yuewen` | g4 | yuewen.zhiye.com（北森） | 抓取 |
| 去哪儿 | `qunar` | g4 | 飞书招聘（只有社招） | 抓取 |
| 同程旅行 | `tongcheng` | g4 | mhr.ly.com 自有接口 | 抓取 |
| 菜鸟 | `cainiao` | g4 | talent.cainiao.com 自有接口（正常打开页面得到的 csrf cookie） | 抓取 |
| 喜马拉雅 | `ximalaya` | g4 | jobs.ximalaya.com（北森） | 抓取 |
| 陌陌 | `momo` | g4 | Moka 公开接口 | 抓取 |
| 欢聚集团 | `joyy` | g4 | Moka 公开接口 | 抓取 |
| 作业帮 | `zuoyebang` | g4 | Moka 公开接口 | 抓取 |
| 好未来 | `tal` | g5 | job.tal.com / job-api.100tal.com 自有接口（只有校招、实习） | 抓取 |
| 猿辅导 | `yuanfudao` | g5 | Moka 公开接口（fenbi） | 抓取 |
| 新东方 | `xdf` | g5 | xdf.zhiye.com（北森） | 抓取 |
| 金蝶 | `kingdee` | g5 | Moka 公开接口（只有校招） | 抓取 |
| 汇川技术 | `inovance` | g5 | recruit.inovance.com 自有接口（页面代码里的固定 X-Portal-Id 请求头） | 抓取 |
| 阳光电源 | `sungrow` | g5 | Moka 公开接口 | 抓取 |
| 隆基绿能 | `longi` | g5 | longi.hotjob.cn（Hotjob） | 抓取 |
| 极氪 | `zeekr` | g5 | Moka 公开接口（吉利账号下按部门筛出极氪，可能有误差） | 抓取 |
| 赛力斯 | `seres` | g5 | sokon.zhiye.com（北森） | 抓取 |
| 石头科技 | `roborock` | g5 | roborock.zhiye.com（北森） | 抓取 |
| 科沃斯 | `ecovacs` | g5 | hr.ecovacs.cn（Moka） | 不抓：官网只链接到一个 2023 年暂停的岗位 |
| 追觅科技 | `dreame` | g5 | dreame.zhiye.com（北森） | 抓取 |
| 影石 | `insta360` | g5 | arashivision.jobs.feishu.cn（飞书招聘） | 抓取 |
| 拓竹科技 | `bambulab` | g5 | bambulab.jobs.feishu.cn（飞书招聘） | 抓取 |
| 极兔速递 | `jtexpress` | g5 | jtexpress.jobs.feishu.cn（飞书招聘） | 抓取 |
| 满帮 | `fulltruck` | g5 | Moka 公开接口（manbang） | 抓取 |
| 货拉拉 | `lalamove` | g5 | Moka 公开接口 + join.huolala.cn（北森） | 抓取 |
| 迈瑞医疗 | `mindray` | g5 | mindray.zhiye.com（北森） | 抓取 |
| 联影医疗 | `unitedimaging` | g5 | united-imaging.zhiye.com（北森） | 抓取 |
| 药明康德 | `wuxiapptec` | g5 | wuxiapptec.zhiye.com（北森） | 抓取 |
