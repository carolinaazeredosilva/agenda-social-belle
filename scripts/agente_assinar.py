#!/usr/bin/env python3
"""Liga a página do Facebook da Belle ao app da Meta, para os avisos de DMs e comentários chegarem ao agente.

Roda dentro do workflow .github/workflows/agente-instagram.yml. Usa o segredo IG_RESPOSTAS_TOKEN
e nunca grava a chave em arquivo. Também confere se a chave tem as permissões que o agente precisa.
Só usa a biblioteca padrão do Python.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = 'https://graph.facebook.com/' + os.environ.get('IG_API_VERSION', 'v23.0')
TOKEN = os.environ.get('IG_RESPOSTAS_TOKEN', '').strip()
IG_ID = os.environ.get('IG_USER_ID', '').strip()
PRECISA = ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages',
           'pages_show_list', 'pages_manage_metadata']


def chamar(metodo, caminho, token, **params):
    params['access_token'] = token
    dados = urllib.parse.urlencode(params)
    url = API + '/' + caminho
    req = urllib.request.Request(url + ('?' + dados if metodo == 'GET' else ''), method=metodo,
                                 data=dados.encode() if metodo == 'POST' else None)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e).get('error', {})
        except Exception:
            err = {}
        raise SystemExit('A Meta recusou: %s (código %s)' % (err.get('message', 'erro HTTP %s' % e.code), err.get('code', e.code)))


def main():
    if not TOKEN:
        sys.exit('Falta o segredo IG_RESPOSTAS_TOKEN.')
    try:
        perms = {p['permission'] for p in chamar('GET', 'me/permissions', TOKEN).get('data', []) if p.get('status') == 'granted'}
        faltam = [p for p in PRECISA if p not in perms]
        if faltam:
            print('::warning::A chave IG_RESPOSTAS_TOKEN não tem estas permissões: ' + ', '.join(faltam)
                  + '. Gere a chave de novo marcando todas elas.')
    except SystemExit as e:
        print('::warning::Não consegui conferir as permissões da chave: %s' % e)

    pags = chamar('GET', 'me/accounts', TOKEN, fields='id,name,access_token,instagram_business_account{id,username}', limit=100).get('data', [])
    pags = [p for p in pags if p.get('instagram_business_account')]
    if not pags:
        sys.exit('A chave não enxerga nenhuma página do Facebook com Instagram profissional ligado.')
    pag = next((p for p in pags if p['instagram_business_account']['id'] == IG_ID), None) \
        or next((p for p in pags if 'belle' in (p['instagram_business_account'].get('username') or '').lower()), pags[0])
    r = chamar('POST', pag['id'] + '/subscribed_apps', pag['access_token'], subscribed_fields='feed,messages')
    if not r.get('success'):
        sys.exit('A Meta não confirmou a ligação da página: %s' % r)
    print('Página "%s" ligada. Instagram @%s (id %s).' % (pag['name'], pag['instagram_business_account'].get('username'),
                                                          pag['instagram_business_account']['id']))


if __name__ == '__main__':
    main()
