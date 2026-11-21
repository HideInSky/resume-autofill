// 字段定义：资料编辑页、弹窗和填表引擎共用这一份。
// match / not 是对「表单字段描述」（label、placeholder、name、id 等，已转小写）做匹配的正则。
// req: 必填（资料页标 * ，没填标红）。fallback: 没填时用的默认值（资料页标蓝）。hidden: 不在资料页显示。
// only: 'select' 只匹配下拉/单选，only: 'text' 只匹配输入框（同一个标题下有两个控件时用来区分）。
// 想支持新的字段或新的网站叫法，改这里就行。
(() => {
  const f = (key, label, match, extra = {}) => ({ key, label, match, ...extra });
  const YES_NO = ['', '是', '否'];
  // 「学校类型」「公司规模」这类字段不是学校/公司名称本身
  const NOT_ATTR = /类型|类别|性质|行业|规模|网址|官网|\btype\b|industry|\bsize\b|website|\burl\b/;

  globalThis.RESUME_SCHEMA = {
    // 命中这些的字段一律不填（别人的信息、验证码、搜索框等）
    skip: /紧急|emergency|推荐人|内推|referr|referee|父亲|母亲|家庭成员|亲属|relative|配偶|spouse|导师|mentor|supervisor|证明人|证明电话|验证码|captcha|verification code|\botp\b|搜索|search|coupon|promo/,

    // 没有明确归属的通用字段，按「当前所在的经历段落」决定填哪一段
    generic: {
      start: /开始|起始|start|from date|date from/,
      end: /结束|截止|终止|\bend\b|to date|date to/,
      description: /描述|内容|职责|详情|description|responsibilit|details/,
      country: /所在国家|国家|country/,
      province: /省份|province/,
      city: /城市|地点|所在地|city|location/,
      cert: /证书|certificate/,
      score: /成绩|分数|score/,
    },

    // 用字段自身或外层容器的 name/id/class 判断它属于哪一段（按顺序检查）
    sectionHints: {
      education: /educat|school|教育/,
      project: /project|项目/,
      work: /work|employ|intern|工作|实习/,
      language: /language|语言/,
    },

    // 上传文件：按上传框旁边的文字判断该传什么
    files: {
      skip: /证件|身份证|成绩单|transcript|证书|certificate|作品|portfolio|offer|合照/,
      photo: /照片|头像|相片|photo|avatar|headshot|picture/,
      resume: /简历|履历|resume|\bcv\b/,
    },

    // 顺序即优先级：越靠前越先匹配
    sections: [
      {
        id: 'account',
        title: '网申账号',
        hint: '很多招聘网站要先注册账号。把你打算统一使用的用户名和密码写在这里，遇到用户名框、密码框（含确认密码）时自动填入。不想让它填密码，可以在第 4 步里关掉。',
        fields: [
          f('username', '用户名 / 账号', /用户名|账号|帐号|username|user name|login (name|id)|account name/, { req: true }),
          f('password', '密码', null, { type: 'password', req: true }),
        ],
      },
      {
        id: 'education',
        title: '教育经历',
        repeat: true,
        fields: [
          f('start', '入学时间', /入学/, { type: 'month', generic: 'start', req: true }),
          f('end', '毕业时间', /毕业时间|毕业日期|毕业年|预计毕业|graduat/, { type: 'month', generic: 'end', req: true }),
          f('school', '学校', /学校|院校|school|university|college|institution/, { not: NOT_ATTR, anchor: true, req: true }),
          f('degree', '学历 / 学位', /学历|学位|degree|education level/, {
            type: 'select',
            options: ['', '大专', '本科', '硕士', '博士', '其他'],
            not: /时间|日期|date|证书/,
            req: true,
          }),
          f('major', '专业', /专业|major|field of study|discipline|area of study/, { not: /技能|skill|排名|证书|资格/, req: true }),
          f('college', '学院 / 院系', /学院|院系|faculty/, { req: true }),
          f('rank', '成绩排名', /排名|rank/, { placeholder: '如 TOP10%' }),
          f('gpa', 'GPA / 绩点', /gpa|绩点|平均分|平均成绩|学业成绩/),
          f('mode', '学制', /学制|学习形式|培养方式/, { type: 'select', options: ['', '全日制', '非全日制'], fallback: '全日制' }),
          f('cadre', '是否学生干部', /是否.*学生干部|担任.*学生干部/, { type: 'select', options: YES_NO, not: /级别|名称|职务/, fallback: '否' }),
          f('keyLab', '是否国家重点实验室', /重点实验室/, { type: 'select', options: YES_NO, not: /所在|名称/, fallback: '否' }),
          f('country', '学校所在国家', null, { generic: 'country', placeholder: '如 中国 / 美国' }),
          f('province', '学校所在省份 / 州', null, { generic: 'province' }),
          f('city', '学校所在城市', null, { generic: 'city' }),
          f('description', '主修课程 / 在校经历', /主修|课程|coursework|courses/, {
            type: 'textarea',
            generic: 'description',
          }),
        ],
      },
      {
        id: 'intent',
        title: '求职意向',
        fields: [
          f('position', '应聘职位', /应聘|期望职位|期望岗位|意向职位|意向岗位|求职意向|desired (position|role|title)|applying for/),
          f('salary', '期望薪资', /薪资|薪酬|月薪|年薪|salary|compensation/),
          f('relocate', '是否接受工作地变更', /工作地变更|工作地点变更|接受.*(调动|外派)|relocat/, { type: 'select', options: YES_NO, fallback: '是' }),
          f('acceptArea', '可接受工作地', /可接受工作地/, { placeholder: '如 全国各地', fallback: '全国各地' }),
          // 期望城市在资料页里是三层可拖动的卡片（cities）；填表前按「从上到下、从左到右」展开成第一 / 二 / 三意向
          f('cities', '期望城市', null, { type: 'tiers', req: true }),
          f('city2', '第二意向城市', /第二意向|第二志愿.*(城市|地)/, { hidden: true }),
          f('city3', '第三意向城市', /第三意向|第三志愿.*(城市|地)/, { hidden: true }),
          f('city', '第一意向城市', /期望城市|意向城市|期望地点|期望工作地|意向工作地|工作意向地|preferred (city|location)/, { hidden: true }),
          f('available', '最快到岗时间', /到岗|入职时间|可入职|available|earliest start|notice period/),
          f('adjust', '是否服从调剂 / 调配', /服从.*(调配|调剂|分配)|接受调剂/, { type: 'select', options: YES_NO, fallback: '是' }),
        ],
      },
      {
        id: 'work',
        title: '工作 / 实习经历',
        repeat: true,
        fields: [
          f('company', '公司', /公司|单位|雇主|company|employer|organi[sz]ation/, { not: NOT_ATTR, anchor: true, req: true }),
          f('title', '职位', /职位|岗位|职务|job title|\btitle\b|position|\brole\b/, { req: true }),
          f('department', '部门', /部门|department|team/),
          f('start', '开始时间', /入职/, { type: 'month', generic: 'start', req: true }),
          f('end', '结束时间', /离职/, { type: 'month', generic: 'end', req: true }),
          f('city', '工作城市', null, { generic: 'city' }),
          f('description', '工作内容', /工作内容|工作描述|工作职责|实习内容|实习描述|主要业绩/, {
            type: 'textarea',
            generic: 'description',
          }),
        ],
      },
      {
        id: 'project',
        title: '项目经历',
        repeat: true,
        fields: [
          f('name', '项目名称', /项目名|project (name|title)/, { req: true }),
          f('role', '担任角色', /项目角色|担任角色|项目职责|项目职务|your role/),
          f('link', '项目链接', /项目链接|项目地址|project (url|link)/),
          f('start', '开始时间', null, { type: 'month', generic: 'start', req: true }),
          f('end', '结束时间', null, { type: 'month', generic: 'end', req: true }),
          f('description', '项目描述', /项目描述|项目内容|项目简介|项目成果/, {
            type: 'textarea',
            generic: 'description',
          }),
        ],
      },
      {
        id: 'language',
        title: '语言能力（逐项）',
        hint: '网站把语言拆成「语言 / 熟练程度 / 证书 / 成绩」几栏时用这里；只有一个大文本框时用「其他」里的语言能力。',
        repeat: true,
        fields: [
          f('name', '语言', /语言名称|语种|语言类别/, { placeholder: '如 英语' }),
          f('level', '熟练程度', /熟练程度|掌握程度|proficien/, { placeholder: '如 熟练 / 精通' }),
          f('cert', '证书', null, { generic: 'cert', placeholder: '如 英语六级 / 托福 / 雅思' }),
          f('score', '成绩', null, { generic: 'score' }),
        ],
      },
      {
        id: 'basic',
        title: '基本信息',
        // early: 这些叫法很明确，先于「按段落归属的通用字段」判断
        fields: [
          f('nationality', '国籍 / 证件签发地', /国籍|签发国家|nationality|citizenship/, { early: true, placeholder: '如 中国', fallback: '中国' }),
          f('firstName', '名 (First name)', /first name|given name|fname|^名$/, { ai: '「名」的汉语拼音，首字母大写连写，如 Xiaoming' }),
          f('lastName', '姓 (Last name)', /last name|family name|surname|lname|^姓$/, { ai: '「姓」的汉语拼音，首字母大写，如 Zhang' }),
          f('englishName', '英文名 / 拼音', /英文名|拼音|english name|preferred name/, { ai: '简历里有英文名就用；没有就填「名 姓」的拼音，如 Xiaoming Zhang' }),
          f('name', '姓名', /姓名|名字|full name|real name|legal name|your name|^name$|候选人/, {
            not: /学校|公司|项目|用户|账号|user|company|school|project|file|文件/,
            req: true,
          }),
          f('gender', '性别', /性别|gender|\bsex\b/, { type: 'select', options: ['', '男', '女'], req: true }),
          f('birthday', '出生日期', /出生|生日|birth|\bdob\b/, { type: 'date' }),
          f('phoneCode', '手机区号', /手机|电话|phone|mobile|区号|area code|country code/, { only: 'select', placeholder: '如 +86', fallback: '+86' }),
          f('phone', '手机号', /手机|电话|联系方式|phone|mobile|\btel\b|cell/, { only: 'text', req: true }),
          f('email', '邮箱', /邮箱|邮件|e ?mail/, { req: true }),
          f('wechat', '微信', /微信|we ?chat|weixin/),
          f('idType', '证件类型', /证件类型|^证件$|id type|document type/, {
            only: 'select',
            type: 'select',
            options: ['', '身份证', '护照', '港澳居民来往内地通行证', '台湾居民来往大陆通行证'],
            fallback: '身份证',
          }),
          f('idNumber', '证件号码', /身份证|证件号|^证件$|id card|identity (card|number)|national id/, { only: 'text', req: true }),
          f('ethnicity', '民族', /民族/, { placeholder: '如 汉族', fallback: '汉族' }),
          f('political', '政治面貌', /政治面貌|political/, {
            type: 'select',
            options: ['', '中共党员', '中共预备党员', '共青团员', '群众', '其他'],
          }),
          f('hometown', '籍贯 / 户口所在地', /籍贯|户口|户籍|生源地|hometown/, { placeholder: '填省份', req: true }),
          f('zip', '邮编', /邮编|邮政编码|\bzip\b|postal/),
          f('address', '通讯地址', /地址|address/, { not: /邮箱|e ?mail|网址|url|链接|ip/ }),
          f('linkedin', 'LinkedIn', /linked ?in|领英/),
          f('github', 'GitHub', /git ?hub/),
          f('website', '个人主页 / 作品集', /个人主页|个人网站|博客|作品集|website|portfolio|blog|homepage/),
          f('province', '现居省份', /所在省|省份|province/, { generic: 'province' }),
          f('city', '现居城市', /现居|居住|所在城市|现所在地|目前所在地|current (city|location)|城市|\bcity\b|location/, {
            generic: 'city',
            early: /现居|居住|目前所在地|current (city|location)/,
          }),
        ],
      },
      {
        id: 'other',
        title: '其他',
        fields: [
          // pre: 先于「别人的信息一律不填」的规则判断（题目里带「亲属」二字）
          f('relative', '是否有亲属在应聘公司任职', /(亲属|亲戚|亲友|近亲).*(任职|工作|就职)|relatives?.*(work|employ)/, { type: 'select', options: YES_NO, pre: true, fallback: '否' }),
          f('skills', '专业技能', /技能|特长|skills/, { type: 'textarea' }),
          f('languages', '语言能力', /语言能力|外语|英语水平|language/, { type: 'textarea' }),
          f('certificates', '证书', /证书|资格|certificat|license/, { type: 'textarea' }),
          f('awards', '获奖情况', /获奖|奖项|荣誉|奖励|award|honou?r/, { type: 'textarea' }),
          f('selfIntro', '自我评价', /自我评价|自我介绍|个人简介|个人总结|个人评价|about (me|you|yourself)|summary|self (intro|evaluation|description)|cover letter/, {
            type: 'textarea',
          }),
        ],
      },
      {
        id: 'custom',
        title: '自定义字段',
        hint: '上面没有的字段在这里加，下拉框和「是 / 否」单选也可以。「关键词」用逗号分隔，表单字段的名称包含任一关键词就填入对应内容（优先级最高）。例：关键词「学生干部」→ 内容「否」。',
        repeat: true,
        fields: [
          f('keywords', '关键词（逗号分隔）', null),
          f('value', '填入内容', null, { type: 'textarea' }),
        ],
      },
    ],
  };
})();
