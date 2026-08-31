const test = require('node:test');
const assert = require('node:assert/strict');
const { statusFor, validatePacket } = require('../server/telemetry');

test('status thresholds and stale data', () => {
  const now = Date.parse('2026-08-31T10:12:00Z');
  const item = lossPercent => ({ lossPercent, measuredAt:'2026-08-31T10:01:00Z' });
  assert.equal(statusFor(item(10), now), 'green');
  assert.equal(statusFor(item(10.1), now), 'yellow');
  assert.equal(statusFor(item(30), now), 'yellow');
  assert.equal(statusFor(item(30.1), now), 'red');
  assert.equal(statusFor(item(0), now + 61_001), 'gray');
  assert.equal(statusFor(null, now), 'gray');
});

test('validates a five-minute packet', () => {
  const packet = { source:'novosibirsk-metro', generatedAt:'2026-08-31T17:00:00+07:00', measurementWindowSeconds:300, measurements:[{ deviceId:'TID-123', ip:'10.0.0.1', lossPercent:4.2, measuredAt:'2026-08-31T17:00:00+07:00' }] };
  assert.deepEqual(validatePacket(packet), []);
  packet.measurements[0].lossPercent = 101;
  assert.match(validatePacket(packet).join(' '), /between 0 and 100/);
});
