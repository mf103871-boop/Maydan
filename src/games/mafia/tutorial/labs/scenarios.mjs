// Fixed fictional casts. Words are reviewed shuffle choices, never a saved seed
// or a role-assignment command accepted from a learner.
export const LAB_HUMAN='lab-0',LAB_VERSION=1,LAB_RULESET=1;
export const MAFIA_LABS=Object.freeze({
  doctor:{title:'الطبيب: اختيار الحماية',description:'حماية النفس مرة، وتغيير الهدف بين الليالي.',
    words:[1,1,1,1,1,2,4,2,4,2,2,0],roles:['doctor','investigator','blocker','citizen','citizen','citizen','guard','mafia']},
  masker:{title:'المموّه: أثر ليلة واحدة',description:'جرّب التمويه واقرأ أثره التعليمي ثم زواله.',
    words:[0,4,1,2,1,6,4,0,4,2,1,0],roles:['masker','citizen','doctor','mafia','citizen','investigator','guard','citizen']},
  blocker:{title:'المعطّل: الفعل والدرع',description:'عطّل حماية الطبيب، ثم اختبر درع الحارس.',
    words:[1,4,1,2,1,6,4,0,4,2,1,0],roles:['blocker','citizen','doctor','mafia','citizen','investigator','guard','citizen']},
  conversion:{title:'التجنيد: فريق جديد',description:'يبقى اختصاص المحقق وشحنته، ويتغير انتماؤه.',
    words:[1,2,1,1,1,2,1,3,5,3,1,1,1],roles:['investigator','citizen','leader','citizen','citizen','guard','blocker','doctor','mafia']},
  abstention:{title:'الامتناع: صوت لم يُمنح',description:'التعادل في الترشيح، والأغلبية عند الحكم.',
    words:[1,2,1,1,1,2,3,2,0,2,1,0],roles:['citizen','guard','doctor','citizen','investigator','citizen','blocker','mafia']},
});
export const labActors=id=>MAFIA_LABS[id]?.roles.map((roleId,index)=>({id:`lab-${index}`,name:index?['','ليان','سامر','نور','عمر','هالة','سليم','مازن','رنا'][index]:'أنت',roleId,avatar:index%4}));
