from pathlib import Path
import urllib.request,urllib.parse,json,html,re,sys
sys.stdout.reconfigure(encoding='utf-8')
B=Path('docs/bank/quality-2026-10-08/authoring');C=Path('.cache/badeeha-quality/identity-source-cache')
srcs=json.loads(Path('media/reveal/_sources.json').read_text(encoding='utf-8'))
maprows=json.loads((B/'identity-source-map.json').read_text(encoding='utf-8'))
changes={'reveal-1000-904':'سيرغي بوبكا','reveal-1000-905':'ريتشارد فاينمان','reveal-1000-906':'روزا باركس'}
rows=[]
for qid,a in changes.items():
    r=next(x for x in maprows if x['qid']==qid)
    old=next(x for x in srcs if x['query']==a)
    r.update(answer=a,legacy=old,commonsTitle=urllib.parse.unquote(old['sourceUrl'].split('/wiki/')[-1]).replace('_',' '))
    r.pop('wikiTitle',None);r.pop('wikidataId',None);r.pop('entityDescription',None)
    rows.append(r)
tapir={'pack':'blur','qid':'quality-tapir','answer':'تابير','commonsTitle':'File:Malayan Tapir.JPG'}
rows.append(tapir)
p=C/'commons-supplement.json'
if not p.exists():
    args={'action':'query','format':'json','titles':'|'.join(r['commonsTitle'] for r in rows),'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1000,'iiurlheight':1280}
    u='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(args)
    p.write_bytes(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Maydan editorial review/1.0'}),timeout=35).read())
d=json.loads(p.read_text(encoding='utf-8'));plain=lambda s:html.unescape(re.sub('<[^>]*>',' ',s or '')).strip()
for r in rows:
    page=next(v for v in d['query']['pages'].values() if v['title']==r['commonsTitle'])
    ii=page['imageinfo'][0];e=ii['extmetadata']
    r['source']={'title':page['title'],'sourceUrl':ii['descriptionurl'],'originalUrl':ii['url'],'thumbUrl':ii.get('thumburl'),
      'author':plain(e.get('Artist',{}).get('value')),'license':plain(e.get('LicenseShortName',{}).get('value')),
      'licenseUrl':e.get('LicenseUrl',{}).get('value'),'description':plain(e.get('ImageDescription',{}).get('value')),
      'restrictions':plain(e.get('Restrictions',{}).get('value')),'width':ii['width'],'height':ii['height']}
    print(r['qid'],r['answer'],r['source'])
(B/'identity-source-map.json').write_text(json.dumps(maprows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(B/'blur-tapir-source.json').write_text(json.dumps(tapir,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
