#!/bin/sh
# atualiza a versão do site antes de publicar
sed -i "s/name=\"belle-ver\" content=\"[0-9]*\"/name=\"belle-ver\" content=\"$(date +%Y%m%d%H%M%S)\"/" "$(dirname "$0")/index.html"
