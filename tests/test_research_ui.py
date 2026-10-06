import subprocess
from pathlib import Path

from job_intel_tracker import app


def test_request_ui_repeated_interrupted_conflict_and_safe_rendering():
    script = r"""
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.value='';this.disabled=false;}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attributes[k]=v;}
 set innerHTML(value){throw Error('Untrusted HTML rendering');}
}
let seq=0;const ctx={document:{createElement:tag=>new Element(tag)},structuredClone,crypto:{randomUUID:()=>`synthetic-key-${++seq}`}};
vm.createContext(ctx);
for (const file of process.argv.slice(1))vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
const flat=n=>[n,...n.children.flatMap(flat)],tick=()=>new Promise(resolve=>setImmediate(resolve));
const request={id:'synthetic-request',job:'synthetic-job',version:1,package:'full_package',status:'queued',created_by:'owner',created_at:1,note:'<img src=x onerror=untrusted()>',missing_deliverables:['research','resume','cover_letter','interview_prep'],artifacts:[],events:[{actor:'owner',action:'request',version:1,timestamp:1,reason:''}]};
(async()=>{
 let calls=[],messages=[],lost=true;
 const api=async(path,opts)=>{
  if(!opts)return [request];
  calls.push({path,opts:structuredClone(opts)});
  if(lost){lost=false;throw Error('Synthetic lost response');}
  return request;
 };
 const root=ctx.TrackerResearchUI.panel({id:'synthetic-job'},{api,message:x=>messages.push(x),owner:true});
 await tick();let all=flat(root);
 assert.ok(all.some(n=>n.textContent==='Missing deliverables: research, resume, cover_letter, interview_prep'));
 assert.ok(all.some(n=>n.textContent===request.note));
 const form=all.find(n=>n.tag==='form'),fields=all.find(n=>n.tag==='fieldset'),select=all.find(n=>n.tag==='select'),note=all.find(n=>n.tag==='textarea');
 assert.equal(select.value,'full_package');note.value='Synthetic first instruction';
 await form.onsubmit({preventDefault(){}});assert.equal(fields.disabled,true);
 select.value='research';note.value='Mutated after uncertain response';
 await form.onsubmit({preventDefault(){}});
 assert.deepEqual(calls[0],calls[1]);assert.equal(JSON.parse(calls[1].opts.body).package,'full_package');assert.equal(fields.disabled,false);
 let release;const delayed=new Promise(resolve=>release=resolve);let count=0;
 const busy=ctx.TrackerResearchUI.panel({id:'synthetic-job'},{owner:true,message:()=>{},api:async(path,opts)=>{
  if(!opts)return [];count++;await delayed;return request;
 }});
 const busyForm=flat(busy).find(n=>n.tag==='form');const first=busyForm.onsubmit({preventDefault(){}});
 await busyForm.onsubmit({preventDefault(){}});assert.equal(count,1);release();await first;
 const denied=ctx.TrackerResearchUI.panel({id:'synthetic-job'},{owner:true,message:x=>messages.push(x),api:async(path,opts)=>{
  if(!opts)return [request];throw Object.assign(Error('Synthetic conflict'),{status:409});
 }});
 const deniedForm=flat(denied).find(n=>n.tag==='form');await deniedForm.onsubmit({preventDefault(){}});
 assert.equal(flat(denied).find(n=>n.tag==='fieldset').disabled,false);
 assert.ok(flat(denied).some(n=>n.textContent==='An open request exists. Review or cancel it before changing the package.'));
 await tick();const cancel=flat(denied).find(n=>n.tag==='button'&&n.textContent==='Cancel request');await cancel.onclick();
 assert.equal(messages.at(-1),'Request changed. Refresh and compare before acting again.');
 const readOnly=ctx.TrackerResearchUI.panel({id:'synthetic-job'},{owner:false,message:()=>{},api:async()=>[request]});await tick();
 assert.equal(flat(readOnly).some(n=>n.tag==='form'||n.tag==='button'),false);
 for (const prior of ['success','conflict','uncertain']) {
  let current=structuredClone(request);
  const feedback=ctx.TrackerResearchUI.panel({id:'synthetic-job'},{owner:true,message:()=>{},api:async(path,opts)=>{
   if(!opts)return [current];
   if(path.endsWith('/cancel')){current={...current,status:'cancelled',version:2};return current;}
   if(prior==='conflict')throw Object.assign(Error('Synthetic conflict'),{status:409});
   if(prior==='uncertain')throw Error('Synthetic lost response');
   return current;
  }});
  await tick();let nodes=flat(feedback);
  const feedbackForm=nodes.find(n=>n.tag==='form'),feedbackStatus=nodes.find(n=>n.attributes.role==='status');
  const draft=nodes.find(n=>n.tag==='textarea');draft.value='Preserve unsent instructions';
  await feedbackForm.onsubmit({preventDefault(){}});assert.ok(feedbackStatus.textContent);
  const cancel=flat(feedback).find(n=>n.tag==='button'&&n.textContent==='Cancel request');await cancel.onclick();
  assert.equal(draft.value,'Preserve unsent instructions');
  if(prior==='uncertain'){
   assert.ok(feedbackStatus.textContent.startsWith('Response uncertain.'));assert.equal(nodes.find(n=>n.tag==='fieldset').disabled,true);
  }else assert.equal(feedbackStatus.textContent,'');
 }
 console.log('PASS uncertain retry identity, repeated-submit guard, conflict recovery, owner controls, missing artifacts and safe text');
})().catch(error=>{console.error(error);process.exit(1);});
"""
    static = Path(app.__file__).parent / "static"
    subprocess.run(
        ["node", "-e", script, str(static / "planning-ui.js"), str(static / "research-ui.js")],
        capture_output=True,
        text=True,
        check=True,
    )
