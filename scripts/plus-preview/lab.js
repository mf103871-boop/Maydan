const frame=document.querySelector('#app'),notice=document.querySelector('#notice');
const prefix=`maydan:environment:${encodeURIComponent(location.origin)}:account:`;
let route='/store',currentScenario='plus',busy=false;
const labels={free:'مجاني',plus:'بلس فعّال',owned:'مقتنيات دائمة',expired:'بلس منتهي',refunded:'بعد الاسترداد',annual:'اشتراك سنوي'};
function inform(text,error=false){notice.textContent=text;notice.classList.toggle('error',error);}
function button(label,action,parent){const b=document.createElement('button');b.textContent=label;b.type='button';b.onclick=action;document.querySelector(parent).append(b);return b;}
function open(path){route=path;frame.src='/#'+path;document.querySelector('#full').href='/#'+path;}
function token(){try{return JSON.parse(localStorage.getItem(prefix+'session'));}catch{return null;}}
async function post(path,body,auth=false){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json',...(auth?{Authorization:'Bearer '+token()}: {})},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'فشل طلب الاختبار');return d;}
async function scenario(id){if(busy)return;busy=true;document.querySelectorAll('#scenarios button').forEach(b=>b.disabled=true);try{const d=await post('/__plus_lab__/scenario',{scenario:id});localStorage.setItem(prefix+'session',JSON.stringify(d.session.token));localStorage.setItem(prefix+'me',JSON.stringify({data:d.me,fetchedAt:Date.now()}));currentScenario=id;document.querySelectorAll('#scenarios button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===id)));open(route);inform(`حساب ${labels[id]} · محلي فقط. المقتنيات والاستحقاق مصدرهما قاعدة الاختبار.`);}catch(e){inform(e.message,true);}finally{busy=false;document.querySelectorAll('#scenarios button').forEach(b=>b.disabled=false);}}
for(const[id,label]of Object.entries(labels)){const b=button(label,()=>scenario(id),'#scenarios');b.dataset.id=id;}
for(const[label,path]of [['المتجر','/store'],['مقتنياتي','/store?tab=library'],['بروفايلي','/profile'],['الأصدقاء','/friends'],['الألعاب','/']])button(label,()=>open(path),'#routes');
for(const[label,w,h]of [['صغير',320,740],['هاتف',390,844],['كبير',430,900],['أفقي',844,390],['تابلت',768,1024]])button(label,()=>{frame.style.width=w+'px';frame.style.height=h+'px';},'#sizes');
button('إنهاء العضوية',async()=>{try{await post('/__plus_lab__/action',{action:'expire'},true);open(route);inform('تمت محاكاة انتهاء بلس. يعود مظهر البروفايل والإطار إلى المتاح مجانًا مع حفظ الاختيارات.');}catch(e){inform(e.message,true);}},'#actions');
document.querySelector('#reduced').onchange=e=>{const key='maydan:platform:settings';const state=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({...state,reducedMotion:e.target.checked}));open(route);};
// Keep a design review quiet; this does not modify the private audio42 pack.
const settings=JSON.parse(localStorage.getItem('maydan:platform:settings')||'{}');localStorage.setItem('maydan:platform:settings',JSON.stringify({...settings,soundOn:false,musicOn:false}));
document.querySelector('#reduced').checked=Boolean(settings.reducedMotion);
await scenario(currentScenario);
