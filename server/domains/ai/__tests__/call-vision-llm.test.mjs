import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallVisionLLM, createCallVisionLLMVideo } from '../call-vision-llm.js';
import {
  buildVisionContentParts,
  callVisionLLMBody,
  callVisionLLMVideoBody,
  extractDashScopeMultimodalText,
} from '../call-vision-llm-helpers.js';

test('buildVisionContentParts array / url / file / invalid', () => {
  const arr = buildVisionContentParts(
    [
      { type: 'text', text: 'a' },
      { type: 'image', image_url: 'http://x/y.jpg' },
      { type: 'image_url', image_url: { url: 'http://z' } },
    ],
    ''
  );
  assert.equal(arr.content.length, 3);

  const url = buildVisionContentParts('https://img/a.png', 'desc');
  assert.equal(url.content[0].type, 'image_url');
  assert.equal(url.content[1].text, 'desc');

  const file = buildVisionContentParts('/tmp/x.jpg', 'p', {
    readFileSync: () => Buffer.from('abc'),
    extname: () => '.jpg',
  });
  assert.match(file.content[0].image_url.url, /^data:image\/jpg;base64,/);

  const bad = buildVisionContentParts([], '');
  assert.equal(bad.early.error, 'invalid_vision_input');
});

test('extractDashScopeMultimodalText', () => {
  assert.equal(extractDashScopeMultimodalText(null), '');
  assert.equal(
    extractDashScopeMultimodalText({
      choices: [{ message: { content: [{ text: 'hi' }, { text: '!' }] } }],
    }),
    'hi!'
  );
  assert.equal(
    extractDashScopeMultimodalText({ choices: [{ message: { content: 'plain' } }] }),
    'plain'
  );
});

test('createCallVisionLLM success / no key / retry then fail', async () => {
  const prev = {
    ARK_API_KEY: process.env.ARK_API_KEY,
    DOUBAO_API_KEY: process.env.DOUBAO_API_KEY,
  };
  process.env.ARK_API_KEY = 'ak';
  try {
    const track = [];
    const call = createCallVisionLLM({
      loadTenantAiConfig: async () => null,
      getOpsVisionModel: () => 'ep-1',
      axios: {
        post: async () => ({
          data: { choices: [{ message: { content: 'vision-ok' } }] },
        }),
      },
      trackLLMResult: (ok) => track.push(ok),
    });
    const ok = await call('https://img/a.png', 'what');
    assert.equal(ok.ok, true);
    assert.equal(ok.content, 'vision-ok');
    assert.deepEqual(track, [true]);

    delete process.env.ARK_API_KEY;
    delete process.env.DOUBAO_API_KEY;
    const noKey = await createCallVisionLLM({
      loadTenantAiConfig: async () => null,
      getOpsVisionModel: () => 'ep-1',
      axios: { post: async () => ({}) },
      trackLLMResult: () => {},
    })('https://img/a.png', 'what');
    assert.equal(noKey.error, 'no_api_key');

    process.env.ARK_API_KEY = 'ak';
    let n = 0;
    const fail = await callVisionLLMBody(
      {
        loadTenantAiConfig: async () => null,
        getOpsVisionModel: () => 'ep-1',
        axios: {
          post: async () => {
            n += 1;
            throw Object.assign(new Error('boom'), { response: { status: 500 } });
          },
        },
        trackLLMResult: (ok) => track.push(ok),
        log: { warn() {}, error() {} },
      },
      'https://img/a.png',
      'x'
    );
    assert.equal(fail.ok, false);
    assert.ok(n >= 2);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('createCallVisionLLMVideo tenant skip / native / compatible fallback', async () => {
  const prevQ = process.env.QWEN_API_KEY;
  const prevA = process.env.ARK_API_KEY;
  try {
    const skip = await createCallVisionLLMVideo({
      loadTenantAiConfig: async () => ({ model: 'custom' }),
      axios: { post: async () => ({}) },
      trackLLMResult: () => {},
    })('http://v.mp4', 'p');
    assert.equal(skip.error, 'tenant_custom_ai_no_native_video');

    delete process.env.QWEN_API_KEY;
    const noKey = await createCallVisionLLMVideo({
      loadTenantAiConfig: async () => null,
      axios: { post: async () => ({}) },
      trackLLMResult: () => {},
    })('http://v.mp4', 'p');
    assert.equal(noKey.error, 'no_qwen_api_key');

    process.env.QWEN_API_KEY = 'qk';
    const noUrl = await createCallVisionLLMVideo({
      loadTenantAiConfig: async () => null,
      axios: { post: async () => ({}) },
      trackLLMResult: () => {},
    })('', 'p');
    assert.equal(noUrl.error, 'no_video_url');

    const native = await createCallVisionLLMVideo({
      loadTenantAiConfig: async () => null,
      axios: {
        post: async (url) => {
          if (url.includes('dashscope')) {
            return {
              data: {
                output: { choices: [{ message: { content: [{ text: 'vid' }] } }] },
              },
            };
          }
          throw new Error('should not');
        },
      },
      trackLLMResult: () => {},
    })('http://v.mp4', 'p');
    assert.equal(native.ok, true);
    assert.equal(native.content, 'vid');

    process.env.ARK_API_KEY = 'ak';
    let nativeTried = false;
    const fb = await callVisionLLMVideoBody(
      {
        loadTenantAiConfig: async () => null,
        axios: {
          post: async (url) => {
            if (url.includes('dashscope')) {
              nativeTried = true;
              throw new Error('native fail');
            }
            return { data: { choices: [{ message: { content: 'compat' } }] } };
          },
        },
        trackLLMResult: () => {},
        log: { error() {} },
      },
      'http://v.mp4',
      'p'
    );
    assert.equal(nativeTried, true);
    assert.equal(fb.ok, true);
    assert.equal(fb.content, 'compat');
  } finally {
    if (prevQ === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = prevQ;
    if (prevA === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = prevA;
  }
});
