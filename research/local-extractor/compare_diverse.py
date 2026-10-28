"""Compare new experiments on identical corpora using the canonical scorer."""
import json,pathlib
from score import summary
ROOT=pathlib.Path(__file__).parent
def main():
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--tags",nargs="+",default=["e6r-diverse-4b-20261028","e6-diverse-7b-20261028"])
 args=parser.parse_args()
 output={"scope":"Eight aliases only. Synthetic and human_review_pending. Not percentage of full cloud capability.","runs":{}}
 for tag in args.tags:
  data=json.loads((ROOT/"results"/f"{tag}-gpu.json").read_text())
  rows=data["evaluation_rows"]
  for name,predictions in data["runs"].items():
   byid={p["id"]:p for p in predictions}
   sets={}
   for split in ["sealed_v2","development"]:
    selected=[r for r in rows if (r["split"]=="sealed_v2")==(split=="sealed_v2")]
    scored=summary(selected,[byid[r["id"]] for r in selected])
    sets[split]={"groups":scored["groups"],"validation_errors":scored["validation_errors"]}
   output["runs"][name]={"tag":tag,"sets":sets}
  output.setdefault("compute",{})[tag]={k:data[k] for k in ["gpu","training","gpu_function_seconds","total_gpu_function_seconds","revisions"]}
  # A10 + four CPU cores + requested 24 GiB. Estimate, NOT an invoice; startup/CPU may differ.
  output["compute"][tag]["nominal_compute_estimate_usd"]=round(
      data["total_gpu_function_seconds"]*(0.000306+4*0.0000131+24*0.00000222),3)
 output["cost_note"]="2026-10-28 Modal list rates; memory/CPU billed usage may differ. Excludes image building, storage, idle/startup."
 output["incremental_weight_storage_note"]="7B cache plus merged 4B/7B weights remain on Volume lhg-models. Storage billed separately; no local model download."
 (ROOT/"results/e6-comparison.json").write_text(json.dumps(output,ensure_ascii=False,indent=1),encoding="utf-8")
 for name,r in output["runs"].items():
  print(name)
  for split,s in r["sets"].items():
   for group in ["all","language:he","language:en","language:mixed"]:
    print(split,group,s["groups"][group])
 print("COMPUTE",json.dumps(output["compute"],indent=1))
if __name__=="__main__":main()
