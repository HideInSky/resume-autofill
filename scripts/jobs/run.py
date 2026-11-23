"""无人值守地抓一遍所有公司，并整理成要发布的数据。GitHub Actions 每天跑一次，也可以在本机跑。

  python3 scripts/jobs/run.py --prev build/prev --out build/site

- 只抓 sources.json 里 status 为 ok 的公司；pending（等决定）和 skipped（抓不了）的不碰
- 各组脚本并行跑，互不影响；某家失败就沿用上一份数据，并在结果里列出来
- 退出码：0 = 可以发布；1 = 不要发布（这次的岗位总数比上一份少一半以上，或一半以上的公司都失败了）
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CRAWLERS = os.path.join(HERE, 'crawlers')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--prev', default='', help='上一份发布的数据目录')
    ap.add_argument('--out', default='build/site')
    ap.add_argument('--raw', default='build/raw')
    ap.add_argument('--logs', default='build/logs')
    ap.add_argument('--timeout', type=int, default=150 * 60, help='每组最多跑多少秒')
    ap.add_argument('--only', nargs='*', help='只抓这几家（调试用）')
    a = ap.parse_args()

    sources = json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf-8'))
    groups = {}
    for slug, s in sources.items():
        if s.get('status') == 'ok' and (not a.only or slug in a.only):
            groups.setdefault(s['group'], []).append(slug)
    os.makedirs(a.raw, exist_ok=True)
    os.makedirs(a.logs, exist_ok=True)
    started = time.time() - 1
    env = {**os.environ, 'JOBS_RAW_DIR': os.path.abspath(a.raw), 'PYTHONUNBUFFERED': '1'}
    procs = {}
    for g, slugs in sorted(groups.items()):
        log = open(os.path.join(a.logs, g + '.log'), 'w')
        procs[g] = (subprocess.Popen([sys.executable, os.path.join(CRAWLERS, g + '.py'), *slugs], env=env, stdout=log, stderr=subprocess.STDOUT), log)
        print(f'开始 {g}：{len(slugs)} 家', flush=True)
    deadline = time.time() + a.timeout
    for g, (p, log) in procs.items():
        try:
            p.wait(max(1, deadline - time.time()))
        except subprocess.TimeoutExpired:
            p.kill()
            print(f'{g} 超时，已停止（已经写出的公司照样用）', flush=True)
        log.close()
        print(f'结束 {g}：退出码 {p.returncode}', flush=True)

    r = subprocess.run([sys.executable, os.path.join(HERE, 'build.py'), '--raw', a.raw, '--prev', a.prev, '--out', a.out, '--since', str(started)])
    if r.returncode:
        print('整理数据出错，不发布')
        return 1
    rep = json.load(open(os.path.join(a.out, 'report.json'), encoding='utf-8'))
    enabled = len(rep['ok']) + len(rep['failed'])
    lines = [
        f"## 岗位数据 {time.strftime('%Y-%m-%d')}",
        f"- 岗位总数：{rep['total']}（上一份 {rep['prevTotal']}）",
        f"- 这次成功：{len(rep['ok'])} 家",
        f"- 失败：{len(rep['failed'])} 家" + (f"（沿用上一份：{', '.join(rep['kept'])}）" if rep['kept'] else '') + (f"：{', '.join(rep['failed'])}" if rep['failed'] else ''),
        f"- 不抓：" + '、'.join(f"{x['name']}（{x['why']}）" for x in rep['excluded']),
    ]
    problems = []
    if rep['prevTotal'] and rep['total'] < rep['prevTotal'] * 0.5:
        problems.append(f"岗位总数 {rep['total']} 比上一份 {rep['prevTotal']} 少了一半以上")
    if enabled and len(rep['ok']) < enabled * 0.5:
        problems.append(f"只有 {len(rep['ok'])}/{enabled} 家抓成功")
    if not rep['total']:
        problems.append('一个岗位都没有')
    if problems:
        lines.append('\n**不发布：' + '；'.join(problems) + '。保留上一份数据。**')
    text = '\n'.join(lines)
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write(text + '\n')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
