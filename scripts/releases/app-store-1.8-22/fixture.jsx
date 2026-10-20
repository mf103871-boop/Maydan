// Screenshot-only harness. All visible app components/CSS/art are imported from
// the audited frozen source via @app; this file is never part of an app build.
import React,{useContext,useMemo}from'react';
import{createRoot}from'react-dom/client';
import{PreviewProviders}from'@app/src/design/preview-platform.jsx';
import{AccountContext}from'@app/src/shared/account/context.js';
import{SocialContext}from'@app/src/social/SocialProvider.jsx';
import{LammaContext}from'@app/src/social/LammaProvider.jsx';
import{SocialUIContext}from'@app/src/social/SocialUIProvider.jsx';
import{ProfileContext}from'@app/src/profiles/ProfileProvider.jsx';
import{PlatformContext}from'@app/src/platform/context.js';
import{isNativeShell}from'@app/src/shared/account/native.js';
import{Home}from'@app/src/platform/screens/Home.jsx';
import{BottomNavigation}from'@app/src/platform/BottomNavigation.jsx';
import{CallViewport}from'@app/src/social/CallViewport.jsx';
import{SocialHost}from'@app/src/social/SocialHost.jsx';
import{RoomChrome}from'@app/src/online/Online.jsx';
import{ErsomhaMatch}from'@app/src/online/Ersomha.jsx';
import{FabrakaMatch}from'@app/src/online/Fabraka.jsx';
import{CallControls}from'@app/src/social/CallDock.jsx';
import{createDesignFixture}from'@app/src/design/screen-catalog.js';
import{createDesignGameApi}from'@app/src/design/preview-scenes.jsx';
import Badeeha from'@app/src/games/badeeha/App.js';
import{CATS}from'@app/src/data/categories/index.js';
import{preloadMedia}from'@app/src/shared/media/preload.js';
import onlineCss from'@app/src/online/online.css';
const noop=()=>{},resolved=async()=>true;
const scene=new URLSearchParams(location.search).get('scene')||'home';
const PEOPLE=[
 {id:'studio-me',name:'ليان',avatarPreset:'fox',theme:'teal',online:true,code:'MDN-DEMO',avatar:0},
 {id:'studio-sara',name:'سارة',avatarPreset:'cat',theme:'rose',online:true,conversationId:'demo-direct',unreadCount:2,avatar:1},
 {id:'studio-omar',name:'عمر',avatarPreset:'lion',theme:'gold',online:true,conversationId:'demo-direct2',avatar:2},
 {id:'studio-lina',name:'نور',avatarPreset:'owl',theme:'violet',online:true,conversationId:'demo-direct3',avatar:3},
 {id:'demo-hassan',name:'حسن',avatarPreset:'bear',theme:'teal',online:false,lastSeenAt:Date.now()-1200000,avatar:0},
 {id:'demo-rana',name:'رنا',avatarPreset:'rabbit',theme:'rose',online:false,lastSeenAt:Date.now()-1800000,avatar:1},
];
const GROUP={id:'studio-group',name:'لمّة الخميس',avatarPreset:'controller',ownerId:PEOPLE[0].id,role:'owner',memberCount:4,unreadCount:0,lastMessage:{text:'جاهزين؟ نبدأ ارسمها 🎨',createdAt:Date.now()-12000}};
const members=PEOPLE.slice(0,4).map((user,i)=>({...user,userId:user.id,user,role:i?'member':'owner',joinedAt:1780000000000}));
const at=Date.now()-180000;
const messages=[
 {seq:1,senderId:PEOPLE[1].id,text:'يا هلا باللّمّة! نلعب جولة؟ 😄',kind:'text',createdAt:at,status:'sent'},
 {seq:2,senderId:PEOPLE[0].id,text:'يلا ارسمها! كل واحد من جواله 🎨',kind:'text',createdAt:at+10000,status:'sent',read:true},
 {seq:3,senderId:PEOPLE[2].id,kind:'voice',attachment:{id:'demo-voice',durationMs:18000},createdAt:at+22000,status:'sent'},
 {seq:4,senderId:PEOPLE[0].id,kind:'game_invite',roomInvitation:{id:'demo-invite',game:'ersomha',roomCode:'456789',status:'pending',expiresAt:Date.now()+3600000},createdAt:at+35000,status:'sent',read:true},
];
function Contexts({children}){
 const accountBase=useContext(AccountContext),socialBase=useContext(SocialContext),lammaBase=useContext(LammaContext),uiBase=useContext(SocialUIContext),profilesBase=useContext(ProfileContext),platformBase=useContext(PlatformContext);
 const account={...accountBase,user:PEOPLE[0],me:{...accountBase.me,user:PEOPLE[0]},platform:'ios'};
 const social={...socialBase,profile:PEOPLE[0],friends:PEOPLE.slice(1),incoming:[],outgoing:[],unreadCount:2,notification:null};
 const detail={id:GROUP.id,group:GROUP,members,messages,loading:false,loadingOlder:false,hasMore:false,error:'',peerReadSeq:4,readSeq:4};
 const lamma={...lammaBase,groups:[GROUP],groupInvites:[],groupConversations:{[GROUP.id]:detail},callMembers:{[GROUP.id]:members},calls:[],activeCall:null,media:{connected:false,connecting:false,muted:false,participants:[]},capabilities:{voiceMessages:true,liveCalls:true,pushNotifications:true},loadGroup:async()=>detail,selectGroup:()=>noop};
 const ui={...uiBase,open:['friends','chat'].includes(scene),drawerOpen:false,presentation:'page',view:scene==='chat'?{type:'group',id:GROUP.id,tab:'groups'}:{type:'list',tab:'friends'},drafts:{},listState:{},favorites:[PEOPLE[1].id,PEOPLE[2].id]};
 const profiles={...profilesBase,mine:{...profilesBase.mine,...PEOPLE[0]}};
 return <PlatformContext.Provider value={{...platformBase,version:'1.8'}}><AccountContext.Provider value={account}><SocialContext.Provider value={social}><LammaContext.Provider value={lamma}><SocialUIContext.Provider value={ui}><ProfileContext.Provider value={profiles}>{children}</ProfileContext.Provider></SocialUIContext.Provider></LammaContext.Provider></SocialContext.Provider></AccountContext.Provider></PlatformContext.Provider>;
}
function Room({game,children,state}){return <section className="screen stack online-screen"><style>{onlineCss}</style><RoomChrome state={state} code="456789" status="connected" error={null} onExit={noop}>{children}</RoomChrome></section>;}
function Ersomha(){
 const fixture=useMemo(()=>createDesignFixture('ersomha.draw.guesser',{now:Date.now()}),[]);
 const state=fixture.state;state.deadlineAt=Date.now()+26000;state.round=2;state.guessedIds=[];state.recentGuesses=[];state.members[0].name='عمر';
 const client=useMemo(()=>{const listeners=new Set();return{ws:{bufferedAmount:0},subscribeDrawing:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},command:async type=>{if(type==='drawing_sync')queueMicrotask(()=>listeners.forEach(fn=>fn({kind:'sync',epoch:1,seq:0,ops:[],undoneIds:[]})));return true;},emit:event=>listeners.forEach(fn=>fn(event))};},[]);
 window.drawingClient=client;
 return <Room game="ersomha" state={state}><ErsomhaMatch state={state} me={fixture.me} client={client} isHost={false} status="connected" disabled={false} act={resolved} clockOffset={0} drawerReady onReport={resolved}/></Room>;
}
function Quiz(){
 const platform=useContext(PlatformContext),fixture=useMemo(()=>createDesignFixture('badeeha.question'),[]);
 const category=CATS.find(c=>c.id==='spotdiff'),question=category.qs.find(q=>q.qid==='spotdiff-600-921');
 fixture.badeeha.selectedCategories=['spotdiff'];fixture.badeeha.current={categoryId:'spotdiff',index:0};fixture.badeeha.deck={spotdiff:[question]};fixture.badeeha.teams[0].score=1200;fixture.badeeha.teams[1].score=800;
 const api=useMemo(()=>createDesignGameApi(platform,fixture.badeeha),[platform,fixture]);
 return <Badeeha api={api}/>;
}
function Fabraka(){
 const fixture=useMemo(()=>createDesignFixture('online.fabraka.vote',{now:Date.now()}),[]),state=fixture.state;
 state.round=3;state.rounds=5;state.deadlineAt=Date.now()+24000;state.submittedCount=2;state.myVote={submitted:true,optionId:state.options[0].id};state.members.forEach((p,i)=>{p.score=[2500,2000,1500,1000][i];});
 const call={id:'demo-call',scope:'group',conversationId:GROUP.id,name:GROUP.name,status:'active',acceptedAt:Date.now()-62000};
 const media={connected:true,userId:fixture.me.id,muted:true,participants:state.members.slice(0,3).map((p,i)=>({...p,...p.profile,id:p.id,name:p.name,identity:p.id,userId:p.id,local:i===0,isLocal:i===0,speaking:i===1,muted:i===0,audioLevel:i===1?.6:0}))};
 return <><Room game="fabraka" state={state}><FabrakaMatch state={state} me={fixture.me} isHost disabled={false} act={resolved} clockOffset={0}/></Room><CallControls call={call} media={media} currentUserId={fixture.me.id} onMute={resolved} onEnd={noop} onOpen={noop}/></>;
}
function Content(){return <CallViewport>{scene==='home'?<Home/>:scene==='ersomha'?<Ersomha/>:scene==='badeeha'?<Quiz/>:scene==='fabraka'?<Fabraka/>:<div data-social-page-slot/>}{['home','friends'].includes(scene)&&<BottomNavigation route={{name:scene==='home'?'home':'friends',path:scene==='home'?'/':'/friends',params:{}}}/>}</CallViewport>;}
function App(){return <PreviewProviders sceneId="home"><Contexts><Content/>{['friends','chat'].includes(scene)&&<SocialHost/>}</Contexts></PreviewProviders>;}
void(scene==='badeeha'?preloadMedia(['media/spotdiff/spotdiff-600-901-a.webp','media/spotdiff/spotdiff-600-901-b-q20261008.webp']):Promise.resolve()).then(()=>{createRoot(document.getElementById('root')).render(<App/>);window.captureReady=true;window.captureNativeMode=isNativeShell();});
