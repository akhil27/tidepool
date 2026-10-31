const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png' };
const reefs = [
  { id:'kelp', name:'Kelp Garden', icon:'〰', color:'#7bc5a4', home:0 },
  { id:'glass', name:'Glass Shelf', icon:'◇', color:'#83c7d9', home:1 },
  { id:'coral', name:'Coral Steps', icon:'✿', color:'#f18d78', home:2 },
  { id:'moon', name:'Moon Pool', icon:'☾', color:'#b5a2e8', home:3 },
  { id:'pearl', name:'Pearl Bank', icon:'✧', color:'#e9cd83', home:4 }
];
const words = ['Dawn','Moss','Drift','Foam','Quiet','Lumen','Silt','Comet','Velvet','Tangle','Hush','Salt'];

function roomCode(){ let s=''; const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ'; do { s=Array.from(crypto.randomBytes(5),b=>alphabet[b%alphabet.length]).join(''); } while(rooms.has(s)); return s; }
function send(ws, obj){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function cleanName(n){ return String(n||'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18); }
function publicRoom(room){
  return { code:room.code, phase:room.phase, round:room.round, maxRounds:room.maxRounds, hostId:room.hostId, remainingMs:room.phase==='playing'?Math.max(0,room.deadline-Date.now()):0,
    tide:room.tide, prompt:room.prompt, winner:room.winner, scores:room.scores,
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,ready:p.ready,connected:!!p.ws,isBot:p.isBot,score:p.score,home:p.home,choice:room.phase==='reveal'?p.lastChoice:null,points:room.phase==='reveal'?p.lastPoints:null})),
    reefs: reefs.map((r,i)=>({...r, home:undefined, tideBonus:i===room.tide})) };
}
function forPlayer(room,id){const state=publicRoom(room);state.players=state.players.map(p=>{const original=room.players.get(p.id);return {...p,home:p.id===id?original.home:null,choice:room.phase==='playing'&&p.id===id?original.lastChoice:p.choice};});return state;}
function broadcast(room){ for(const target of room.players.values()) if(target.ws?.readyState===WebSocket.OPEN) target.ws.send(JSON.stringify({type:'state',state:forPlayer(room,target.id)})); }
function reply(ws, type, message, extra={}){ send(ws,{type,message,...extra}); }
function makeRoom(name, ws, bot=false){
  const code=roomCode(), id=crypto.randomUUID(), hostId=id;
  const player={id,name,ws,ready:bot,isBot:bot,token:crypto.randomBytes(20).toString('hex'),score:0,home:Math.floor(Math.random()*5),lastChoice:null,lastPoints:0};
  const room={code,players:new Map([[id,player]]),hostId,phase:'lobby',round:0,maxRounds:6,tide:Math.floor(Math.random()*5),prompt:'',winner:null,choices:new Map(),timers:{}, emptySince:0};
  rooms.set(code,room); if(ws) ws.playerId=id,ws.roomCode=code;
  return {room,player};
}
function nextRound(room){
  room.phase='playing'; room.round++; room.deadline=Date.now()+35000; room.tide=Math.floor(Math.random()*5); room.prompt=words[Math.floor(Math.random()*words.length)]; room.choices.clear();
  for(const p of room.players.values()){p.lastChoice=null;p.lastPoints=0;}
  room.timers.round=setTimeout(()=>resolveRound(room),35000); broadcast(room);
  for(const p of room.players.values()) if(p.isBot) setTimeout(()=>{if(room.phase==='playing'&&room.players.has(p.id)) choose(room,p,Math.floor(Math.random()*5));},500+Math.random()*1700);
}
function choose(room,p,index){
  if(room.phase!=='playing'||!Number.isInteger(index)||index<0||index>4||room.choices.has(p.id)) return false;
  room.choices.set(p.id,index); p.lastChoice=index; broadcast(room);
  const eligible=[...room.players.values()].filter(x=>!x.isBot ? !!x.ws : true);
  if(eligible.length && eligible.every(x=>room.choices.has(x.id))) resolveRound(room);
  return true;
}
function resolveRound(room){
  if(room.phase!=='playing') return; clearTimeout(room.timers.round); room.deadline=0;
  const counts=[0,0,0,0,0]; for(const i of room.choices.values()) counts[i]++;
  for(const [id,i] of room.choices){const p=room.players.get(id); if(!p)continue; p.lastPoints=(counts[i]===1?3:counts[i]===2?2:1)+(i===p.home?2:0)+(i===room.tide?1:0);p.score+=p.lastPoints;}
  room.phase='reveal'; broadcast(room);
  room.timers.reveal=setTimeout(()=>{
    if(room.round>=room.maxRounds){room.phase='finished';const high=Math.max(...[...room.players.values()].map(p=>p.score));room.winner=[...room.players.values()].filter(p=>p.score===high).map(p=>p.name).join(' & ');broadcast(room);}
    else nextRound(room);
  },4300);
}
function start(room){
  if(room.phase!=='lobby')return;
  const humans=[...room.players.values()].filter(p=>!p.isBot);
  if(!humans.length)return;
  for(const p of humans)p.ready=true;
  if(room.players.size<2){const bot={id:crypto.randomUUID(),name:'Pebble',ws:null,ready:true,isBot:true,token:'',score:0,home:Math.floor(Math.random()*5),lastChoice:null,lastPoints:0};room.players.set(bot.id,bot);}
  nextRound(room);
}
function detach(ws){const room=rooms.get(ws.roomCode),p=room?.players.get(ws.playerId);if(!room||!p||p.ws!==ws)return;p.ws=null;if(room.hostId===p.id){const next=[...room.players.values()].find(q=>!q.isBot&&q.ws);if(next)room.hostId=next.id;else if(room.phase==='lobby')room.hostId=[...room.players.values()].find(q=>!q.isBot)?.id||null;}broadcast(room);
  p.disconnectTimer=setTimeout(()=>{if(p.ws)return;room.players.delete(p.id);if(room.hostId===p.id)room.hostId=[...room.players.values()].find(q=>!q.isBot)?.id||null;if(!room.players.size)rooms.delete(room.code);else broadcast(room);},45000);
  if(room.phase==='playing'&&[...room.players.values()].filter(q=>!!q.ws||q.isBot).every(q=>room.choices.has(q.id)))resolveRound(room);
}
const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  const pathname=decodeURIComponent((req.url||'/').split('?')[0]);const file=path.join(PUBLIC,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);});
});
const wss=new WebSocketServer({server,maxPayload:2048});
wss.on('connection',ws=>{
  ws.lastMsg=0;ws.on('message',raw=>{
    const now=Date.now();if(now-ws.lastMsg<50){reply(ws,'error','Easy there — give the tide a moment.');return;}ws.lastMsg=now;
    let m;try{m=JSON.parse(raw.toString());}catch{return reply(ws,'error','That message did not make sense.');}
    if(!m||typeof m!=='object'||typeof m.type!=='string')return reply(ws,'error','That message did not make sense.');
    if(m.type==='create'){
      const name=cleanName(m.name);if(!name)return reply(ws,'error','Choose a name first.');const {room,player}=makeRoom(name,ws);return reply(ws,'joined','Room created.',{code:room.code,playerId:player.id,token:player.token,state:forPlayer(room,player.id)});
    }
    if(m.type==='solo'){
      const name=cleanName(m.name)||'You';const {room,player}=makeRoom(name,ws);player.ready=true;room.players.set('bot-a',{id:'bot-a',name:'Minnow',ws:null,ready:true,isBot:true,token:'',score:0,home:1,lastChoice:null,lastPoints:0});room.players.set('bot-b',{id:'bot-b',name:'Orbit',ws:null,ready:true,isBot:true,token:'',score:0,home:3,lastChoice:null,lastPoints:0});return reply(ws,'joined','Practice room ready.',{code:room.code,playerId:player.id,token:player.token,state:forPlayer(room,player.id)});
    }
    if(m.type==='join'){
      const code=String(m.code||'').toUpperCase();const room=rooms.get(code);if(!room)return reply(ws,'error','That room code was not found.');if(room.phase!=='lobby')return reply(ws,'error','This tide is already underway. Join a fresh room after the round.');if(room.players.size>=6)return reply(ws,'error','This reef is full.');const name=cleanName(m.name);if(!name)return reply(ws,'error','Choose a name first.');if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return reply(ws,'error','That name is already in this room.');const id=crypto.randomUUID(),p={id,name,ws,ready:false,isBot:false,token:crypto.randomBytes(20).toString('hex'),score:0,home:Math.floor(Math.random()*5),lastChoice:null,lastPoints:0};room.players.set(id,p);ws.playerId=id;ws.roomCode=code;reply(ws,'joined','Welcome to the tide.',{code,playerId:id,token:p.token,state:forPlayer(room,id)});broadcast(room);return;
    }
    if(m.type==='rejoin'){
      const room=rooms.get(String(m.code||'').toUpperCase()),p=room&&[...room.players.values()].find(q=>q.token&&q.token===m.token);if(!p)return reply(ws,'error','Your saved seat has expired.');clearTimeout(p.disconnectTimer);if(p.ws&&p.ws!==ws)p.ws.close();p.ws=ws;ws.playerId=p.id;ws.roomCode=room.code;reply(ws,'joined','You are back in your seat.',{code:room.code,playerId:p.id,token:p.token,state:forPlayer(room,p.id)});broadcast(room);return;
    }
    const room=rooms.get(ws.roomCode),p=room?.players.get(ws.playerId);if(!room||!p)return reply(ws,'error','Join a room first.');
    if(m.type==='ready'){if(room.phase!=='lobby')return;if(typeof m.ready!=='boolean')return reply(ws,'error','Choose ready or not ready.');p.ready=m.ready;broadcast(room);return;}
    if(m.type==='start'){if(room.hostId!==p.id)return reply(ws,'error','Only the host can start the round.');const humans=[...room.players.values()].filter(q=>!q.isBot);const hasBots=[...room.players.values()].some(q=>q.isBot);if(humans.length<2&&!hasBots)return reply(ws,'error','Invite one more player, or choose Solo practice.');if(humans.length>1&&humans.some(q=>!q.ready))return reply(ws,'error','Everyone must be ready first.');return start(room);}
    if(m.type==='choose'){if(!Number.isInteger(m.reef))return reply(ws,'error','Choose one of the five reefs.');if(!choose(room,p,m.reef))return reply(ws,'error','That reef is not available right now.');return;}
    if(m.type==='again'){if(room.phase!=='finished')return reply(ws,'error','The game is still going.');if(room.hostId!==p.id)return reply(ws,'error','Only the host can start again.');room.phase='lobby';room.round=0;room.winner=null;room.players.forEach(q=>{q.score=0;q.ready=q.isBot;});broadcast(room);return;}
    if(m.type==='leave'){ws.close(1000,'left');return;}
    reply(ws,'error','Unknown action.');
  });
  ws.on('close',()=>detach(ws));
  ws.on('error',()=>{});
});
setInterval(()=>{for(const [code,room]of rooms){const hasConnectedHuman=[...room.players.values()].some(p=>!p.isBot&&p.ws);if(!room.players.size||(!hasConnectedHuman&&room.phase==='lobby')){if(!room.emptySince)room.emptySince=Date.now();if(Date.now()-room.emptySince>120000){Object.values(room.timers).forEach(clearTimeout);rooms.delete(code);}}else room.emptySince=0;}},30000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Tidepool listening on ${PORT}`));
