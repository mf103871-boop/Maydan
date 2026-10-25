from pathlib import Path
from PIL import Image
import json,hashlib,shutil,sys
sys.stdout.reconfigure(encoding='utf-8')
B=Path('docs/bank/quality-2026-10-08'); cache=Path('.cache/badeeha-quality/identity-uncropped');cache.mkdir(parents=True,exist_ok=True)
crops={
 'reveal-400-903':[.17,.035,.66,.47], 'reveal-400-904':[.12,.025,.61,.43],
 'reveal-400-905':[0,0,.67,.55], 'reveal-400-906':[.18,0,.81,.51],
 'reveal-400-907':[.29,.02,.67,.41], 'reveal-400-908':[.42,.015,1,.56],
 'reveal-600-901':[.29,.39,.70,.84], 'reveal-600-903':[.30,.035,.72,.50],
 'reveal-600-905':[.18,0,.79,.60], 'reveal-800-901':[.18,.015,.75,.52],
 'reveal-800-903':[.30,.005,.80,.52], 'reveal-800-907':[.22,0,.85,.60],
 'reveal-1000-902':[.18,0,.90,.55], 'reveal-1000-903':[.20,.045,.80,.54],
 'reveal-1000-905':[.16,.06,.60,.48], 'reveal-1000-907':[.13,.03,.85,.64],
 'reveal-1000-908':[.12,.10,.79,.68], 'guesscar-1000-906':[0,0,1,.86]
}
retier={'reveal-200-904':600,'reveal-600-904':200,'reveal-200-907':600,'reveal-600-907':200}
retierReasons={
 'reveal-200-904':'لقطة بيليه التاريخية شابًا أصعب من صورة مايكل جوردان الحالية؛ تبادل الاثنان 200 و600 داخل الرياضة العالمية مع الحفاظ على الأعداد.',
 'reveal-600-904':'وجه مايكل جوردان الحديث واسع الشهرة وأقرب إلى 200 من بيليه في اللقطة التاريخية؛ جرى تبادل منضبط داخل الرياضة العالمية.',
 'reveal-200-907':'صورة أم كلثوم الشابة من الفيلم أصعب من ملامحها الأيقونية المتأخرة؛ رُفعت إلى600 بدل افتراض أن كل صورة لها سهلة.',
 'reveal-600-907':'صورة عبد الحليم حافظ واضحة وواسعة التعرّف، فأصبح في200 مقابل أم كلثوم الشابة في600 داخل الموسيقى والغناء.'
}
report=json.loads((B/'review-identity-images.json').read_text(encoding='utf-8'))
for pack in ['flags','reveal','guesscar','placefinder']:
 p=Path('src/data/categories')/(pack+'.json'); data=json.loads(p.read_text(encoding='utf-8'))
 for i,q in enumerate(data['qs']):
  row=next(r for r in report if r['qid']==q['qid'])
  if q['qid'] in retier:
   q['p']=retier[q['qid']];q['difficultyTarget']={200:.8,400:.6,600:.4,800:.25,1000:.15}[q['p']]
   row['newTier']=q['p'];row['decision']='retier';row['reason']+=' '+retierReasons[q['qid']]
  if pack=='flags' and q['p']>=800:
   topic=q['topic']
   region='أفريقيا' if 'أفريقيا' in topic else topic
   q['q']=f'ما الدولة من {region} صاحبة هذا العلم؟'
   row['reason']+=f' أضيف نطاق {region} واسع ليجعل العلم الأقل شيوعًا تحديًا عادلًا دون وصف اللون أو الشكل.'
   row['evidence']['additionalPrimarySources']=['https://unstats.un.org/unsd/methodology/m49/']
  if q['qid']=='placefinder-1000-901':
   q['q']='ما اسم هذا المعبد الهندي المنحوت في الصخر؟'
   row['reason']+=' أضيف نطاق الهند الواسع لأن طلب الاسم دون سياق يحوّل أعلى شريحة إلى حفظ نادر فقط.'
   row['evidence']['additionalPrimarySources']=['https://whc.unesco.org/en/list/243/']
  if q['qid']=='placefinder-1000-905':
   q['q']='ما اسم هذا الموقع الأثري في ميكرونيزيا؟'
   row['reason']+=' توضح ميكرونيزيا النطاق الجغرافي دون تسمية الموقع أو تلقين علاماته؛ لقطة جدران البازلت مطابقة للمرجع.'
   row['evidence']['additionalPrimarySources']=['https://whc.unesco.org/en/list/1503/']
  if q['qid']=='reveal-400-908':q['q']='من الشاعر الذي تكشفه الصورة؟'
  file=Path('media')/pack/q['media']['src']
  if q['qid'] in crops:
   rect=crops[q['qid']]; original=cache/(q['qid']+'.webp')
   if not original.exists():shutil.copyfile(file,original)
   im=Image.open(original).convert('RGB'); box=tuple(round(v*(im.width if j%2==0 else im.height)) for j,v in enumerate(rect))
   im=im.crop(box);im.save(file,format='WEBP',quality=86,method=6)
   q['media']['changes']='Cropped to normalized bounds '+json.dumps(rect)+'; resized and converted to WebP; subject appearance not altered.'
   row['evidence']['cropNormalized']=rect
   row['reason']+=' قُصت الصورة لإبراز الوجه أو الطراز وإزالة النص أو الأشخاص المحيطين دون تغيير هيئة المرجع.'
  else:im=Image.open(file)
  if q['qid']=='reveal-600-901':row['reason']+=' القص يستبعد اسم Hend Sabri المكتوب على غلاف المجلة، فلا يظهر جواب مكتوب في مساحة اللعب.'
  if q['qid']=='reveal-1000-903':row['reason']+=' استُبعدت بطاقة BARSHAM/ AHMED أسفل الصدر التي كانت تسرّب الاسم.'
  if q['qid'] in ['guesscar-200-903','guesscar-400-908']:row['reason']+=' اختير منظر جانبي حقيقي بدل لوحة العرض التي كتبت اسم الطراز.'
  if q['qid']=='placefinder-800-905':row['reason']+=' اختيرت واجهة القصر الفريد الكاملة بدل تفصيل أسودين صغير؛ رُفض مرجع قديم كان لقرية نرويجية مختلفة بالاسم.'
  if q['qid']=='placefinder-800-906':row['reason']+=' مرجع البرج المخروطي داخل الأسوار أوضح من الصخور العامة في المصدر منخفض الدقة.'
  row['after']=q
  row['evidence']['preparedAsset']={'file':str(file).replace('\\','/'),'width':im.width,'height':im.height,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
  row['visualReview']['finalBefore']=f'.cache/badeeha-quality/identity-final/{pack}-before-{i//8+1:02d}.jpg'
  row['visualReview']['finalEffect']=f'.cache/badeeha-quality/identity-final/{pack}-effect-{i//8+1:02d}.jpg'
 p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(B/'authoring/identity-crops.json').write_text(json.dumps(crops,indent=2)+'\n',encoding='utf-8')
(B/'review-identity-images.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Final cards',len(report),'crops',len(crops),'retier',sum(r['decision']=='retier' for r in report))
