const app = document.getElementById('app');
const title = document.getElementById('page-title');
let equipment;

const thresholds = p => p > 30 ? 'red' : p > 10 ? 'yellow' : 'green';
const rank = {gray:0,green:1,yellow:2,red:3};
const worst = xs => xs.reduce((a,b)=>rank[b]>rank[a]?b:a,'gray');

function demoDevices(station, lineIndex){
  // Только для визуального прототипа, пока Excel-справочник не импортирован.
  const base = Math.abs([...station.id].reduce((a,c)=>a+c.charCodeAt(0),0) + lineIndex*17);
  const count = station.id === 'sportivnaya' ? 10 : 6;
  return Array.from({length:count},(_,i)=>{
    const loss = ((base + i*13) % 42) / 1.3;
    return {deviceId:`DEMO-${station.id.slice(0,3).toUpperCase()}-${lineIndex+1}-${String(i+1).padStart(2,'0')}`, akp:`АКП ${i+1}`, ip:'—', lossPercent:+loss.toFixed(1), demo:true};
  });
}
function devicesFor(station){
  return station.turnstileLines.flatMap((l,li)=>(l.devices?.length?l.devices:demoDevices(station,li)));
}
function stationStatus(station){ return worst(devicesFor(station).map(d=>thresholds(d.lossPercent))); }

function renderHome(){
  title.textContent='Мониторинг связи АКП';
  const cards=equipment.stations.map(st=>{
    const ds=devicesFor(st), status=stationStatus(st), bad=ds.filter(d=>d.lossPercent>10).length, max=Math.max(...ds.map(d=>d.lossPercent),0);
    return `<a class="station-card" href="#station/${st.id}">
      <div class="station-top"><div><div class="station-name">${st.name}</div><div class="line">${st.line}</div></div><i class="dot big-status ${status}"></i></div>
      <div class="stats"><span>АКП с потерями &gt;10%: <b class="value">${bad}</b></span><span>max: <b class="value">${max.toFixed(1)}%</b></span></div>
    </a>`;
  }).join('');
  app.innerHTML=`<div class="summary"><div><h2>14 станций</h2><div class="muted">Нажмите на станцию, чтобы открыть линейки турникетов.</div></div><div class="muted">Сейчас включены демонстрационные проценты до импорта Excel.</div></div><section class="grid">${cards}</section>`;
}
function renderStation(id){
  const st=equipment.stations.find(x=>x.id===id); if(!st){location.hash='';return}
  title.textContent=st.name;
  const status=stationStatus(st);
  const panels=st.turnstileLines.map((line,li)=>{
    const ds=line.devices?.length?line.devices:demoDevices(st,li);
    const rows=ds.map(d=>`<tr><td>${d.akp||d.deviceId}${d.demo?'<span class="demo-badge">ДЕМО</span>':''}</td><td>${d.ip||'—'}</td><td><span class="status-cell"><i class="dot ${thresholds(d.lossPercent)}"></i>${d.lossPercent.toFixed(1)}%</span></td></tr>`).join('');
    return `<section class="line-panel"><h3>${line.name}</h3>${rows?`<table><thead><tr><th>№ турникета / АКП</th><th>IP</th><th>Потери связи</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">Нет оборудования в справочнике.</div>'}</section>`
  }).join('');
  app.innerHTML=`<a class="back" href="#">← Все станции</a><div class="station-header"><div><h2>${st.name}</h2><div class="muted">${st.line}</div></div><div class="station-status"><i class="dot big-status ${status}"></i><span>${status==='red'?'Есть критические потери':status==='yellow'?'Есть потери связи':'Связь в норме'}</span></div></div><div class="lines">${panels}</div>`;
}
function route(){ const m=location.hash.match(/^#station\/(.+)$/); m?renderStation(m[1]):renderHome(); }

fetch('data/equipment.json').then(r=>r.json()).then(d=>{equipment=d;route()}).catch(e=>{app.innerHTML='<div class="empty">Не удалось загрузить справочник оборудования.</div>'});
addEventListener('hashchange',route);
