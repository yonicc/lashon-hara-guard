const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('public package keeps only Baseten and normalizes saved personal model selections',()=>{
 const c=vm.createContext({LHG_PUBLIC_BUILD:true});c.globalThis=c;
 vm.runInContext(fs.readFileSync(path.join(__dirname,'check-mode.js'),'utf8'),c);
 const M=c.LHG_CHECK_MODE;
 assert.deepEqual(JSON.parse(JSON.stringify(M.CLOUD_MODELS.map(m=>m.id))),['muse-spark-open-1026']);
 assert.equal(M.normalize({lhgCloudModel:'claude-sonnet-5.5'}).lhgCloudModel,'muse-spark-open-1026');
});
