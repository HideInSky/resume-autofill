// 岗位数据从哪里下载。按顺序尝试，前一个失败就换下一个（以后可以加国内镜像）。
// 加地址时，manifest.json 里 CSP 的 connect-src 也要加上同一个地址，否则浏览器会拦下。
globalThis.JOB_SOURCES = ['https://raw.githubusercontent.com/HideInSky/resume-autofill/jobs-data/'];
