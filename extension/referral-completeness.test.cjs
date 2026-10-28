const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('referral normalization preserves all 73 sections and the full fact catalog', () => {
 const ctx = vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'rules.js'),'utf8'),ctx);
 const facts=Array.from({length:166},(_,i)=>({id:'synthetic.'+i,questionHe:'Fact '+i,valueHe:'candidate: yes',provenanceHe:'synthetic'}));
 const referrals=Array.from({length:73},(_,i)=>({
  sectionKey:'synthetic:'+i,questionHe:'Open question '+i+'?',sourceRef:'Synthetic source '+i,
  sourceUrl:'https://www.sefaria.org/synthetic',gatheredFacts:facts,
  quotesHe:Array.from({length:7},(_,j)=>'Quote '+j),
  uncertainHe:Array.from({length:12},(_,j)=>'Doubt '+j)
 }));
 const result=ctx.LHG_RULES.readRules({rules:{mode:'live_draft',findings:[],referrals}});
 assert.equal(result.referrals.length,73);
 for(const r of result.referrals) {
  assert.equal(r.gatheredFacts.length,166);
  assert.equal(r.gatheredFacts[165].id,'synthetic.165');
  assert.equal(r.quotesHe.length,7);
  assert.equal(r.uncertainHe.length,12);
 }
});
