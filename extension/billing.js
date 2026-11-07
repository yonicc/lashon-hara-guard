// Receipts describe this operation only; cached checks never repeat a charge.
(() => {
  function read(raw) {
    if (!raw) return null;
    const valid = ['captured', 'released', 'cached', 'not_charged'].includes(raw.status) &&
      Number.isSafeInteger(raw.chargedAgorot) && raw.chargedAgorot >= 0 &&
      (raw.status === 'captured' || raw.chargedAgorot === 0);
    return valid ? { status: raw.status, chargedAgorot: raw.chargedAgorot }
      : { status: 'unknown', chargedAgorot: null };
  }
  function add(total, raw) {
    const receipt = read(raw);
    if (!receipt) return total;
    if (!total) return receipt;
    if (total.status === 'unknown' || receipt.status === 'unknown')
      return { status: 'unknown', chargedAgorot: null };
    const amount = total.chargedAgorot + receipt.chargedAgorot;
    return Number.isSafeInteger(amount)
      ? { status: total.status === 'captured' || receipt.status === 'captured' ? 'captured' : receipt.status, chargedAgorot: amount }
      : { status: 'unknown', chargedAgorot: null };
  }
  const api = { read, add };
  globalThis.LHG_BILLING = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
