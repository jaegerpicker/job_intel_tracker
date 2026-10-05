import subprocess
from pathlib import Path

from job_intel_tracker import app


def test_actual_planning_editor_and_interrupted_pending_operations():
    script = r"""
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.value='';this.disabled=false;}
 append(...children){this.children.push(...children);}
 setAttribute(k,v){this.attributes[k]=v;}
 set innerHTML(value){throw Error('Untrusted HTML rendering');}
}
let sequence=0;const context={document:{createElement:tag=>new Element(tag)},structuredClone,
 crypto:{randomUUID:()=>`synthetic-operation-${++sequence}`}};
vm.createContext(context);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);
const api=context.TrackerPlanningUI;
assert.equal(api.capacityNote({counts:{open_applications:15},policy:{open_application_limit:16},warnings:[]}), 'Recording stays available');
assert.equal(api.capacityNote({warnings:[{code:'weekly_new'},{code:'pilot_review'}]}), 'Recording stays available');
assert.equal(api.capacityNote(null), 'Recording stays available');
for (const count of [15,16]) {
 assert.equal(api.capacityNote({counts:{open_applications:count},policy:{open_application_limit:15},warnings:[{code:'open_applications'}]}), 'Planning warning; recording stays available');
}
const record={id:'synthetic-job',kind:'job',version:3,body:{stage:'Applied',title:'Synthetic',company:'Example',custom:'Preserve',tracking:{contacts:[]}}};
const flat=node=>[node,...node.children.flatMap(flat)];
(async()=>{
 let calls=[];
 const pending=api.pendingWrite(async (r,key)=>{
   calls.push({r:structuredClone(r),key});if(calls.length===1)throw Error('Synthetic lost response');return {version:4};
 });
 const original=structuredClone(record);
 await assert.rejects(pending.commit(original));assert.equal(pending.unresolved(),true);
 original.body.title='Changed after lost response';
 await pending.commit(original);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].r.body.title,'Synthetic');assert.equal(pending.unresolved(),false);
 let keys=[];const rejected=api.pendingWrite(async(r,key)=>{keys.push(key);throw Object.assign(Error('Synthetic conflict'),{status:409});});
 await assert.rejects(rejected.commit(record));assert.equal(rejected.unresolved(),false);
 await assert.rejects(rejected.commit(record));assert.notEqual(keys[0],keys[1]);
 const saved=[],messages=[];
 const root=api.editor(record,{reasons:[]},{today:'2026-10-05',owner:true,
   save:async(r,override,key)=>{saved.push(structuredClone(r));assert.equal(override,false);assert.ok(key);},
   refresh:async()=>{},message:value=>messages.push(value)});
 const all=flat(root),forms=all.filter(n=>n.tag==='form');
 const find=label=>all.find(n=>n.attributes['aria-label']===label);
 assert.equal(find('Application date (unknown if blank)').value,'');
 assert.equal(find('Contact date (enter only if known)').value,'');
 assert.equal(find('Contact kind').required,true);
 await forms[0].onsubmit({preventDefault(){}});
 assert.equal(saved[0].body.tracking.applied_on,null);assert.equal(saved[0].body.custom,'Preserve');
 assert.equal(saved[0].version,3);assert.equal(record.body.tracking.contacts.length,0);
 find('Contact date (enter only if known)').value='2026-09-30';find('Contact kind').value='receipt';
 find('Contact evidence source').value='Synthetic automated receipt';
 find('Contact summary').value='<img src=x onerror=untrusted()>';
 await forms[1].onsubmit({preventDefault(){}});
 assert.equal(saved[1].body.tracking.contacts[0].kind,'receipt');
 assert.equal(saved[1].body.tracking.contacts[0].on,'2026-09-30');
 const park=all.find(n=>n.tag==='button'&&n.textContent==='Park attention; keep application open');
 await park.onclick();assert.equal(saved[2].body.stage,'Applied');assert.equal(saved[2].body.tracking.review.decision,'park');
 assert.equal(saved[2].body.tracking.review.on,'2026-10-05');
 const agent=api.editor(record,null,{today:'2026-10-05',owner:false});
 assert.equal(flat(agent).some(n=>n.textContent==='Keep waiting'),false);
 const malformed=structuredClone(record);malformed.body.tracking={contacts:'invalid legacy observations'};
 const before=JSON.stringify(malformed);
 const repair=api.editor(malformed,{reasons:['Invalid legacy tracking; no dates inferred'],tracking:{}},{owner:true});
 assert.equal(flat(repair).some(n=>n.tag==='form'),false);assert.equal(JSON.stringify(malformed),before);
 let release;const delayed=new Promise(resolve=>{release=resolve;});let count=0;
 const busyRoot=api.editor(record,null,{today:'2026-10-05',owner:true,save:async()=>{count++;await delayed;},refresh:async()=>{},message:()=>{}});
 const busyForm=flat(busyRoot).find(n=>n.tag==='form');const first=busyForm.onsubmit({preventDefault(){}});
 await busyForm.onsubmit({preventDefault(){}});assert.equal(count,1);
 release();await first;
 console.log('PASS explicit unknowns/provenance, safe rendering, actor controls, stage preservation, identical interrupted replay, conflict and double-submit handling');
})().catch(error=>{console.error(error);process.exit(1);});
"""
    source = Path(app.__file__).parent / "static" / "planning-ui.js"
    subprocess.run(["node", "-e", script, str(source)], capture_output=True, text=True, check=True)
