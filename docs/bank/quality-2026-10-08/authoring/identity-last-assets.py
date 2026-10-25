from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
import urllib.request,urllib.parse,json,html,re,sys,io
sys.stdout.reconfigure(encoding='utf-8')
B=Path('docs/bank/quality-2026-10-08/authoring'); C=Path('.cache/badeeha-quality/identity-source-cache')
headers={'User-Agent':'Maydan editorial review/1.0'}
titles=['File:1999 Mustang GT.jpg','File:Qasr al Farid.JPG']
args={'action':'query','format':'json','titles':'|'.join(titles),'prop':'imageinfo','iiprop':'url|extmetadata|size','iiurlwidth':1280,'iiurlheight':1280}
p=C/'last-direct.json'
if not p.exists():p.write_bytes(urllib.request.urlopen(urllib.request.Request('https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(args),headers=headers),timeout=35).read())
pages=list(json.loads(p.read_text(encoding='utf-8'))['query']['pages'].values())
for kind in ['leaf','eiffel']:pages+=list(json.loads((C/(kind+'-candidates.json')).read_text(encoding='utf-8'))['query']['pages'].values())
rows=[];gallery=Image.new('RGB',(1200,400*((len(pages)+2)//3)),'#fff8ee');draw=ImageDraw.Draw(gallery)
plain=lambda s:html.unescape(re.sub('<[^>]*>',' ',s or '')).strip()
for i,page in enumerate(pages):
 ii=page['imageinfo'][0];e=ii['extmetadata'];p=C/('candidate-'+str(i)+'.jpg')
 if not p.exists():p.write_bytes(urllib.request.urlopen(urllib.request.Request((ii.get('thumburl') or ii['url']).split('?')[0],headers=headers),timeout=35).read())
 im=Image.open(p).convert('RGB');preview=ImageOps.contain(im,(390,340));x=i%3*400+(400-preview.width)//2;y=i//3*400
 gallery.paste(preview,(x,y));draw.text((i%3*400+4,y+344),str(i)+': '+page['title'][:55],fill='black');draw.text((i%3*400+4,y+363),str(im.size),fill='black')
 rows.append({'candidate':i,'local':str(p),'source':{'title':page['title'],'sourceUrl':ii['descriptionurl'],'originalUrl':ii['url'],'thumbUrl':ii.get('thumburl'),'author':plain(e.get('Artist',{}).get('value')),'license':plain(e.get('LicenseShortName',{}).get('value')),'licenseUrl':e.get('LicenseUrl',{}).get('value'),'description':plain(e.get('ImageDescription',{}).get('value')),'restrictions':plain(e.get('Restrictions',{}).get('value')),'width':ii['width'],'height':ii['height']}})
gallery.save('.cache/badeeha-quality/identity-last-candidates.jpg')
(B/'identity-last-candidates.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Downloaded',len(rows),'reference candidates')
