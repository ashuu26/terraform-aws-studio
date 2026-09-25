const fs=require('fs');
const src=fs.readFileSync('catalog.js','utf8').replace(/if \(typeof module[^\n]*\n/,'')+'\n'+fs.readFileSync('engine.js','utf8').replace(/if \(typeof module[^\n]*\n/,'');
const vm=require('vm'); const ctx={console}; vm.createContext(ctx); vm.runInContext(src+'\nthis.API={SERVICES,SVC,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL};',ctx);
const {SERVICES,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL}=ctx.API;
function run(ids,label,cfg={}){
  const p=generateProject(ids,cfg,DEFAULT_GLOBAL);
  const v=validateProject(p.files,ids,cfg,DEFAULT_GLOBAL);
  const errs=[];for(const k in v) for(const i of v[k].items) if(i.level==='error'||(i.level==='warn'&&k!=='design'&&k!=='security')) errs.push(k+': '+i.msg);
  console.log(label.padEnd(40), errs.length?'\n  '+errs.join('\n  '):'ok');
  return p;
}
for(const s of SERVICES) run([s.id],'solo '+s.id);
run(SERVICES.map(s=>s.id),'ALL');
for(const pr of PRESETS) run(pr.ids,'preset '+pr.name);
const p=run(PRESETS[1].ids,'print');
for(const f of p.files) if(['providers.tf','rds_postgres.tf','autoscaling.tf','variables.tf'].includes(f.name)) console.log('=== '+f.name+'\n'+f.content);
highlightHCL(p.files[0].content,'aws');
const q=generateProject(SERVICES.map(s=>s.id),{tg:{target_type:'ip'}},DEFAULT_GLOBAL);
for(const f of q.files) if(['rds_postgres.tf','autoscaling.tf','cloudfront.tf','waf.tf','ecs_task_definition.tf','eks_node_group.tf','lambda.tf','providers.tf'].includes(f.name)) console.log('=== '+f.name+'\n'+f.content);
console.log(q.files.find(f=>f.name==='terraform.tfvars.example').content.slice(0,600));
