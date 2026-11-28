// 岗位数据从哪里下载。按顺序尝试，前一个失败就换下一个。
// 第一个是自己的服务器（转发 GitHub 上每天更新的那份，国内访问更稳）；没配服务器时直接用 GitHub。
// 加地址时，manifest.json 里 CSP 的 connect-src 也要加上同一个地址，否则浏览器会拦下。
globalThis.JOB_SOURCES = [
  ...(typeof AI_ENDPOINT === 'string' && AI_ENDPOINT ? [AI_ENDPOINT + '/v1/jobs/'] : []),
  'https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/',
];
