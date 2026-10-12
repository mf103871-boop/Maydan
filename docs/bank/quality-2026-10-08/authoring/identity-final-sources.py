from pathlib import Path
import urllib.request,urllib.parse,json,html,re,io,sys,hashlib
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
B=Path('docs/bank/quality-2026-10-08/authoring');C=Path('.cache/badeeha-quality/identity-source-cache')
rows=json.loads((B/'identity-source-map.json').read_text(encoding='utf-8'))
overrides={'flags-200-902':'Wikimedia Commons contributors; public-domain geometric flag (no author specified)',
 'flags-600-906':'SKopp, Madden and Alkari','guesscar-800-904':'Gnsin'}
for r in rows:
 if r['qid'] in overrides:r['source']['author']=overrides[r['qid']]
fixes={'placefinder-800-906':'File:Conical tower – Great Zimbabwe.jpg','placefinder-800-902':'File:Court of the lions .jpg'}
records=[]
for qid,title in fixes.items():
 r=next(x for x in rows if x['qid']==qid);r['commonsTitle']=title;r.pop('legacy',None);records.append(r)
usb={'qid':'quality-usbc-reference','pack':'zoom','commonsTitle':'File:USB-C.jpg','answer':'USB-C'};records.append(usb)
p=C/'commons-final.json'
if not p.exists():
 args={'action':'query','format':'json','titles':'|'.join(r['commonsTitle'] for r in records),'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1000,'iiurlheight':1280}
 u='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(args)
 p.write_bytes(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Maydan editorial review/1.0'}),timeout=35).read())
d=json.loads(p.read_text(encoding='utf-8'));plain=lambda s:html.unescape(re.sub('<[^>]*>',' ',s or '')).strip()
for r in records:
 page=next(v for v in d['query']['pages'].values() if v['title']==r['commonsTitle'])
 ii=page['imageinfo'][0];e=ii['extmetadata']
 r['source']={'title':page['title'],'sourceUrl':ii['descriptionurl'],'originalUrl':ii['url'],'thumbUrl':ii.get('thumburl'),
  'author':plain(e.get('Artist',{}).get('value')),'license':plain(e.get('LicenseShortName',{}).get('value')),
  'licenseUrl':e.get('LicenseUrl',{}).get('value'),'description':plain(e.get('ImageDescription',{}).get('value')),
  'restrictions':plain(e.get('Restrictions',{}).get('value')),'width':ii['width'],'height':ii['height']}
 print(r['qid'],r['source'])
(B/'identity-source-map.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
tapir=json.loads((B/'blur-tapir-source.json').read_text(encoding='utf-8'));tapir['source']['author']='Bluemoose';tapir['source']['description']='A Malayan Tapir in London Zoo. Photographed by User:Bluemoose in May 2005.'
refs=[next(r for r in rows if r['qid']=='placefinder-200-901'),tapir,usb]
for r in refs:
 s=r['source'];p=C/(r['qid']+'-download')
 if not p.exists():
  u=(s.get('thumbUrl') or s['originalUrl']).split('?')[0]
  p.write_bytes(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Maydan editorial review/1.0'}),timeout=40).read())
 im=Image.open(io.BytesIO(p.read_bytes())).convert('RGB');im.thumbnail((1280,1280),Image.Resampling.LANCZOS)
 file={'placefinder-200-901':'media/blur/quality-eiffel.webp','quality-tapir':'media/blur/quality-tapir.webp','quality-usbc-reference':'media/zoom/quality-usbc-reference.webp'}[r['qid']]
 im.save(file,format='WEBP',quality=86,method=6)
 r['preparedFile']=file;r['bytes']=Path(file).stat().st_size;r['width']=im.width;r['height']=im.height
 r['source']['licenseUrl']=s.get('licenseUrl') or 'https://creativecommons.org/publicdomain/mark/1.0/'
 r['media']={'src':Path(file).name,'type':'image','title':s['title'].replace('File:',''),'sourceUrl':s['sourceUrl'],'author':s['author'],'license':'Public Domain' if s['license'].lower()=='public domain' else s['license'],'licenseUrl':r['source']['licenseUrl'],'changes':'Resized and converted to WebP; photographic content unchanged'}
Path('docs/bank/quality-2026-10-08/blur-reference-sources.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
