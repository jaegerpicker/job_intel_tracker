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
 form.elements.handoff={value:options.direct?'secure-entry':'encrypted'};
 form.elements.secure_approved={checked:options.confirmed!==false};
 let posts=0, downloads=0, lists=0;
 let token='', response;
 const context={credentialIssuing:false, credentialHandoffGeneration:0, demo:!!options.demo, location:{origin:'https://synthetic.example'},
  $:s=>s==='#agent-create'?form:s==='#agent-create-fields'?fields:status,
  TrackerSecureHandoff:{clear:()=>{token='';},show:(value)=>{token=value;}},
  TrackerCredentialCapsule:{prepare:async()=>({}),seal:async()=>{
    if(options.sealError) throw Error('synthetic encryption failure'); return {ciphertext:'inert'};
  }},
  api:async(path,opts)=>{
    if(opts?.method==='POST') {
      posts++;
      if(options.deferred) await options.deferred;
      if(options.reject) throw Object.assign(Error('synthetic rejection'),{status:options.reject});
      if(options.network) throw Error('synthetic lost response');
      response={token:'inert-fixture-token'};return response;
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
   counts:()=>({posts,downloads,lists}),token:()=>token,response:()=>response,
   navigate:()=>{context.credentialHandoffGeneration++;context.TrackerSecureHandoff.clear();}};
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
 const unconfirmed=setup({direct:true,confirmed:false});await unconfirmed.submit();
 assert.equal(unconfirmed.counts().posts,0);assert.equal(unconfirmed.token(),'');
 const demo=setup({direct:true,demo:true});await demo.submit();assert.equal(demo.counts().posts,0);
 const direct=setup({direct:true});await direct.submit();
 assert.equal(direct.counts().downloads,0);assert.equal(direct.token(),'inert-fixture-token');
 assert.equal(direct.response().token,'');assert.equal(direct.form.elements.secure_approved.checked,false);
 assert.doesNotMatch(direct.status.textContent,/inert-fixture-token/);
 for(const failure of [{network:true},{listError:true},{reject:403}]) {
   const fixture=setup({direct:true,...failure});await fixture.submit();assert.equal(fixture.token(),'');
 }
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const cancelled=setup({direct:true,deferred:pending});const inFlight=cancelled.submit();
 cancelled.navigate();finish();await inFlight;
 assert.equal(cancelled.token(),'');assert.match(cancelled.status.textContent,/Handoff interrupted/);
 assert.equal(cancelled.response().token,'');assert.equal(cancelled.counts().posts,1);
 console.log('PASS validation, rejection classification, cancellation recovery, ambiguous failure, double-submit suppression');
})().catch(error=>{console.error(error);process.exit(1);});
"""
    source = Path(app.__file__).parent / "static" / "app.js"
    subprocess.run(["node", "-e", script, str(source)], capture_output=True, text=True, check=True)


def test_one_time_token_clears_on_dismiss_navigation_timeout_and_revoke():
    script = r"""
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.argv[1],'utf8');
function setup(){
 const nodes={},events={};let timeout;
 const context={document:{querySelector:id=>nodes[id]||=({value:'',textContent:'',hidden:true,type:'password',checked:false,focus(){},select(){this.selected=true;}})},
  setTimeout:(fn,ms)=>{assert.equal(ms,300000);timeout=fn;return 1;},clearTimeout:()=>{timeout=undefined;},
  addEventListener:(name,fn)=>{events[name]=fn;}};
 for(const secretSink of ['localStorage','sessionStorage','navigator','console','fetch','location']) {
   Object.defineProperty(context,secretSink,{get(){throw Error('Secret persistence or transport attempted');}});
 }
 vm.createContext(context);vm.runInContext(source,context);
 context.document.querySelector('#agent-create-status');
 return {api:context.TrackerSecureHandoff,nodes,events,timeout:()=>timeout()};
}
const name='#agent-secure-name',token='#agent-secure-token',panel='#agent-secure-handoff';
for(const action of ['dismiss','pagehide','pageshow','timeout','revoke','navigation']) {
 const f=setup();f.api.show('inert-fixture-token','Synthetic');
 f.nodes['#agent-create-status'].textContent='New token is available below for five minutes.';
 assert.equal(f.nodes[token].value,'inert-fixture-token');assert.equal(f.nodes[token].type,'password');
 assert.equal(f.nodes[panel].hidden,false);
 f.nodes['#agent-secure-reveal'].onchange({currentTarget:{checked:true}});assert.equal(f.nodes[token].type,'text');
 f.nodes['#agent-secure-select'].onclick();assert.equal(f.nodes[token].selected,true);
 if(action==='dismiss')f.nodes['#agent-secure-dismiss'].onclick();
 else if(action==='timeout')f.timeout();
 else if(action==='revoke')f.api.clearFor('Synthetic');
 else if(action==='navigation')f.api.clear();
 else f.events[action]();
 assert.equal(f.nodes[token].value,'');assert.equal(f.nodes[token].type,'password');
 assert.equal(f.nodes[name].textContent,'');assert.equal(f.nodes[panel].hidden,true);
 assert.equal(JSON.stringify(f.nodes).includes('inert-fixture-token'),false);
 assert.doesNotMatch(f.nodes['#agent-create-status'].textContent,/available below/);
 assert.match(f.nodes['#agent-create-status'].textContent,/cannot be recovered.*revoke/);
}
const restored=setup();restored.nodes['#agent-create-status'].textContent='New token is available below for five minutes.';
restored.events.pageshow();assert.doesNotMatch(restored.nodes['#agent-create-status'].textContent,/available below/);
restored.nodes['#agent-create-status'].textContent='Encrypted download created.';
restored.api.clear();assert.equal(restored.nodes['#agent-create-status'].textContent,'Encrypted download created.');
const f=setup();f.api.show('inert-first','First');f.api.show('inert-second','Second');
assert.equal(JSON.stringify(f.nodes).includes('inert-first'),false);
f.api.clearFor('First');assert.equal(f.nodes[token].value,'inert-second');
f.api.clear();assert.equal(f.nodes[token].value,'');
console.log('PASS explicit reveal, manual selection, dismissal/reload/BFCache/timeout/revoke redaction; no storage/transport/clipboard');
"""
    source = Path(app.__file__).parent / "static" / "secure-handoff.js"
    subprocess.run(["node", "-e", script, str(source)], capture_output=True, text=True, check=True)
