import subprocess
from pathlib import Path

from job_intel_tracker import app


def test_agent_handoff_validation_recovery_and_double_submit():
    """Exercise the actual async submission handler with controlled browser/API failures."""
    script = r"""
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.argv[1], 'utf8');
const handler = source.slice(source.indexOf("$('#agent-create').onsubmit"), source.indexOf("$('#policy').onsubmit"));
function setup(options={}) {
 const status={textContent:''}, fields={disabled:false}, form={
   elements:{name:{value:options.name || 'Synthetic-pilot'}, days:{value:'7'}, all_jobs:{checked:true},
     jobs:{selectedOptions:[]}, approved:{checked:true}, passphrase:{value:'inert-passphrase-only'},
     confirmation:{value:'inert-passphrase-only'}},
   querySelectorAll:()=>[{value:'jobs:write'},{value:'contribute'}], checkValidity:()=>true, reset:()=>{}
 };
 let posts=0, downloads=0, lists=0;
 const context={credentialIssuing:false, demo:false, location:{origin:'https://synthetic.example'},
  $:s=>s==='#agent-create'?form:s==='#agent-create-fields'?fields:status,
  TrackerCredentialCapsule:{prepare:async()=>({}),seal:async()=>{
    if(options.sealError) throw Error('synthetic encryption failure'); return {ciphertext:'inert'};
  }},
  api:async(path,opts)=>{
    if(opts?.method==='POST') {
      posts++;
      if(options.deferred) await options.deferred;
      if(options.reject) throw Object.assign(Error('synthetic rejection'),{status:options.reject});
      if(options.network) throw Error('synthetic lost response');
      return {token:'inert-fixture-token'};
    }
    lists++;
    if(options.listError) throw Object.assign(Error('synthetic expired session'),{status:401});
    return [];
  },
  renderAgentList:()=>{}, Blob, URL:{createObjectURL:()=> 'blob:encrypted-fixture',revokeObjectURL:()=>{}},
  el:()=>({click:()=>{downloads++;}}),setTimeout:()=>{}
 };
 vm.createContext(context);vm.runInContext(handler,context);
 return {form,status,fields,submit:()=>form.onsubmit({preventDefault(){},currentTarget:form}),
   counts:()=>({posts,downloads,lists})};
}
(async()=>{
 for(const name of ['Name with spaces','owner','1invalid']) {
   const fixture=setup({name});await fixture.submit();
   assert.match(fixture.status.textContent,/unique credential name/);assert.equal(fixture.counts().posts,0);
 }
 for(const [reject,text] of [[409,/already exists/],[422,/settings were rejected/],[401,/not authorized/],[403,/not authorized/]]) {
   const fixture=setup({reject});await fixture.submit();
   assert.match(fixture.status.textContent,text);assert.match(fixture.status.textContent,/No (new )?credential was created/);
   assert.equal(fixture.counts().posts,1);assert.equal(fixture.counts().downloads,0);
   assert.equal(fixture.form.elements.passphrase.value,'');assert.equal(fixture.fields.disabled,false);
 }
 for(const failure of [{network:true},{sealError:true},{listError:true}]) {
   const fixture=setup(failure);await fixture.submit();
   assert.match(fixture.status.textContent,/Handoff interrupted/);
   assert.match(fixture.status.textContent,/revoke.*new name/);assert.equal(fixture.counts().posts,1);
 }
 let release;const deferred=new Promise(resolve=>{release=resolve;});
 const double=setup({deferred});const first=double.submit();await Promise.resolve();
 await double.submit();assert.equal(double.counts().posts,1);assert.equal(double.fields.disabled,true);
 release();await first;assert.equal(double.counts().posts,1);assert.equal(double.counts().downloads,1);
 assert.match(double.status.textContent,/download was blocked, revoke/);
 assert.equal(double.form.elements.approved.checked,false);
 console.log('PASS validation, rejection classification, cancellation recovery, ambiguous failure, double-submit suppression');
})().catch(error=>{console.error(error);process.exit(1);});
"""
    source = Path(app.__file__).parent / "static" / "app.js"
    subprocess.run(["node", "-e", script, str(source)], capture_output=True, text=True, check=True)
