// Trusted collector in the isolated content world. Model tools never select scope.
(() => {
  const ids=new WeakMap(), observed=new WeakMap(), drafts=new WeakMap();
  const session=crypto.randomUUID(), bound=new Map();
  let seq=0;
  function account(platform) {
    if(platform==='whatsapp-web') {
      try {
        const raw=localStorage.getItem('last-wid')||localStorage.getItem('last-wid-md');
        const wid=raw&&JSON.parse(raw);
        const value=typeof wid==='string'?wid:wid?._serialized;
        return /^\d+(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/.test(value||'')?value:null;
      } catch {return null;}
    }
    const nodes=document.querySelectorAll(globalThis.LHG_SELECTORS.memory.account);
    const emails=new Set();
    for(const node of nodes) {
      const value=node.getAttribute('data-email')||node.getAttribute('aria-label')||node.getAttribute('title')||'';
      const hits=value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/ig)||[];
      for(const email of hits) emails.add(email.toLowerCase());
    }
    return emails.size===1?[...emails][0]:null;
  }
  function scopeFor(platform,el,{draft=false}={}) {
    const accountId=account(platform);
    if(!accountId) return null;
    let conversationId;
    if(platform==='whatsapp-web') {
      // A title is never an identity. The message ID contains the remote JID.
      const root=globalThis.LHG_SELECTORS?.first(document,globalThis.LHG_SELECTORS.whatsapp.chatRoot);
      const node=root?.querySelector(globalThis.LHG_SELECTORS.memory.whatsappSource);
      const match=node?.getAttribute('data-id')?.match(/^(?:true|false)_([^_]+@(?:c\.us|g\.us|s\.whatsapp\.net))_/);
      conversationId=match?.[1];
    } else {
      const root=el?.closest?.(globalThis.LHG_SELECTORS.memory.conversation);
      conversationId=root?.getAttribute('data-thread-id')||root?.getAttribute('data-space-id')||root?.getAttribute('data-group-id');
    }
    if(!conversationId && draft) {
      if(!ids.has(el)) ids.set(el,'compose-'+session+'-'+(++seq));
      conversationId=ids.get(el);
    }
    return conversationId?{platform,accountId,conversationId}:null;
  }
  const send=data=>chrome.runtime.sendMessage({type:'lhg-memory',...data});
  const queue=new Map();
  function deliver(data) {try {Promise.resolve(send(data)).catch(()=>{});}catch{}}
  function emit(data) {
    const key=JSON.stringify([data.event?.scope||data.scope,data.event?.sourceId||data.sourceId]);
    const old=queue.get(key);if(old) clearTimeout(old.timer);
    queue.delete(key);
    if(data.op!=='ingest') {deliver(data);return;}
    const timer=setTimeout(()=>{queue.delete(key);deliver(data);},150);
    queue.set(key,{data,timer});
    if(queue.size>100) {const [first,item]=queue.entries().next().value;clearTimeout(item.timer);queue.delete(first);deliver(item.data);}
  }
  function flush() {for(const {data,timer} of queue.values()) {clearTimeout(timer);deliver(data);}queue.clear();}
  globalThis.addEventListener?.('pagehide',flush);
  document.addEventListener('focusout',flush,true);
  function input(platform,el,text) {
    if(globalThis.LHG_SETTINGS?.get().lhgMemoryEnabled!==true) return;
    if(globalThis.LHG_SETTINGS&&!LHG_SETTINGS.isActive(platform)) return;
    const scope=scopeFor(platform,el,{draft:true});if(!scope) return;
    if(!ids.has(el)) ids.set(el,'compose-'+session+'-'+(++seq));
    const sourceId=ids.get(el), signature=JSON.stringify([scope,sourceId]);
    const previous=drafts.get(el);
    if(previous && JSON.stringify(previous)!==JSON.stringify(scope)) emit({op:'delete',scope:previous,sourceId});
    drafts.set(el,scope);
    // Clearing removes a draft; never infer that it was sent.
    if(!text.trim()) {emit({op:'delete',scope,sourceId});return;}
    if(bound.get(signature)===text) return;
    bound.set(signature,text);if(bound.size>100) bound.delete(bound.keys().next().value);
    emit({op:'ingest',event:{scope,sourceId,text,type:'input_observed',direction:'outgoing',observedAt:Date.now()}});
  }
  function context(platform,el,text,direction='incoming') {
    if(globalThis.LHG_SETTINGS?.get().lhgMemoryEnabled!==true) return;
    if(globalThis.LHG_SETTINGS&&!LHG_SETTINGS.isActive(platform)) return;
    const scope=scopeFor(platform,el);if(!scope||!text?.trim()) return;
    const source=el?.closest?.(globalThis.LHG_SELECTORS.memory.source)||el;
    const sourceId=source?.getAttribute?.('data-message-id')||source?.getAttribute?.('data-legacy-message-id')||source?.getAttribute?.('data-id');
    if(!sourceId) return;
    const signature=JSON.stringify([scope,sourceId,text,direction]);
    if(observed.get(source)===signature) return;
    observed.set(source,signature);
    emit({op:'ingest',event:{scope,sourceId,text,type:'context_observed',direction,observedAt:Date.now()}});
  }
  function tools(platform,el) {
    const scope=scopeFor(platform,el,{draft:true});if(!scope) return null;
    // No account/conversation properties are taken from model arguments.
    const read=async(op,args)=>{
      const r=await send({op,scope,args});if(!r?.ok) throw Error('memory-unavailable');return r.result;
    };
    return Object.freeze({get_recent:args=>read('get_recent',args),search_history:args=>read('search_history',args)});
  }
  globalThis.LHG_MEMORY={input,context,tools,scopeFor};
})();
