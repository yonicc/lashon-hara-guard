// Private bridge: validates senders/settings before waking the one vault owner.
(() => {
  let creating;
  const hosts={gmail:'mail.google.com','google-chat':'chat.google.com','whatsapp-web':'web.whatsapp.com'};
  async function offscreen() {
    const url=chrome.runtime.getURL('memory-offscreen.html');
    if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]})).length) return;
    if(!creating) creating=chrome.offscreen.createDocument({url:'memory-offscreen.html',reasons:['WORKERS'],justification:'Run local WASM text embeddings and the IndexedDB context vault.'}).finally(()=>{creating=null;});
    await creating;
  }
  async function relay(data) {
    await offscreen();
    // Listener registration follows module loading; ping/retry only the missing receiver.
    for(let i=0;i<20;i++) {
      try {return await chrome.runtime.sendMessage({...data,target:'lhg-memory-offscreen'});}
      catch(e) {if(!String(e).includes('Receiving end does not exist')) throw e;await new Promise(r=>setTimeout(r,50));}
    }
    throw Error('memory-unavailable');
  }
  function permittedSender(sender,platform) {
    if(sender.id!==chrome.runtime.id || !sender.tab || sender.incognito || sender.tab.incognito) return false;
    try {const u=new URL(sender.url);return u.protocol==='https:'&&u.hostname===hosts[platform];} catch {return false;}
  }
  // Extension pages only, matched by exact URL; a site's content script never qualifies.
  const pageSender=(s,page)=>s.id===chrome.runtime.id && !s.tab?.incognito && s.url===chrome.runtime.getURL(page);
  const optionsSender=s=>pageSender(s,'options.html');
  const adminSender=s=>optionsSender(s)||pageSender(s,'memory-viewer.html');
  // Cross-scope views and deletes for the owner's viewer; never for a content script.
  const ADMIN_OPS=['stats','list','search','delete_message','delete_conversation'];
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m?.type!=='lhg-memory') return;
    (async()=>{
      if(optionsSender(s) && ['install','clear'].includes(m.op)) return relay({op:m.op});
      if(ADMIN_OPS.includes(m.op)) {
        if(!adminSender(s)) throw Error('untrusted-sender');
        return relay({op:m.op,scope:m.scope,sourceId:m.sourceId,args:m.args});
      }
      if(!['ingest','delete','get_recent','search_history'].includes(m.op)) throw Error('unsupported-operation');
      const scope=m.event?.scope||m.scope;
      if(!scope||!permittedSender(s,scope.platform)) throw Error('untrusted-sender');
      const settings=await chrome.storage.local.get(['lhgMemoryEnabled','lhgEnabled','lhgPlatforms']);
      if(settings.lhgMemoryEnabled!==true||settings.lhgEnabled===false||settings.lhgPlatforms?.[scope.platform]===false)
        return {ok:false,error:'disabled'};
      if(m.op==='ingest') return relay({op:m.op,event:{...m.event,enabled:true}});
      return relay({op:m.op,scope,sourceId:m.sourceId,args:m.args});
    })().then(reply,e=>{console.warn('Local memory bridge:',e.message);reply({ok:false,error:'memory-unavailable'});});
    return true;
  });
})();
