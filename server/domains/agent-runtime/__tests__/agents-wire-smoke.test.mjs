/**
 * Smoke: importing agents.js exercises the P17 wireAgentsRuntime cluster.
 * (Do not import wire.js as entry — circular deps with store-scoring → agents TDZ.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('agents.js wires runtime APIs via domains/agent-runtime/wire*.js', async () => {
  const agents = await import('../../../agents.js');
  assert.equal(typeof agents.handleAgentMessage, 'function');
  assert.equal(typeof agents.onFeishuEvent, 'function');
  assert.equal(typeof agents.callLLM, 'function');
  assert.equal(typeof agents.processBitableData, 'function');
  assert.equal(typeof agents.sendWeeklyReports, 'function');
  assert.equal(typeof agents.pollBitableSubmissions, 'function');
});
