const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const assert = require('node:assert/strict');

const port=31000+Math.floor(Math.random()*15000);
const base=(process.env.TIDEPOOL_URL||`http://127.0.0.1:${port}`).replace(/\/+$/,'');
const socketBase=base.replace(/^https:/,'wss:').replace(/^http:/,'ws:');
const server=process.env.TIDEPOOL_URL?null:spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
const allPeers=new Set();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function ready(){const attempts=process.env.TIDEPOOL_URL?120:70;for(let i=0;i<attempts;i++){try{const r=await fetch(`${base}/health`);if(r.ok)return;}catch{}await delay(process.env.TIDEPOOL_URL?1000:150);}throw new Error('server did not become healthy');}
class Peer{
  constructor(){this.ws=null;this.waiters=[];this.states=[];this.messages=[];allPeers.add(this);this.opened=new Promise((resolve,reject)=>{this._openResolve=resolve;this._openReject=reject;});}
  connect(){this.ws=new WebSocket(socketBase);this.ws.on('open',this._openResolve);this.ws.on('error',e=>this._openReject(e));this.ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(m.type==='error')console.error('server error:',m.message);this.messages.push(m);if(m.type==='state')this.states.push(m.state);for(const w of [...this.waiters])if(w.test(m)){this.waiters.splice(this.waiters.indexOf(w),1);this.messages.splice(this.messages.indexOf(m),1);clearTimeout(w.timer);w.resolve(m);}});return this.opened;}
  wait(test,timeout=8000){const index=this.messages.findIndex(test);if(index>=0)return Promise.resolve(this.messages.splice(index,1)[0]);const found=this.states.find(s=>test({type:'state',state:s}));if(found)return Promise.resolve({type:'state',state:found});return new Promise((resolve,reject)=>{const w={test,resolve,reject,timer:setTimeout(()=>{this.waiters.splice(this.waiters.indexOf(w),1);const last=this.states.at(-1);reject(new Error(`timed out waiting for server message (last state: ${last?.phase} round ${last?.round}, host ${last?.hostId}, players ${last?.players?.map(p=>p.id).join(',')})`));},timeout)};this.waiters.push(w);});}
  send(type,data={}){this.ws.send(JSON.stringify({type,...data}));}
  clear(){this.messages.length=0;this.states.length=0;}
  disconnect(){if(this.ws?.readyState===WebSocket.OPEN)this.ws.terminate();}
  async action(type,data={},predicate=()=>true){const p=this.wait(m=>(m.type==='error'&&['choose','start'].includes(type))||(m.type==='state'&&predicate(m.state)),6000);this.send(type,data);return p;}
  close(){if(this.ws?.readyState===WebSocket.OPEN)this.ws.close();}
}
async function main(){
  try{
    await ready(); console.log('server healthy');
    const a=new Peer(),b=new Peer(),c=new Peer();c.tag='C';await Promise.all([a.connect(),b.connect(),c.connect()]);
    a.send('create',{name:'Aster'});const created=await a.wait(m=>m.type==='joined');console.log('room created');const code=created.code,tokenA=created.token,idA=created.playerId;assert.match(code,/^[A-Z]{5}$/);
    b.send('join',{name:'Brine',code});const jb=await b.wait(m=>m.type==='joined');const idB=jb.playerId;
    c.send('join',{name:'Coral',code});const jc=await c.wait(m=>m.type==='joined');const idC=jc.playerId;
    await Promise.all([a.wait(m=>m.type==='state'&&m.state.players.length===3),b.wait(m=>m.type==='state'&&m.state.players.length===3),c.wait(m=>m.type==='state'&&m.state.players.length===3)]);
    console.log('3 players joined');
    // A leaves first: B must inherit the host seat. A then resumes using its saved token.
    await delay(70);a.send('leave');await b.wait(m=>m.type==='state'&&m.state.hostId===idB,10000);console.log('host reassigned');
    let a2=new Peer();await a2.connect();a2.send('rejoin',{code,token:tokenA});await a2.wait(m=>m.type==='joined');console.log('saved seat restored');
    await delay(70);a2.send('ready',{ready:true});b.send('ready',{ready:true});c.send('ready',{ready:true});
    await a2.wait(m=>m.type==='state'&&m.state.players.length===3&&m.state.players.every(p=>p.ready));
    await delay(70);b.send('start');await Promise.all([a2,b,c].map(p=>p.wait(m=>m.type==='state'&&m.state.phase==='playing'&&m.state.round===1)));await delay(70);console.log('rounds started');
    let round=1;
    for(;round<=6;round++){
      const state=(await a2.wait(m=>m.type==='state'&&m.state.phase==='playing'&&m.state.round===round)).state;console.log(`round ${round}`);
      if(round===2){a2.send('leave');await delay(250);a2=new Peer();await a2.connect();a2.send('rejoin',{code,token:tokenA});await a2.wait(m=>m.type==='joined');await delay(70);}
      if(round===3){await delay(70);c.clear();b.send('leave');await c.wait(m=>m.type==='state'&&m.state.hostId!==idB&&m.state.hostId!==null,10000);await new Promise(resolve=>{if(b.ws.readyState===WebSocket.CLOSED)return resolve();b.ws.once('close',resolve);setTimeout(resolve,1500);});}
      const remaining=[a2,b,c].filter(p=>p.ws.readyState===WebSocket.OPEN&&(round!==3||p!==b));
      for(let i=0;i<remaining.length;i++)remaining[i].send('choose',{reef:(round+i)%5});
      if(round<6){const next=round+1;await Promise.all(remaining.map(p=>p.wait(m=>m.type==='state'&&m.state.phase==='playing'&&m.state.round===next,9000)));}
      else await Promise.all(remaining.map(p=>p.wait(m=>m.type==='state'&&m.state.phase==='finished',9000)));
    }
    const end=(await c.wait(m=>m.type==='state'&&m.state.phase==='finished')).state;assert.equal(end.round,6);assert.ok(end.players.find(p=>p.id===idA).score>=0);assert.ok(end.players.find(p=>p.id===idB));assert.ok(end.players.find(p=>p.id===idC));
    const invalid=c.wait(m=>m.type==='error',3000);c.send('choose',{reef:99});assert.equal((await invalid).type,'error');
    console.log('PASS: 3 live clients completed 6 rounds; host handoff, saved-seat reconnect, scoring, health, and invalid-action rejection passed.');
    [a2,b,c].forEach(p=>p.close());
  } finally {server?.kill();for(const peer of allPeers)peer.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
