#!/bin/sh
# 打包成上传 Chrome 应用商店用的 zip：只含扩展运行需要的文件，不含测试页和文档。
# 用法：sh scripts/pack.sh
set -e
cd "$(dirname "$0")/.."
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="resume-autofill-$version.zip"
rm -f "$out"
zip -q -r "$out" manifest.json LICENSE icons/*.png icons/icon.svg src -x 'src/_preview_*' -x '*.DS_Store'
echo "$out"
