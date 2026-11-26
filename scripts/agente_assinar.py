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
    # Os avisos do Instagram (comentários e DMs) chegam pelo objeto "instagram" do app; a página só precisa
    # estar ligada ao app. O campo "messages" da página pede pages_messaging, que a chave pode não ter.
    try:
        r = chamar('POST', pag['id'] + '/subscribed_apps', pag['access_token'], subscribed_fields='feed,messages')
    except SystemExit as e:
        print('::notice::Sem o campo messages da página (%s). Ligando só com feed.' % e)
        r = chamar('POST', pag['id'] + '/subscribed_apps', pag['access_token'], subscribed_fields='feed')
    if not r.get('success'):
        sys.exit('A Meta não confirmou a ligação da página: %s' % r)
    print('Página "%s" ligada. Instagram @%s (id %s).' % (pag['name'], pag['instagram_business_account'].get('username'),
                                                          pag['instagram_business_account']['id']))
    diagnostico(pag)


def diagnostico(pag):
    """Testa se a Meta deixa o app ler as DMs. Só mostra resultados no log, nunca a chave."""
    ig = pag['instagram_business_account']['id']
    testes = [
        ('apps ligados à página', pag['id'] + '/subscribed_apps', pag['access_token'], {}),
        ('DMs pela chave da página', pag['id'] + '/conversations', pag['access_token'],
         {'platform': 'instagram', 'fields': 'updated_time,message_count', 'limit': 3}),
        ('DMs pela chave do usuário do sistema', ig + '/conversations', TOKEN,
         {'platform': 'instagram', 'fields': 'updated_time,message_count', 'limit': 3}),
    ]
    for nome, caminho, tok, params in testes:
        try:
            r = chamar('GET', caminho, tok, **params)
            print('::notice::Diagnóstico (%s): OK %s' % (nome, json.dumps(r.get('data', r), ensure_ascii=False)[:600]))
        except SystemExit as e:
            print('::warning::Diagnóstico (%s): %s' % (nome, e))


if __name__ == '__main__':
    main()
