// Standalone research module. No chrome permissions, network, or live adapters.
const DAY = 86400000;
const MODEL = 'multilingual-e5-small-q8-384-v1';
const scopeKey = s => {
  if (!s || !['gmail','google-chat','whatsapp-web'].includes(s.platform) ||
      !['accountId','conversationId'].every(k => typeof s[k] === 'string' && s[k].length > 0 && s[k].length <= 200))
    throw Error('scope-required');
  return JSON.stringify([s.platform, s.accountId, s.conversationId]);
};
const request = r => new Promise((resolve,reject) => {
  r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
});
const complete = tx => new Promise((resolve,reject) => {
  tx.oncomplete=resolve; tx.onabort=tx.onerror=()=>reject(tx.error || Error('transaction-aborted'));
});
function vector(v) {
  const a=Array.from(v);
  if(a.length!==384 || a.some(x=>!Number.isFinite(x))) throw Error('invalid-vector');
  const n=Math.hypot(...a); if(!n) throw Error('zero-vector');
  return Float32Array.from(a,x=>x/n);
}
export class LocalMemory {
  constructor({embed, name='lhg-research-memory', now=Date.now, retentionDays=14, maxRecords=20000}) {
    if(typeof embed!=='function' || !(retentionDays>0 && retentionDays<=14) ||
       !Number.isInteger(maxRecords) || maxRecords<1 || maxRecords>20000) throw Error('invalid-config');
    Object.assign(this,{embed,name,now,retentionDays,maxRecords});
    this.tail=Promise.resolve();
  }
  serial(fn) {
    const next=this.tail.then(fn); this.tail=next.catch(()=>{}); return next;
  }
  async open() {
    if(this.db) return this.db;
    const r=indexedDB.open(this.name,1);
    r.onupgradeneeded=()=>{
      const store=r.result.createObjectStore('records',{keyPath:'id'});
      store.createIndex('scope','scope');
    };
    this.db=await request(r); this.db.onversionchange=()=>this.close(); return this.db;
  }
  async transaction(mode,fn) {
    const db=await this.open(), tx=db.transaction('records',mode), done=complete(tx);
    const result=await fn(tx.objectStore('records')); await done; return result;
  }
  async rows(scope) {
    return this.transaction('readonly',s=>request(s.index('scope').getAll(scope)));
  }
  // Trusted ingestion path only; never exposed as a model tool.
  ingest(event) {
    return this.serial(async()=>{
      const scope=scopeKey(event.scope);
      if(event.enabled!==true) return {stored:false,reason:'disabled'};
      const kinds={message_observed:'message',message_edited:'message',input_observed:'draft',context_observed:'context'};
      if(!Object.hasOwn(kinds,event.type)) throw Error('unsupported-event');
      if(typeof event.sourceId!=='string' || !event.sourceId || event.sourceId.length>200) throw Error('stable-source-id-required');
      if(!['incoming','outgoing'].includes(event.direction)) throw Error('invalid-direction');
      if(typeof event.text!=='string' || !event.text.trim() || event.text.length>1000) throw Error('invalid-text');
      if(!Number.isFinite(event.observedAt) || event.observedAt>this.now() ||
         event.observedAt<=this.now()-this.retentionDays*DAY) throw Error('expired-observation');
      const id=JSON.stringify([scope,event.sourceId]);
      const old=await this.transaction('readonly',s=>request(s.get(id)));
      const expiry=event.observedAt+this.retentionDays*DAY;
      if(old && old.text===event.text) return {stored:false,reason:'duplicate'};
      if(old && event.observedAt<old.observedAt) return {stored:false,reason:'stale'};
      const embedding=vector(await this.embed('passage: '+event.text));
      const row={id,scope,sourceId:event.sourceId,text:event.text,direction:event.direction,
        kind:kinds[event.type],
        observedAt:event.observedAt,expiresAt:old?Math.min(old.expiresAt,expiry):expiry,
        provenance:'dom_observed',status:'candidate',model:MODEL,embedding};
      // Text and embedding replace together; readers never see mismatched versions.
      await this.transaction('readwrite',async s=>{
        const all=await request(s.getAll());
        for(const r of all) if(r.expiresAt<=this.now()) s.delete(r.id);
        const live=all.filter(r=>r.expiresAt>this.now() && r.id!==id).sort((a,b)=>a.observedAt-b.observedAt);
        while(live.length>=this.maxRecords) s.delete(live.shift().id);
        s.put(row);
      });
      return {stored:true};
    });
  }
  deleteMessage(scope,sourceId) {
    const key=scopeKey(scope);
    return this.serial(()=>this.transaction('readwrite',s=>s.delete(JSON.stringify([key,sourceId]))));
  }
  deleteConversation(scope) {
    const key=scopeKey(scope);
    return this.serial(()=>this.transaction('readwrite',async s=>{
      for(const r of await request(s.index('scope').getAll(key))) s.delete(r.id);
    }));
  }
  clear() { return this.serial(()=>this.transaction('readwrite',s=>s.clear())); }
  purge() {
    return this.serial(()=>this.transaction('readwrite',async s=>{
      for(const r of await request(s.getAll())) if(r.expiresAt<=this.now()) s.delete(r.id);
    }));
  }
  // Application binds scope once. Model cannot choose another account/conversation.
  tools(scope) {
    const key=scopeKey(scope), valid=r=>r.expiresAt>this.now();
    const snippet=r=>({ref:r.sourceId,text:r.text.slice(0,300),direction:r.direction,kind:r.kind,
      provenance:r.provenance,status:r.status,observedAt:r.observedAt});
    return Object.freeze({
      get_recent:async({k=5}={})=>{
        if(!Number.isInteger(k)||k<1||k>5) throw Error('invalid-budget');
        await this.tail;
        return (await this.rows(key)).filter(valid).sort((a,b)=>b.observedAt-a.observedAt).slice(0,k).map(snippet);
      },
      search_history:async({query,top_k=3}={})=>{
        if(typeof query!=='string'||!query.trim()||query.length>300||
          !Number.isInteger(top_k)||top_k<1||top_k>3) throw Error('invalid-budget');
        const q=vector(await this.embed('query: '+query));
        await this.tail;
        return (await this.rows(key)).filter(r=>valid(r)&&r.model===MODEL).map(r=>{
          let score=0; for(let i=0;i<q.length;i++) score+=q[i]*r.embedding[i];
          return {...snippet(r),score};
        }).sort((a,b)=>b.score-a.score).slice(0,top_k);
      }
    });
  }
  close() { this.db?.close(); this.db=null; }
}
