import json,hashlib,sys
from pathlib import Path
r=Path.cwd(); p=r/'docs/bank/rebuild-2026-09-18/review-blur-generated.json'
v=json.loads(p.read_text()) if p.exists() else {'category':'blur','reviewedAt':'2026-09-23','status':'in-progress','expectedCount':40,'difficultyCalibration':'editorial-not-measured','method':'Every sharp built-in generated image is viewed individually. Installed assets receive paired static previews at320x240 mobile and491x368 desktop sizes, Gaussian sigma16 for200/400 and14.4 for600+, saturation1.3. This approximates the current CSS filter and is not browser QA: Chromium was unavailable and its download failed. No measured audience success rates.','items':[]}
notes=json.loads(sys.stdin.read())
for qid,note in notes.items():
 job=json.loads((r/'docs/bank/rebuild-2026-09-18/checkpoint/blur-resume/jobs'/f'{qid}.json').read_text()); recpath=r/f'docs/bank/rebuild-2026-09-18/generated-records/{qid}.json';rec=json.loads(recpath.read_text())
 review={'status':'passed','reviewedAt':'2026-09-23','fullImage':note,'blurredGameplay':'Visually checked both static mobile/desktop approximations; identifying overall shape remains visible, fine details are hidden.','previewMode':'static-approximation-not-browser','sigma':14.4 if job['p']>=600 else 16,'saturation':1.3}
 rec['review']=review;recpath.write_text(json.dumps(rec,ensure_ascii=False,indent=2)+'\n')
 q=job['question'];q['verified']=True;q['media']['provenance']['createdAt']=rec['createdAt'];(r/'docs/bank/rebuild-2026-09-18/checkpoint/blur-resume/jobs'/f'{qid}.json').write_text(json.dumps(job,ensure_ascii=False,indent=2)+'\n')
 item={'qid':qid,'answer':q['a'],'tier':q['p'],'topic':q['topic'],'image':rec['file'],'generationRecord':f'docs/bank/rebuild-2026-09-18/generated-records/{qid}.json','sha256':rec['sha256'],'width':rec['width'],'height':rec['height'],'bytes':rec['bytes'],'review':review}
 v['items']=[x for x in v['items'] if x['qid']!=qid]+[item]
v['items'].sort(key=lambda x:(x['tier'],x['qid']));v['completedCount']=len(v['items']);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');print('Reviewed',v['completedCount'])
