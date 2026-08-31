const fs = require('node:fs/promises');
const path = require('node:path');

const STALE_AFTER_MS = 12 * 60 * 1000;

function statusFor(measurement, now = Date.now()) {
  if (!measurement || now - Date.parse(measurement.measuredAt) > STALE_AFTER_MS) return 'gray';
  if (measurement.lossPercent > 30) return 'red';
  if (measurement.lossPercent > 10) return 'yellow';
  return 'green';
}

function isIsoGmt7(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+07:00$/.test(value) && !Number.isNaN(Date.parse(value));
}

function validatePacket(packet) {
  const errors = [];
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return ['Body must be a JSON object'];
  if (packet.source !== 'novosibirsk-metro') errors.push('source must be "novosibirsk-metro"');
  if (!isIsoGmt7(packet.generatedAt)) errors.push('generatedAt must be ISO 8601 with +07:00 timezone');
  if (packet.measurementWindowSeconds !== 300) errors.push('measurementWindowSeconds must be 300');
  if (!Array.isArray(packet.measurements) || packet.measurements.length === 0) {
    errors.push('measurements must be a non-empty array');
    return errors;
  }
  if (packet.measurements.length > 5000) errors.push('measurements may contain at most 5000 items');
  const seen = new Set();
  packet.measurements.forEach((m, i) => {
    const at = `measurements[${i}]`;
    if (!m || typeof m !== 'object') return errors.push(`${at} must be an object`);
    if (typeof m.deviceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(m.deviceId)) errors.push(`${at}.deviceId is invalid`);
    if (m.ip !== undefined && (typeof m.ip !== 'string' || m.ip.length > 64)) errors.push(`${at}.ip is invalid`);
    if (typeof m.lossPercent !== 'number' || !Number.isFinite(m.lossPercent) || m.lossPercent < 0 || m.lossPercent > 100) errors.push(`${at}.lossPercent must be between 0 and 100`);
    if (!isIsoGmt7(m.measuredAt)) errors.push(`${at}.measuredAt must be ISO 8601 with +07:00 timezone`);
    const key = `${m.deviceId}\u0000${m.measuredAt}`;
    if (seen.has(key)) errors.push(`${at} duplicates deviceId + measuredAt in this packet`);
    seen.add(key);
  });
  return errors;
}

class TelemetryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.latestPath = path.join(dataDir, 'latest.json');
    this.historyPath = path.join(dataDir, 'history.ndjson');
    this.latest = new Map();
    this.keys = new Set();
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(this.latestPath, 'utf8'));
      Object.values(saved).forEach(item => this.latest.set(item.deviceId, item));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const lines = (await fs.readFile(this.historyPath, 'utf8')).split('\n').filter(Boolean);
      lines.forEach(line => {
        const item = JSON.parse(line);
        this.keys.add(`${item.deviceId}\u0000${item.measuredAt}`);
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  ingest(packet, receivedAt = new Date().toISOString()) {
    this.writeQueue = this.writeQueue.then(async () => {
      const accepted = [];
      let duplicates = 0;
      for (const raw of packet.measurements) {
        const key = `${raw.deviceId}\u0000${raw.measuredAt}`;
        if (this.keys.has(key)) { duplicates += 1; continue; }
        const item = { deviceId: raw.deviceId, ...(raw.ip ? { ip: raw.ip } : {}), lossPercent: raw.lossPercent, measuredAt: raw.measuredAt, receivedAt };
        accepted.push(item);
        this.keys.add(key);
        const previous = this.latest.get(item.deviceId);
        if (!previous || Date.parse(item.measuredAt) >= Date.parse(previous.measuredAt)) this.latest.set(item.deviceId, item);
      }
      if (accepted.length) await fs.appendFile(this.historyPath, accepted.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
      const temp = `${this.latestPath}.tmp`;
      await fs.writeFile(temp, JSON.stringify(Object.fromEntries(this.latest), null, 2), 'utf8');
      await fs.rename(temp, this.latestPath);
      return { accepted: accepted.length, duplicates };
    });
    return this.writeQueue;
  }

  getLatest(now = Date.now()) {
    return [...this.latest.values()].map(item => ({ ...item, status: statusFor(item, now), stale: statusFor(item, now) === 'gray' }));
  }

  async getHistory(deviceId, from, to, limit = 1000) {
    let text;
    try { text = await fs.readFile(this.historyPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item =>
      (!deviceId || item.deviceId === deviceId) && (!from || Date.parse(item.measuredAt) >= Date.parse(from)) && (!to || Date.parse(item.measuredAt) <= Date.parse(to))
    ).slice(-limit).reverse();
  }
}

module.exports = { STALE_AFTER_MS, TelemetryStore, statusFor, validatePacket };
