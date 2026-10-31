(() => {
  const $ = id => document.getElementById(id);
  const home=$('home'),roomScreen=$('room'),connection=$('connection'),homeError=$('homeError'),toast=$('toast');
  const STORE='tidepool-seat-v1';let ws,state,seat=null,retry=0,toastTimer,turnTimer,toastShown='',wantRejoin=false;
  const iconColors=['#7bc5a4','#83c7d9','#f18d7c','#b5a2e8','#e9cd83'];
  function tell(text){homeError.textContent=text||'';}
  function notify(text){toast.textContent=text;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2600);}
  function setConnection(text,kind=''){connection.className=`connection ${kind}`;connection.querySelector('span').textContent=text;}
  function save(){if(seat)localStorage.setItem(STORE,JSON.stringify(seat));}
  function connect(){
    const proto=location.protocol==='https:'?'wss:':'ws:';const socket=new WebSocket(`${proto}//${location.host}`);ws=socket;setConnection('Connecting to the water…');
    socket.onopen=()=>{if(ws!==socket)return;retry=0;setConnection('Connected to the water','live');if(seat){socket.send(JSON.stringify({type:'rejoin',code:seat.code,token:seat.token}));wantRejoin=true;}};
    socket.onmessage=e=>{if(ws!==socket)return;let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==='error'){if(wantRejoin){wantRejoin=false;seat=null;localStorage.removeItem(STORE);roomScreen.classList.add('hidden');home.classList.remove('hidden');history.replaceState({},'',location.pathname);return tell(m.message)}if(home.classList.contains('hidden'))notify(m.message);else tell(m.message);return}if(m.type==='joined'){wantRejoin=false;seat={code:m.code,id:m.playerId,token:m.token};save();if(m.state)paint(m.state);return}if(m.type==='state'){paint(m.state)}};
    socket.onclose=()=>{if(ws!==socket)return;setConnection('Reconnecting to the water…','down');if(seat){clearTimeout(turnTimer);retry++;setTimeout(connect,Math.min(7000,700*retry));}else if(retry<5){retry++;setTimeout(connect,Math.min(5000,900*retry));}else setConnection('The water is quiet','down');};
    socket.onerror=()=>{if(ws===socket)setConnection('Finding a signal…','down');};
  }
  connect();
  function send(obj){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));else notify('Reconnecting… one moment.');}
  function enter(name,type,code){if(name===null)return;tell('');if(!name)name='Guest';if(type==='solo')send({type:'solo',name});else if(type==='create')send({type:'create',name});else send({type:'join',name,code});}
  $('soloBtn').onclick=()=>enter(promptName(),'solo');
  $('createBtn').onclick=()=>enter(promptName(),'create');
  function promptName(){let n=localStorage.getItem('tidepool-name')||'';if(!n)n=window.prompt('What should we call you?','');if(n===null)return '';n=n.trim().slice(0,18);if(n)localStorage.setItem('tidepool-name',n);return n;}
  $('joinForm').addEventListener('submit',e=>{e.preventDefault();enter(promptName(),'join',$('roomCode').value.trim().toUpperCase());});
  const queryCode=new URLSearchParams(location.search).get('room');if(queryCode){$('roomCode').value=queryCode.slice(0,5).toUpperCase();}
  $('copyBtn').onclick=async()=>{const link=`${location.origin}/?room=${state?.code||''}`;try{await navigator.clipboard.writeText(link);notify('Invite link copied.');}catch{notify(link);}};
  $('leaveBtn').onclick=()=>{send({type:'leave'});seat=null;localStorage.removeItem(STORE);history.replaceState({},'',location.pathname);roomScreen.classList.add('hidden');home.classList.remove('hidden');connect();};
  $('readyCheck').onchange=e=>send({type:'ready',ready:e.target.checked});
  $('startBtn').onclick=()=>send({type:'start'});
  $('againBtn').onclick=()=>send({type:'again'});
  function paint(s){state=s;document.title=`${s.code} · Tidepool`;home.classList.add('hidden');roomScreen.classList.remove('hidden');$('codeValue').textContent=s.code;$('playerCount').textContent=`${s.players.length} / 6`;
    const me=s.players.find(p=>p.id===seat?.id);if(me&&$('readyCheck').checked!==me.ready)$('readyCheck').checked=me.ready;
    const host=me?.id===s.hostId;const bots=s.players.some(p=>p.isBot);const humans=s.players.filter(p=>!p.isBot);$('readyWrap').classList.toggle('hidden',s.phase!=='lobby'||bots);$('startBtn').classList.toggle('hidden',s.phase!=='lobby'||!host);$('startBtn').disabled=(!bots&&(humans.length<2||humans.some(p=>!p.ready)));
    const playerList=$('playerList');playerList.replaceChildren(...s.players.map((p,i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className='avatar';avatar.style.background=iconColors[i%5];avatar.textContent=p.name.slice(0,1).toUpperCase();const name=document.createElement('span');name.textContent=p.name+(p.id===seat?.id?' (you)':'');const sub=document.createElement('small');sub.textContent=p.id===s.hostId?'HOST':p.isBot?'PRACTICE':p.ready?'READY':p.connected?'HERE':'RECONNECTING';div.append(avatar,name,sub);return div;}));
    $('lobbyView').classList.toggle('hidden',s.phase!=='lobby');$('playView').classList.toggle('hidden',s.phase==='lobby'||s.phase==='finished');$('finishView').classList.toggle('hidden',s.phase!=='finished');
    if(s.phase==='lobby'){$('phaseTitle').textContent='Gathering by the shore';history.replaceState({},'',`/?room=${s.code}`);return;}
    if(s.phase==='finished'){clearInterval(turnTimer);$('phaseTitle').textContent='The tide has settled';$('winnerText').textContent=s.winner?.includes('&')?'A shared little victory.':`${s.winner} found their corner.`;$('finishDetail').textContent=`${s.maxRounds} rounds, five reefs, and no two tides alike.`;$('finalScores').replaceChildren(...sorted(s.players).map(scoreRow));$('againBtn').classList.toggle('hidden',!host);return;}
    $('phaseTitle').textContent=s.phase==='playing'?'Find your reef':'The tide reveals';$('roundLabel').textContent=`ROUND ${s.round} OF ${s.maxRounds}`;$('tideName').textContent=s.reefs[s.tide]?.name||'';$('tideIcon').style.color=iconColors[s.tide];$('promptText').textContent=s.phase==='playing'?`A ${s.prompt.toLowerCase()} current rolls in. Where will you land?`:`The ${s.prompt.toLowerCase()} current has settled. See where everyone found room.`;
    const myChoice=me?.choice;const grid=$('reefGrid');grid.replaceChildren(...s.reefs.map((reef,i)=>{const b=document.createElement('button');b.className='reef-choice'+(myChoice===i?' selected':'');b.disabled=s.phase!=='playing'||myChoice!==null&&myChoice!==undefined;b.setAttribute('aria-pressed',String(myChoice===i));b.setAttribute('aria-label',`${reef.name}${reef.tideBonus?', tide bonus +1':''}${me?.home===i?', your favorite reef bonus +2':''}`);const ic=document.createElement('span');ic.className='reef-icon';ic.textContent=reef.icon;ic.style.color=iconColors[i];const nm=document.createElement('span');nm.className='reef-name';nm.textContent=reef.name;const bonus=document.createElement('span');bonus.className='bonus';bonus.textContent=reef.tideBonus?'+1 tide':'';b.append(ic,nm,bonus);if(me?.home===i){const fav=document.createElement('span');fav.className='home-badge';fav.textContent='HOME +2';b.append(fav);}b.onclick=()=>send({type:'choose',reef:i});return b;}));
    $('pickStatus').textContent=s.phase==='reveal'?`You found ${myChoice==null?'the current':s.reefs[myChoice].name}. ${myChoice==null?'':`+${me.points} points this round.`}`:myChoice==null?'Choose a reef before the others do.':'You have chosen. Waiting for the others…';
    $('myScore').textContent=me?.score||0;$('tideBonus').textContent='+1';$('roundResults').classList.toggle('hidden',s.phase!=='reveal');$('roundResults').textContent=s.phase==='reveal'?myChoice==null?'Your tide moved on before you picked.':`+${me.points} points · ${s.reefs[myChoice].name}`:'';
    $('scoreList').replaceChildren(...sorted(s.players).map(scoreRow));$('roundTimer').textContent=s.phase==='reveal'?'Next tide in a moment':'';
    clearInterval(turnTimer);if(s.phase==='playing'){let left=Math.max(0,Math.ceil((s.remainingMs||0)/1000));$('roundTimer').textContent=left?`${left}s to choose`:'The tide is turning…';turnTimer=setInterval(()=>{left--;if(left<=0){clearInterval(turnTimer);$('roundTimer').textContent='The tide is turning…';}else $('roundTimer').textContent=`${left}s to choose`;},1000);}
  }
  function sorted(players){return [...players].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));}
  function scoreRow(p){const row=document.createElement('div');row.className='score-item';const dot=document.createElement('span');dot.className='mini-dot';if(p.home===null)dot.style.background='#8aa7a0';const name=document.createElement('span');name.textContent=p.name+(p.id===seat?.id?' · you':'');const score=document.createElement('b');score.textContent=p.score;row.append(dot,name,score);return row;}
})();
