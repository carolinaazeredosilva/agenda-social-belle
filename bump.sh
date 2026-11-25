#!/bin/sh
# atualiza a versão do site antes de publicar (e a dos scripts, para o navegador não usar cópia antiga)
V=$(date +%Y%m%d%H%M%S); F="$(dirname "$0")/index.html"
sed -i "s/name=\"belle-ver\" content=\"[0-9]*\"/name=\"belle-ver\" content=\"$V\"/" "$F"
sed -i -E "s/(src=\"(config|shim|respostas)\.js)\?v=[0-9]*\"/\1?v=$V\"/g" "$F"
