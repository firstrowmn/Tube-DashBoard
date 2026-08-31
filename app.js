const app = document.getElementById('app');
const title = document.getElementById('page-title');
const NOVOSIBIRSK_TZ = 'Asia/Novosibirsk';
const STALE_AFTER_MS = 12 * 60 * 1000;
const API_BASE = (window.METRO_API_BASE_URL || '').replace(/\/$/, '');
const rank = { gray:0, green:1, yellow:2, red:3 };
let equipment;
let telemetry = new Map();
let apiAvailable = true;

function deviceStatus(device, now = Date.now()) {
  if (!device.measuredAt || Number.isNaN(Date.parse(device.measuredAt)) || now - Date.parse(device.measuredAt) > STALE_AFTER_MS) return 'gray';
  if (device.lossPercent > 30) return 'red';
  if (device.lossPercent > 10) return 'yellow';
  return 'green';
}
const worst = statuses => statuses.reduce((a, b) => rank[b] > rank[a] ? b : a, 'gray');

function formatActuality(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', { timeZone:NOVOSIBIRSK_TZ, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value)).replace(',', '') + ' (GMT+7)';
}

function placeholders(station, lineIndex) {
  const count = station.id === 'sportivnaya' ? 10 : 6;
  return Array.from({ length:count }, (_, i) => ({ deviceId:`DEMO-${station.id.slice(0,3).toUpperCase()}-${lineIndex + 1}-${String(i + 1).padStart(2, '0')}`, akp:`АКП ${i + 1}`, ip:'—', demo:true }));
}
function lineDevices(station, line, lineIndex) {
  return (line.devices?.length ? line.devices : placeholders(station, lineIndex)).map(device => ({ ...device, ...(telemetry.get(device.deviceId) || {}) }));
}
function devicesFor(station) { return station.turnstileLines.flatMap((line, i) => lineDevices(station, line, i)); }
function stationStatus(station) { return worst(devicesFor(station).map(deviceStatus)); }
function statusText(status) { return ({ red:'Есть критические потери', yellow:'Есть потери связи', green:'Связь в норме', gray:'Нет свежих данных' })[status]; }

function renderHome() {
  title.textContent = 'Мониторинг связи АКП';
  const cards = equipment.stations.map(station => {
    const devices = devicesFor(station), fresh = devices.filter(d => deviceStatus(d) !== 'gray'), status = stationStatus(station);
    const bad = fresh.filter(d => d.lossPercent > 10).length;
    const max = fresh.length ? `${Math.max(...fresh.map(d => d.lossPercent)).toFixed(1)}%` : '—';
    return `<a class="station-card" href="#station/${station.id}"><div class="station-top"><div><div class="station-name">${station.name}</div><div class="line">${station.line}</div></div><i class="dot big-status ${status}"></i></div><div class="stats"><span>${status === 'gray' ? 'Нет свежих данных' : `АКП с потерями &gt;10%: <b class="value">${bad}</b>`}</span><span>max: <b class="value">${max}</b></span></div></a>`;
  }).join('');
  const connection = apiAvailable ? '' : '<div class="api-warning">API временно недоступен. Показаны последние загруженные данные.</div>';
  app.innerHTML = `${connection}<div class="summary"><div><h2>${equipment.stations.length} станций</h2><div class="muted">Нажмите на станцию, чтобы открыть линейки турникетов.</div></div><div class="muted">Обновление раз в минуту · серый цвет — нет данных свежее 12 минут · GMT+7</div></div><section class="grid">${cards}</section>`;
}

function renderStation(id) {
  const station = equipment.stations.find(x => x.id === id);
  if (!station) { location.hash = ''; return; }
  title.textContent = station.name;
  const status = stationStatus(station);
  const panels = station.turnstileLines.map((line, i) => {
    const rows = lineDevices(station, line, i).map(device => {
      const state = deviceStatus(device), loss = state === 'gray' ? '—' : `${device.lossPercent.toFixed(1)}%`;
      return `<tr><td>${device.akp || device.deviceId}${device.demo ? '<span class="demo-badge">ДЕМО</span>' : ''}</td><td>${device.ip || '—'}</td><td><span class="status-cell"><i class="dot ${state}"></i>${loss}</span></td><td>${formatActuality(device.measuredAt)}</td></tr>`;
    }).join('');
    return `<section class="line-panel"><h3>${line.name}</h3><table><thead><tr><th>№ турникета / АКП</th><th>IP</th><th>Потери связи</th><th>Актуально на</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  app.innerHTML = `<a class="back" href="#">← Все станции</a><div class="station-header"><div><h2>${station.name}</h2><div class="muted">${station.line}</div></div><div class="station-status"><i class="dot big-status ${status}"></i><span>${statusText(status)}</span></div></div><div class="lines">${panels}</div>`;
}

function route() { const match = location.hash.match(/^#station\/(.+)$/); match ? renderStation(match[1]) : renderHome(); }
async function loadTelemetry() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/telemetry/latest`, { cache:'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    telemetry = new Map(data.measurements.map(item => [item.deviceId, item]));
    apiAvailable = true;
  } catch (error) { apiAvailable = false; console.warn('Telemetry API is unavailable:', error.message); }
  if (equipment) route();
}

Promise.all([fetch('data/equipment.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }), loadTelemetry()])
  .then(([catalog]) => { equipment = catalog; route(); })
  .catch(() => { app.innerHTML = '<div class="empty">Не удалось загрузить справочник оборудования.</div>'; });
setInterval(loadTelemetry, 60_000);
addEventListener('hashchange', route);
