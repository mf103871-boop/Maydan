from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request,json,time,io,sys,hashlib
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
BASE=Path('docs/bank/quality-2026-10-08/authoring')
CACHE=BASE/'identity-source-cache'
records=json.loads((BASE/'identity-source-map.json').read_text(encoding='utf-8'))
UA='Maydan question-bank editorial review/1.0 (licensed media provenance)'
def prepare(r):
    assert r.get('source'),r['qid']
    s=r['source'];license=s['license'].lower()
    assert license.startswith(('cc by','cc0','public domain')),s
    assert 'nc' not in license and 'nd' not in license,s
    if r.get('legacy'):
        b=Path('media/'+r['pack']+'/'+r['legacy']['file']).read_bytes()
    else:
        p=CACHE/(r['qid']+'-download')
        if not p.exists():
            u=(s.get('thumbUrl') or s['originalUrl']).split('?')[0]
            for attempt in range(3):
                try:
                    b=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':UA}),timeout=45).read();p.write_bytes(b);break
                except Exception:
                    if attempt==2: raise
                    time.sleep(3+attempt*3)
        im=Image.open(io.BytesIO(p.read_bytes())).convert('RGB')
        im.thumbnail((1280,1280),Image.Resampling.LANCZOS)
        quality=86
        while True:
            out=io.BytesIO();im.save(out,format='WEBP',quality=quality,method=6);b=out.getvalue()
            if len(b)<=256*1024:break
            quality-=5
            if quality<66:
                im.thumbnail((int(im.width*.85),int(im.height*.85)),Image.Resampling.LANCZOS)
                quality=82
    im=Image.open(io.BytesIO(b))
    assert len(b)<=256*1024 and max(im.size)<=1280,(r['qid'],len(b),im.size)
    dest=Path('media')/r['pack']/(r['qid']+'.webp')
    dest.write_bytes(b)
    return {'qid':r['qid'],'file':dest.as_posix(),'bytes':len(b),'width':im.width,'height':im.height,'sha256':hashlib.sha256(b).hexdigest(),'reusedLegacy':bool(r.get('legacy'))}
with ThreadPoolExecutor(max_workers=3) as executor:
    rows=list(executor.map(prepare,records))
(BASE/'identity-assets-prepared.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Prepared',len(rows),'licensed images; reused',sum(x['reusedLegacy'] for x in rows),'legacy assets')
