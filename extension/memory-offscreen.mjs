import {LocalMemory} from './memory.mjs';
import {loadEmbed} from './memory-embedding.mjs';
const memory=new LocalMemory({name:'lhg-memory-v1',embed:async text=>(await loadEmbed())(text)});
let operations=Promise.resolve();
async function handle(m) {
  if(m.op==='install') {await loadEmbed();return {installed:true};}
  if(m.op==='clear') {await memory.clear();return {cleared:true};}
  if(m.op==='purge') {await memory.purge();return {purged:true};}
  if(m.op==='ingest') return memory.ingest(m.event);
  if(m.op==='delete') {await memory.deleteMessage(m.scope,m.sourceId);return {deleted:true};}
  if(m.op==='delete_conversation') {await memory.deleteConversation(m.scope);return {deleted:true};}
  if(m.op==='get_recent'||m.op==='search_history') return memory.tools(m.scope)[m.op](m.args);
  throw Error('unsupported-operation');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.target!=='lhg-memory-offscreen') return;
  // Offscreen accepts only the extension service worker, never a content frame.
  if(sender.id!==chrome.runtime.id || sender.tab || sender.url!==chrome.runtime.getURL('background.js')) {
    reply({ok:false,error:'untrusted-sender'});return;
  }
  const work=operations.then(()=>handle(m));
  operations=work.catch(()=>{});
  work.then(result=>reply({ok:true,result}),()=>reply({ok:false,error:'memory-unavailable'}));
  return true;
});
await memory.purge();
setInterval(()=>memory.purge().catch(()=>{}),60000);
