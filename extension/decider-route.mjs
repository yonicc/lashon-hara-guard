// Port of classifier/gate_route.py; test_decider_route.py pins parity across Unicode.
export const usesSecondModel=text=>/[A-Za-z]/.test(text);
export const combineProbability=(he,ml)=>ml===null?he:Math.max(he,ml);
