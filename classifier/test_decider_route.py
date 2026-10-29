"""Pin the browser routing port to the ONE canonical gate_route semantics."""
import json,pathlib,subprocess,unittest
from gate_route import uses_second_model,combine
class BrowserRoute(unittest.TestCase):
 def test_port(self):
  root=pathlib.Path(__file__).resolve().parents[1]
  texts=["שלום","שלום a","Z","é","Ａ","α","Я","עברית 123","🙂","a\nב"]+[chr(i) for i in range(1024)]
  pairs=[[a,b] for a in (0,.1,.2,.5,.9,1) for b in (None,0,.2,.8,1)]
  code="import {usesSecondModel,combineProbability} from './extension/decider-route.mjs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify([x.texts.map(usesSecondModel),x.pairs.map(p=>combineProbability(...p))]));"
  actual=json.loads(subprocess.check_output(["node","--input-type=module","-e",code],input=json.dumps({"texts":texts,"pairs":pairs}).encode(),cwd=root))
  self.assertEqual(actual,[[uses_second_model(t) for t in texts],[combine(a,b) for a,b in pairs]])
if __name__=="__main__":unittest.main()
