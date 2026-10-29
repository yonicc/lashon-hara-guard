// Exercise native Worker fetch: Node fetch mocks do not enforce its receiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { BASETEN_URL, PUBLIC_MODEL } from '../src/baseten.js';
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { Miniflare } = require('miniflare');

test('direct Baseten provider calls native workerd fetch with a valid receiver', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lhg-baseten-worker-'));
  let mf: any;
  let calls = 0;
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, `
import { BasetenExtractorProvider } from ${JSON.stringify(resolve('src/baseten.ts'))};
export default { async fetch() {
  try {
    const result = await new BasetenExtractorProvider('synthetic-key').extract({
      messageId:'synthetic', platform:'gmail', direction:'outgoing',
      text:'Synthetic sample', normalizedText:'Synthetic sample',
      gateCues:[], catalogFactIds:[]
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({error:String(error)}, {status:500});
  }
}};
`);
    const bundle = await build({ entryPoints:[entry], bundle:true, write:false,
      format:'esm', platform:'neutral', external:['node:*'] });
    const config = readFileSync('wrangler.toml', 'utf8');
    mf = new Miniflare({ workers:[{
      config:{
        name:'baseten-test',
        compatibilityDate:config.match(/compatibility_date = "([^"]+)"/)![1],
        compatibilityFlags:JSON.parse(config.match(/compatibility_flags = (\[[^\n]+\])/)![1]!),
        manifest:{ mainModule:'worker.js', modules:{
          'worker.js':{type:'esm', contents:bundle.outputFiles[0].text}
        }}
      },
      dev:{ outboundService:{ type:'fetcher', handler:async (request: Request) => {
        calls++;
        assert.equal(request.url, BASETEN_URL);
        assert.equal(request.headers.get('authorization'), 'Bearer synthetic-key');
        assert.equal((await request.json() as {model:string}).model, PUBLIC_MODEL);
        return Response.json({choices:[{finish_reason:'stop', message:{
          content:JSON.stringify({proposedFacts:[], directAssessment:'no_concern'})
        }}]});
      }}}
    }]});
    const response = await mf.dispatchFetch('https://synthetic.test');
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(calls, 1);
    assert.deepEqual(result, {proposedFacts:[], directAssessment:'no_concern'});
  } finally {
    if (mf) await mf.dispose();
    rmSync(dir, {recursive:true, force:true});
  }
});
