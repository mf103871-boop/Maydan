"""Read public Wikimedia source records; prepare licensed identity replacements.
No account APIs or uploaded application changes. Categories are edited separately.
"""
from pathlib import Path
import urllib.request, urllib.parse, json, time, re, html, io, sys
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')

BASE=Path('docs/bank/quality-2026-10-08/authoring')
CACHE=BASE/'identity-source-cache'
CACHE.mkdir(parents=True,exist_ok=True)
UA='Maydan question-bank editorial review/1.0 (licensed media provenance)'

def get(url):
    for attempt in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=40).read()
        except Exception:
            if attempt==2: raise
            time.sleep(2+attempt)
def api(host,params):
    return json.loads(get('https://'+host+'/w/api.php?'+urllib.parse.urlencode({'format':'json',**params})))
def plain(s):
    return html.unescape(re.sub('<[^>]*>',' ',s or '')).strip()

# Explicit source choices, never fuzzy matching a near-identical country or model.
LEGACY={
'flags':['200-003','200-004','200-021','200-022','200-032','200-033','200-027','400-032','200-014','200-015','200-039','400-005','400-027','200-025','400-019','400-020','400-039','600-014','200-044','400-034','600-029','600-022','400-028','600-034','800-004','800-003','800-011','800-012','800-043','800-042','800-028','800-025','1000-030','1000-027','1000-006','1000-048','800-005','800-006','800-041','800-040'],
'guesscar':['200-001','200-003','200-013','200-015','200-022','200-026','200-035','200-046','400-001','400-004','400-014','400-019','400-027','400-034','400-038','400-044','600-001','600-007','600-016','600-020','600-025','600-027','600-040','600-042','800-002','800-007','800-014','800-020','800-023','800-026','800-037','800-039','1000-001','1000-009','1000-013','1000-022','1000-025','1000-031','1000-036','1000-039'],
'placefinder':['200-024','200-025','200-013','200-002','200-009','200-032','200-026','200-028','200-010','200-001','200-030','200-031','200-027','400-007','200-039','200-007','200-012','400-030','200-011',None,'200-018','200-017','600-020','800-013','400-019','400-018','600-016','600-019',None,None,'400-046','400-039',None,None,None,None,None,None,None,None],
'reveal':[None,None,None,'200-007','200-003',None,'200-048','200-012',None,None,None,'200-015',None,None,None,'200-035',None,None,None,'200-031','200-046','200-001',None,'200-010',None,None,None,None,'200-019',None,'200-026','200-018',None,None,None,None,'200-042',None,None,None]
}
WIKIDATA={
'reveal':{
0:'Adel Emam',1:'Jackie Chan',2:'Mohamed Salah',5:'Nelson Mandela',8:'Omar Sharif',9:'Rowan Atkinson',10:'Riyad Mahrez',12:'Stephen Hawking',13:'Barack Obama',14:'Fairuz',16:'Hend Sabry',17:'Keanu Reeves',18:'Achraf Hakimi',22:'Abdel Halim Hafez',24:'Ahmed Helmy',25:'Cate Blanchett',26:'Ons Jabeur',27:'Serena Williams',29:'Martin Luther King Jr.',32:'Nadine Labaki',33:'Hayao Miyazaki',34:'Mutaz Essa Barshim',35:'Roger Federer',37:'Angela Merkel',38:'Wolfgang Amadeus Mozart',39:'Mark Twain'},
'placefinder':{19:'Brandenburg Gate',28:'Hegra (Mada\'in Salih)',29:'Great Zimbabwe',32:'Kailasa temple, Ellora',33:'Prambanan',34:'Himeji Castle',35:'Leshan Giant Buddha',36:'Nan Madol',37:'Great Mosque of Djenné',38:'Tikal',39:'Aqueduct of Segovia'}
}

mapping=[]
for pack,files in LEGACY.items():
    d=json.loads((BASE/(pack+'-identity-baseline.json')).read_text(encoding='utf-8'))
    sources=json.loads(Path('media/'+pack+'/_sources.json').read_text(encoding='utf-8'))
    lookup={s['file']:s for s in sources}
    for i,q in enumerate(d['qs']):
        record={'pack':pack,'qid':q['qid'],'answer':q['a'],'index':i}
        if files[i]:
            s=lookup[pack+'-'+files[i]+'.webp']
            record.update({'legacy':s,'commonsTitle':urllib.parse.unquote(s['sourceUrl'].split('/wiki/')[-1]).replace('_',' ')})
        else:
            record['wikiTitle']=WIKIDATA[pack][i]
        replacements={'placefinder-200-901':'Eiffel Tower','placefinder-200-903':'Burj Khalifa','placefinder-200-908':'Sydney Opera House','placefinder-800-902':'Alhambra'}
        if q['qid'] in replacements:
            record.pop('legacy',None);record.pop('commonsTitle',None);record['wikiTitle']=replacements[q['qid']]
        if q['qid']=='reveal-200-905':
            record.pop('legacy',None);record['commonsTitle']='File:Albert Einstein Head.jpg'
        mapping.append(record)

titles=[r['wikiTitle'] for r in mapping if 'wikiTitle' in r]
entitypath=CACHE/'entities-v2.json'
if not entitypath.exists():
    ent=api('www.wikidata.org',{'action':'wbgetentities','sites':'enwiki','titles':'|'.join(titles),'props':'claims|sitelinks|labels|descriptions','redirects':'yes'})
    entitypath.write_text(json.dumps(ent,ensure_ascii=False,indent=2),encoding='utf-8')
else: ent=json.loads(entitypath.read_text(encoding='utf-8'))
bytitle={v.get('sitelinks',{}).get('enwiki',{}).get('title'):v for v in ent['entities'].values()}
for r in mapping:
    if 'wikiTitle' not in r: continue
    v=bytitle.get(r['wikiTitle'])
    explicit={'placefinder-1000-901':'Q1268562','reveal-1000-903':'Q1739'}
    if r['qid'] in explicit:
        vp=CACHE/('entity-'+r['qid']+'.json')
        if not vp.exists(): vp.write_text(json.dumps(api('www.wikidata.org',{'action':'wbgetentities','ids':explicit[r['qid']],'props':'claims|labels|descriptions'}),ensure_ascii=False,indent=2),encoding='utf-8')
        v=json.loads(vp.read_text(encoding='utf-8'))['entities'][explicit[r['qid']]]
    if r['qid']=='placefinder-800-905':
        # Exact documented photograph of Hegra; reject the old Norway false match.
        r['commonsTitle']="File:Qasr al-Bint Necropolis, the Lion Tomb (Tomb 37), Proto-Hegra 1 style, Hegra (Mada'in Salih), the kingdom's second Nabatean capital after Petra, Saudi Arabia - 53534958028.jpg"
        continue
    if not v:
        # A bounded exact-name search: descriptions are inspected before accepting.
        p=CACHE/('search-'+r['qid']+'.json')
        if not p.exists(): p.write_text(json.dumps(api('www.wikidata.org',{'action':'wbsearchentities','search':r['wikiTitle'],'language':'en','limit':3}),ensure_ascii=False,indent=2),encoding='utf-8')
        search=json.loads(p.read_text(encoding='utf-8'))
        print('NEEDS ENTITY CHOICE',r['qid'],r['wikiTitle'],[(x['id'],x.get('label'),x.get('description')) for x in search.get('search',[])])
        continue
    p18=v.get('claims',{}).get('P18',[])
    if not p18: print('NO P18',r['qid'],r['wikiTitle'],v['id']);continue
    r.update({'wikidataId':v['id'],'entityDescription':v.get('descriptions',{}).get('en',{}).get('value'),
        'commonsTitle':'File:'+p18[0]['mainsnak']['datavalue']['value']})

(BASE/'identity-source-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if any('commonsTitle' not in r for r in mapping):
    print('SOURCE MAP INCOMPLETE');raise SystemExit(1)

for start in range(0,len(mapping),20):
    p=CACHE/('commons-v2-'+str(start)+'.json')
    if not p.exists():
        result=api('commons.wikimedia.org',{'action':'query','titles':'|'.join(r['commonsTitle'] for r in mapping[start:start+20]),'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1000,'iiurlheight':1280})
        p.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    result=json.loads(p.read_text(encoding='utf-8'))
    pages=list(result.get('query',{}).get('pages',{}).values())
    norm=result.get('query',{}).get('normalized',[])+result.get('query',{}).get('redirects',[])
    titlemap={x['from']:x['to'] for x in norm}
    for r in mapping[start:start+20]:
        t=titlemap.get(r['commonsTitle'],r['commonsTitle'])
        found=next((v for v in pages if v.get('title')==t),None)
        if not found or not found.get('imageinfo'): print('MISSING COMMONS',r['qid'],t);continue
        ii=found['imageinfo'][0];e=ii.get('extmetadata',{})
        r['source']={'title':found['title'],'sourceUrl':ii.get('descriptionurl'),'originalUrl':ii['url'],'thumbUrl':ii.get('thumburl'),
            'author':plain(e.get('Artist',{}).get('value')),'license':plain(e.get('LicenseShortName',{}).get('value')),
            'licenseUrl':e.get('LicenseUrl',{}).get('value'),'description':plain(e.get('ImageDescription',{}).get('value')),
            'restrictions':plain(e.get('Restrictions',{}).get('value')),'width':ii['width'],'height':ii['height']}
        print(r['qid'],r['answer'],'|',r['source']['title'],'|',r['source']['license'],'|',r['source']['description'][:120])
(BASE/'identity-source-map.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
