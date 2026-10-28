"""Exercise actual trainer interruption/resume on a tiny randomly initialized model."""
import json,pathlib,sys
import modal
ROOT=pathlib.Path(__file__).parent
sys.path.insert(0,str(ROOT))
from diverse_modal import image
image=image.add_local_file(ROOT/"diverse_modal.py","/root/diverse_modal.py")
app=modal.App("lhg-extractor-checkpoint-smoke")
vol=modal.Volume.from_name("lhg-models")
@app.function(image=image,gpu="A10G",cpu=1,memory=4096,timeout=300,retries=0,max_containers=1,volumes={"/models":vol})
def check():
 import gc,shutil,types,uuid
 import torch,transformers,huggingface_hub
 import pilot_modal as pilot
 from safetensors.torch import load_file
 # This process/container is isolated from the real training experiments.
 class TinyTokenizer:
  pad_token_id=0
  eos_token_id=1
  eos_token="</s>"
  def apply_chat_template(self,*a,**kw):return "prompt"
  def __call__(self,text,**kw):return types.SimpleNamespace(input_ids=[2,3,4,5])
  def save_pretrained(self,path):pathlib.Path(path).mkdir(exist_ok=True,parents=True)
 def tiny(*a,**kw):
  config=transformers.Qwen2Config(vocab_size=16,hidden_size=16,intermediate_size=32,
   num_hidden_layers=1,num_attention_heads=2,num_key_value_heads=2,max_position_embeddings=64)
  return transformers.Qwen2ForCausalLM(config).to(dtype=torch.bfloat16)
 transformers.AutoTokenizer.from_pretrained=lambda *a,**kw:TinyTokenizer()
 transformers.AutoModelForCausalLM.from_pretrained=tiny
 huggingface_hub.model_info=lambda *a,**kw:types.SimpleNamespace(sha="synthetic-tiny")
 pilot.evaluate=lambda model,tok,rows,*a,**kw:[{"id":r["id"],"raw":"{}"} for r in rows]
 prefix="_checkpoint-smoke-"+uuid.uuid4().hex
 tags=[prefix+"-control",prefix+"-interrupted"]
 original_volume=pilot.volume
 class InterruptOnce:
  fired=False
  def commit(self):
   original_volume.commit()
   if not self.fired and (pathlib.Path("/models/local-extractor")/tags[1]/"training-checkpoint.pt").exists():
    self.fired=True
    raise InterruptedError("Deliberate test interruption after durable optimizer checkpoint")
 wrapper=InterruptOnce()
 pilot.volume=wrapper
 train=[{"text":str(i),"gold":{}} for i in range(8)]
 rows=[{"id":"synthetic"}]
 kw=dict(base="synthetic",big=None,train_batch=2,epochs=2,checkpoint_every=4)
 try:
  control=pilot.gpu_run.local(train,rows,{"facts":[]},tags[0],**kw)
  try:
   pilot.gpu_run.local(train,rows,{"facts":[]},tags[1],**kw)
   raise AssertionError("Interruption was not injected")
  except InterruptedError:pass
  gc.collect();torch.cuda.empty_cache()
  resumed=pilot.gpu_run.local(train,rows,{"facts":[]},tags[1],**kw)
  assert resumed["training"]["restored_checkpoint"] is True
  left=load_file(str(pathlib.Path("/models/local-extractor")/tags[0]/"merged/model.safetensors"))
  right=load_file(str(pathlib.Path("/models/local-extractor")/tags[1]/"merged/model.safetensors"))
  assert set(left)==set(right)
  for k in left:torch.testing.assert_close(left[k],right[k],rtol=0,atol=0)
  assert control["training"]["loss"]==resumed["training"]["loss"]
  again=pilot.gpu_run.local(train,rows,{"facts":[]},tags[1],**kw)
  assert again==resumed
  try:
   pilot.gpu_run.local(train+[{"text":"changed","gold":{}}],rows,{"facts":[]},tags[1],**kw)
   raise AssertionError("Mismatched resume was accepted")
  except ValueError as e:assert "input mismatch" in str(e)
  return {"status":"passed","model":"random tiny Qwen2, not a trained language model",
   "tensor_count":len(left),"weights_identical":True,"losses_identical":True,
   "tests":["durable forced interruption","optimizer/RNG/order resume parity",
            "idempotent completed result","reject changed input"],"gpu":torch.cuda.get_device_name(0)}
 finally:
  pilot.volume=original_volume
  for tag in tags:shutil.rmtree(pathlib.Path("/models/local-extractor")/tag,ignore_errors=True)
  original_volume.commit()
@app.function(image=image,cpu=1,memory=4096,timeout=60,retries=0,max_containers=1)
def json_probe():
 import torch
 return json.dumps({"torch":torch.__version__,"remote_type":type(torch.__version__).__name__})

@app.local_entrypoint()
def main(json_only:bool=False):
 if json_only:
  import importlib.util
  assert importlib.util.find_spec("torch") is None,"Probe requires the management-only client"
  result=json.loads(json_probe.remote())
  assert type(result["torch"]) is str
  result.update(status="passed",local_torch_installed=False)
  (ROOT/"results/e6-thin-client-json-smoke.json").write_text(json.dumps(result,indent=2))
  print(result)
  return
 result=check.remote()
 (ROOT/"results/e6-checkpoint-smoke.json").write_text(json.dumps(result,indent=2))
 print(result)
