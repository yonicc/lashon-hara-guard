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
  const optionsSender=s=>s.id===chrome.runtime.id && !s.tab?.incognito && s.url===chrome.runtime.getURL('options.html');
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m?.type!=='lhg-memory') return;
    (async()=>{
      const admin=optionsSender(s);
      if(admin && ['install','clear'].includes(m.op)) return relay({op:m.op});
      if(!['ingest','delete','delete_conversation','get_recent','search_history'].includes(m.op)) throw Error('unsupported-operation');
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
