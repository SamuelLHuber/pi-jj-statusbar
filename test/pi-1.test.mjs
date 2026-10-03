import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { load } from './pi-host.mjs';

test('JJ status does not replace native footer or snapshot working copy', async t => {
  const host = await load(resolve('extensions/jj-status.ts'));
  await host.emit('session_start');
  t.after(() => host.emit('session_shutdown'));
  assert.match(host.statuses.get('jj-status'), /^jj: /);
  await host.extension.commands.get('jj-status').handler('', host.ctx);
  assert.equal(host.statuses.get('jj-status'), undefined);
  await host.extension.commands.get('jj-status').handler('', host.ctx);
  assert.match(host.statuses.get('jj-status'), /^jj: /);
});

test('non-TUI sessions do not poll JJ', async () => {
  const host = await load(resolve('extensions/jj-status.ts'));
  host.ctx.mode = 'print';
  await host.emit('session_start');
  assert.equal(host.statuses.size, 0);
  await host.emit('session_shutdown');
});
