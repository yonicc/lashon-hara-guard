// Firefox background-page memory owner. Firefox has no offscreen-document API,
// but its MV3 background is an event page: a real document with DOM,
// IndexedDB, Cache Storage and WebAssembly. The vault therefore runs here
// directly instead of in a separate offscreen document.
// Loaded only on the Firefox branch of memory-background.js via dynamic
// import(); sender/setting admission already happened there, so this module
// exposes direct calls and registers no message listener.
// NOTE: the optional local meaning decider is unsupported in the Firefox
// build (its ONNX Runtime is a threaded JSEP build and extension pages have
// no SharedArrayBuffer). Decider ops fail closed; see docs/52-firefox.md.
import {LocalMemory} from './memory.mjs';
import {loadEmbed} from './memory-embedding.mjs';
import {loadRouter} from './memory-router-model.mjs';
import {expandMemory} from './memory-router.mjs';
import {bounded} from './memory-router.mjs';
const memory=new LocalMemory({name:'lhg-memory-v1',embed:async text=>(await loadEmbed())(text)});
let operations=Promise.resolve();
async function handle(m) {
  if(m.op==='decider_install'||m.op==='decider_check') throw Error('decider-unsupported-firefox');
  if(m.op==='install') {await loadEmbed();return {installed:true};}
  if(m.op==='router_install') {await loadRouter();return {installed:true};}
  if(m.op==='clear') {await memory.clear();return {cleared:true};}
  if(m.op==='purge') {await memory.purge();return {purged:true};}
  if(m.op==='ingest') return memory.ingest(m.event);
  if(m.op==='route_context') return expandMemory({memory,scope:m.scope,text:m.text,
    route:async text=>(await loadRouter())(text)});
  if(m.op==='plan_context') {
    memory.tools(m.scope); // same scope validation, inference is read-only
    const labels = await bounded(async () => (await loadRouter())(m.text), 150);
    return {status:'ok', labels, candidates:[]};
  }
  if(m.op==='delete') {await memory.deleteMessage(m.scope,m.sourceId);return {deleted:true};}
  if(m.op==='delete_conversation') {await memory.deleteConversation(m.scope);return {deleted:true};}
  if(m.op==='get_recent'||m.op==='search_history') return memory.tools(m.scope)[m.op](m.args);
  // Viewer-only operations; the background admits them from extension pages only.
  if(m.op==='stats') return memory.stats();
  if(m.op==='list'||m.op==='search') return memory[m.op](m.args||{});
  if(m.op==='delete_message') {await memory.deleteMessage(m.scope,m.sourceId);return {deleted:true};}
  throw Error('unsupported-operation');
}
export async function handleDirect(m) {
  const work=operations.then(()=>handle(m));
  operations=work.catch(()=>{});
  return work;
}
await memory.purge();
setInterval(()=>memory.purge().catch(()=>{}),60000);
