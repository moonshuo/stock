#!/bin/zsh

set -u

project_dir=${0:A:h}
cd "$project_dir" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display alert "无法启动股票分类库" message "请先安装 Node.js 20 或更高版本。" as critical'
  exit 1
fi

if [[ ! -x node_modules/.bin/next ]]; then
  echo "首次启动：正在安装项目依赖…"
  if ! npm install; then
    osascript -e 'display alert "依赖安装失败" message "请在终端中进入项目目录后执行 npm install。" as critical'
    exit 1
  fi
fi

echo "正在启动股票分类库…"
npm run dev &
server_pid=$!

for attempt in {1..60}; do
  if curl --fail --silent --max-time 1 http://localhost:3000/ >/dev/null 2>&1; then
    open http://localhost:3000/
    wait "$server_pid"
    exit $?
  fi

  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "启动失败，请查看上方日志。"
    exit 1
  fi
  sleep 0.5
done

echo "服务未能在 30 秒内启动，请查看上方日志。"
wait "$server_pid"
