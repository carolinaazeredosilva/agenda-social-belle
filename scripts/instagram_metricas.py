#!/usr/bin/env python3
"""Busca as métricas do Instagram da Belle na API da Meta e grava em instagram/.

Roda sozinho no GitHub (.github/workflows/instagram.yml), a cada 3 horas.
O token fica no segredo IG_TOKEN do repositório e nunca é gravado em arquivo.

Arquivos gerados (lidos pela aba Métricas do app):
  instagram/metricas.json   resumo atual: conta, períodos de 7 e 30 dias, série diária, stories e posts
  instagram/stories.json    histórico de stories (a Meta só mostra os números de um story por 24h,
                            então cada rodada guarda o último número visto de cada story)
  instagram/seguidores.json seguidores ao fim de cada dia, para acompanhar a evolução

Só usa a biblioteca padrão do Python.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = 'https://graph.facebook.com/' + os.environ.get('IG_API_VERSION', 'v23.0')
TOKEN = os.environ.get('IG_TOKEN', '').strip()
IG_ID = os.environ.get('IG_USER_ID', '').strip()
BRT = timezone(timedelta(hours=-3))  # Brasília, sem horário de verão
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'instagram')
avisos = []


class ApiErro(Exception):
    pass


def get(path, **params):
    params['access_token'] = TOKEN
    url = API + '/' + path.lstrip('/') + '?' + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e).get('error', {})
        except Exception:
            err = {}
        raise ApiErro('%s (código %s)' % (err.get('message', 'erro HTTP %s' % e.code), err.get('code', e.code)))
    except urllib.error.URLError as e:
        raise ApiErro('sem conexão com a Meta: %s' % e.reason)


def ler(nome, padrao):
    try:
        with open(os.path.join(OUT, nome), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return padrao


def gravar(nome, dados):
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, nome + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, os.path.join(OUT, nome))


def achar_conta():
    """Acha o Instagram ligado a uma página do Facebook que o token enxerga."""
    if IG_ID:
        return IG_ID
    pags = get('me/accounts', fields='name,instagram_business_account{id,username}', limit=100).get('data', [])
    contas = [p['instagram_business_account'] for p in pags if p.get('instagram_business_account')]
    if not contas:
        raise ApiErro('o token não enxerga nenhuma página do Facebook com Instagram profissional ligado. '
                      'Confira se o Instagram está conectado à página e se o token tem as permissões pedidas')
    pref = [c for c in contas if 'belle' in (c.get('username') or '').lower()]
    return (pref or contas)[0]['id']


def total(ig, metricas, ini, fim, **extra):
    """Soma do período [ini, fim) em métricas de valor total. Métrica recusada vira aviso, não erro."""
    res = {}
    for m in metricas:
        try:
            d = get(ig + '/insights', metric=m, period='day', metric_type='total_value',
                    since=int(ini.timestamp()), until=int(fim.timestamp()), **extra).get('data', [])
        except ApiErro as e:
            avisos.append('%s: %s' % (m, e))
            continue
        if not d:
            continue
        tv = d[0].get('total_value', {})
        if extra.get('breakdown'):
            res[m] = {b['dimension_values'][0]: b['value']
                      for br in tv.get('breakdowns', []) for b in br.get('results', [])}
        else:
            res[m] = tv.get('value')
    return res


def periodo(ig, ini, fim):
    t = total(ig, ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views',
                   'website_clicks', 'likes', 'comments', 'shares', 'saves'], ini, fim)
    fu = total(ig, ['follows_and_unfollows'], ini, fim, breakdown='follow_type').get('follows_and_unfollows') or {}
    return {
        'inicio': ini.date().isoformat(), 'fim': (fim - timedelta(days=1)).date().isoformat(),
        'alcance': t.get('reach'), 'visualizacoes': t.get('views'),
        'contas_engajadas': t.get('accounts_engaged'), 'interacoes': t.get('total_interactions'),
        'visitas_perfil': t.get('profile_views'), 'cliques_link': t.get('website_clicks'),
        'curtidas': t.get('likes'), 'comentarios': t.get('comments'),
        'compartilhamentos': t.get('shares'), 'salvamentos': t.get('saves'),
        'seguiram': fu.get('FOLLOWER'), 'deixaram_de_seguir': fu.get('NON_FOLLOWER'),
    }


def serie(ig, metrica, ini, fim):
    try:
        d = get(ig + '/insights', metric=metrica, period='day',
                since=int(ini.timestamp()), until=int(fim.timestamp())).get('data', [])
    except ApiErro as e:
        avisos.append('%s (por dia): %s' % (metrica, e))
        return {}
    out = {}
    for v in (d[0].get('values', []) if d else []):
        dia = datetime.fromisoformat(v['end_time'].replace('+0000', '+00:00')).astimezone(BRT) - timedelta(days=1)
        out[dia.date().isoformat()] = v.get('value')
    return out


def insights_midia(mid, metricas, breakdown=None):
    try:
        kw = {'metric': ','.join(metricas)}
        if breakdown:
            kw['breakdown'] = breakdown
        d = get(mid + '/insights', **kw).get('data', [])
    except ApiErro:
        # se uma métrica não vale para esse tipo de mídia, tenta uma a uma
        if len(metricas) == 1:
            return {}
        r = {}
        for m in metricas:
            r.update(insights_midia(mid, [m], breakdown))
        return r
    r = {}
    for x in d:
        if 'total_value' in x and x['total_value'].get('breakdowns'):
            r[x['name']] = {b['dimension_values'][0]: b['value']
                            for br in x['total_value']['breakdowns'] for b in br.get('results', [])}
        elif 'total_value' in x:
            r[x['name']] = x['total_value'].get('value')
        else:
            r[x['name']] = (x.get('values') or [{}])[0].get('value')
    return r


def quando(ts):
    t = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S%z').astimezone(BRT)
    return t.date().isoformat(), t.strftime('%H:%M')


def stories(ig, agora):
    hist = {s['id']: s for s in ler('stories.json', {'stories': []}).get('stories', [])}
    try:
        vivos = get(ig + '/stories', fields='id,media_type,timestamp,permalink', limit=100).get('data', [])
    except ApiErro as e:
        avisos.append('stories: %s' % e)
        vivos = []
    for s in vivos:
        m = insights_midia(s['id'], ['reach', 'views', 'replies', 'shares', 'total_interactions',
                                     'follows', 'profile_visits'])
        nav = insights_midia(s['id'], ['navigation'], 'story_navigation_action_type').get('navigation') or {}
        dia, hora = quando(s['timestamp'])
        hist[s['id']] = {
            'id': s['id'], 'data': dia, 'hora': hora, 'tipo': s.get('media_type'), 'link': s.get('permalink'),
            'alcance': m.get('reach'), 'visualizacoes': m.get('views'), 'respostas': m.get('replies'),
            'compartilhamentos': m.get('shares'), 'interacoes': m.get('total_interactions'),
            'seguiram': m.get('follows'), 'visitas_perfil': m.get('profile_visits'),
            'avancou': nav.get('TAP_FORWARD'), 'voltou': nav.get('TAP_BACK'),
            'saiu': nav.get('TAP_EXIT'), 'proxima_conta': nav.get('SWIPE_FORWARD'),
            'visto_em': agora.isoformat(timespec='minutes'),
        }
    lista = sorted(hist.values(), key=lambda s: (s['data'], s['hora']))
    corte = (agora - timedelta(days=400)).date().isoformat()
    lista = [s for s in lista if s['data'] >= corte]
    gravar('stories.json', {'atualizado': agora.isoformat(timespec='minutes'), 'stories': lista})
    return lista, len(vivos)


def posts(ig, desde):
    out, url_after = [], None
    while True:
        kw = {'fields': 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
              'limit': 50}
        if url_after:
            kw['after'] = url_after
        try:
            r = get(ig + '/media', **kw)
        except ApiErro as e:
            avisos.append('posts: %s' % e)
            break
        pagina = r.get('data', [])
        for p in pagina:
            dia, hora = quando(p['timestamp'])
            if dia < desde:
                return out
            m = insights_midia(p['id'], ['reach', 'views', 'saved', 'shares', 'total_interactions'])
            tipo = 'reel' if p.get('media_product_type') == 'REELS' else (
                'carrossel' if p.get('media_type') == 'CAROUSEL_ALBUM' else 'post')
            out.append({
                'id': p['id'], 'data': dia, 'hora': hora, 'tipo': tipo, 'link': p.get('permalink'),
                'legenda': (p.get('caption') or '').split('\n')[0][:120],
                'curtidas': p.get('like_count'), 'comentarios': p.get('comments_count'),
                'alcance': m.get('reach'), 'visualizacoes': m.get('views'), 'salvamentos': m.get('saved'),
                'compartilhamentos': m.get('shares'), 'interacoes': m.get('total_interactions'),
            })
        url_after = r.get('paging', {}).get('cursors', {}).get('after') if r.get('paging', {}).get('next') else None
        if not url_after or not pagina:
            return out


def main():
    agora = datetime.now(BRT)
    if not TOKEN:
        print('IG_TOKEN não configurado: nada a fazer.')
        return 0
    try:
        ig = achar_conta()
        conta = get(ig, fields='username,name,followers_count,follows_count,media_count,profile_picture_url')
    except ApiErro as e:
        base = ler('metricas.json', {})
        base['erro'] = str(e)
        base['erro_em'] = agora.isoformat(timespec='minutes')
        gravar('metricas.json', base)
        print('Erro:', e)
        return 1

    hoje = agora.replace(hour=0, minute=0, second=0, microsecond=0)
    janelas = {}
    for n in (7, 30):
        fim = hoje  # até ontem, dias fechados
        janelas[str(n)] = periodo(ig, fim - timedelta(days=n), fim)
        janelas[str(n)]['anterior'] = periodo(ig, fim - timedelta(days=2 * n), fim - timedelta(days=n))

    ini30 = hoje - timedelta(days=30)
    alc, vis, seg = serie(ig, 'reach', ini30, hoje), serie(ig, 'views', ini30, hoje), serie(ig, 'follower_count', hoje - timedelta(days=29), hoje)
    diario = [{'data': d, 'alcance': alc.get(d), 'visualizacoes': vis.get(d), 'novos_seguidores': seg.get(d)}
              for d in sorted(set(alc) | set(vis) | set(seg))]

    hs = ler('seguidores.json', {})
    hs[agora.date().isoformat()] = conta.get('followers_count')
    gravar('seguidores.json', dict(sorted(hs.items())))

    st, vivos = stories(ig, agora)
    corte = (hoje - timedelta(days=60)).date().isoformat()
    ps = posts(ig, corte)

    gravar('metricas.json', {
        'generated_at': agora.isoformat(timespec='seconds'),
        'fonte': 'API do Instagram (Meta)',
        'conta': {'id': ig, 'usuario': conta.get('username'), 'nome': conta.get('name'),
                  'seguidores': conta.get('followers_count'), 'seguindo': conta.get('follows_count'),
                  'publicacoes': conta.get('media_count'), 'foto': conta.get('profile_picture_url')},
        'janelas': janelas,
        'diario': diario,
        'stories_no_ar': vivos,
        'stories': [s for s in st if s['data'] >= corte],
        'posts': ps,
        'avisos': avisos[:20],
    })
    print('OK: @%s, %s seguidores, %d posts e %d stories em 60 dias, %d avisos.' % (
        conta.get('username'), conta.get('followers_count'), len(ps), len([s for s in st if s['data'] >= corte]), len(avisos)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
