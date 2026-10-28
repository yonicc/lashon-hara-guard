(() => {
  const mode = globalThis.LHG_CHECK_MODE;
  const transport = globalThis.LHG_OLLAMA_CLIENT;
  const engine = globalThis.LHG_OLLAMA_ENGINE;
  if (!mode || !transport || !engine) return;
  const client = transport.create();
  for (const id of Object.keys(transport.MODELS)) {
    mode.registerLocalEngine({
      id, available: () => client.available(id),
      check: req => engine.check(req, id, client),
    });
  }
})();
