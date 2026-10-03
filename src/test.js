const fs=require('fs');
const src=['catalog.js','landingzone.js','engine.js','learn.js'].map(f=>fs.readFileSync(f,'utf8').replace(/if \(typeof module[^\n]*\n/,'')).join('\n');
const vm=require('vm'); const ctx={console}; vm.createContext(ctx); vm.runInContext(src+'\nthis.API={SERVICES,SVC,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL,depsOf,RES_INFO,RES_GUIDE,lzTemplate,lzCheck,lzNewScp,scpPolicy,LZ_TOPICS,CT_CONTROLS};',ctx);
const {SERVICES,SVC,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL,depsOf,RES_INFO,RES_GUIDE,lzTemplate,lzCheck,lzNewScp,scpPolicy,LZ_TOPICS,CT_CONTROLS}=ctx.API;
const verbose=process.argv.includes('--print');
function run(ids,label,cfg={}){
  const p=generateProject(ids,cfg,DEFAULT_GLOBAL);
  const v=validateProject(p.files,ids,cfg,DEFAULT_GLOBAL);
  const errs=[];for(const k in v) for(const i of v[k].items) if(i.level==='error'||(i.level==='warn'&&k!=='design'&&k!=='security')) errs.push(k+': '+i.msg);
  console.log(label.padEnd(40), errs.length?'\n  '+errs.join('\n  '):'ok');
  return p;
}
for(const s of SERVICES) run([s.id],'solo '+s.id);
run(SERVICES.map(s=>s.id),'ALL',{tg:{target_type:'ip'}});
for(const pr of PRESETS) run(pr.ids,'preset '+pr.name,pr.cfg||{});
const p=run(PRESETS[1].ids,'print',PRESETS[1].cfg);
if(verbose) for(const f of p.files) if(['providers.tf','rds_postgres.tf','autoscaling.tf','variables.tf'].includes(f.name)) console.log('=== '+f.name+'\n'+f.content);
highlightHCL(p.files[0].content,'aws');

/* ---------------- AWS Backup and Amazon CloudWatch ---------------- */
let pass=0; const fails=[];
function t(name,fn){ try{ fn(); pass++; } catch(e){ fails.push(name+': '+e.message); } }
function ok(c,msg){ if(!c) throw new Error(msg||'assertion failed'); }
const gen=(ids,cfg={},g={})=>generateProject(ids,cfg,Object.assign({},DEFAULT_GLOBAL,g));
const file=(p,n)=>{ const f=p.files.find(x=>x.name===n); ok(f,'missing file '+n+' (have '+p.files.map(x=>x.name).join(', ')+')'); return f.content; };
const has=(p,n)=>p.files.some(x=>x.name===n);
const all=p=>p.files.map(f=>f.content).join('\n');
const checks=(p,ids,cfg={})=>{ const v=validateProject(p.files,ids,cfg,DEFAULT_GLOBAL); return Object.values(v).flatMap(c=>c.items); };
const errors=(p,ids,cfg={})=>checks(p,ids,cfg).filter(i=>i.level==='error').map(i=>i.msg);
const noErrors=(p,ids,cfg={})=>{ const e=errors(p,ids,cfg); ok(!e.length,'static check errors: '+e.join(' | ')); };
const types=p=>[...all(p).matchAll(/^(resource|data)\s+"([^"]+)"/gm)].map(m=>(m[1]==='data'?'data.':'')+m[2]);

// Backup: vault
t('backup vault uses KMS key when KMS is selected',()=>{ const c=file(gen(['kms','backup']),'backup_vault.tf'); ok(/resource "aws_backup_vault" "main"/.test(c)); ok(/kms_key_arn\s+= aws_kms_key\.main\.arn/.test(c)); });
t('backup vault falls back to the AWS managed key',()=>{ const c=file(gen(['backup']),'backup_vault.tf'); ok(!/kms_key_arn\s*=/.test(c)); ok(/force_destroy\s+= var\.backup_vault_force_destroy/.test(c)); });
t('backup vault customer managed key without KMS service becomes a variable',()=>{ const p=gen(['backup'],{backup:{encryption:'Customer managed KMS key'}}); ok(/kms_key_arn\s+= var\.backup_kms_key_arn/.test(file(p,'backup_vault.tf'))); ok(p.vars.has('backup_kms_key_arn')); });
t('backup vault policy is optional',()=>{ ok(!/aws_backup_vault_policy/.test(all(gen(['backup'])))); const c=file(gen(['backup'],{backup:{vault_policy:true}}),'backup_vault.tf'); ok(/resource "aws_backup_vault_policy" "main"/.test(c)); ok(/backup:DeleteRecoveryPoint/.test(c)); });
// Backup: plan
t('backup plan rule settings',()=>{ const c=file(gen(['backup']),'backup_plan.tf'); for(const a of ['rule_name','target_vault_name','schedule ','schedule_expression_timezone','start_window','completion_window','enable_continuous_backup','delete_after']) ok(c.includes(a),'missing '+a); ok(!/cold_storage_after/.test(c)); ok(!/copy_action/.test(c)); });
t('backup plan cold storage and copy action',()=>{ const c=file(gen(['backup'],{backup:{cold:true,retention:150,copy_vault_arn:'arn:aws:backup:us-west-2:111122223333:backup-vault:dr'}}),'backup_plan.tf'); ok(/cold_storage_after\s+= var\.backup_cold_storage_after_days/.test(c)); ok(/copy_action \{/.test(c)); ok(/destination_vault_arn = var\.backup_copy_destination_vault_arn/.test(c)); });
// Backup: selection and role
t('backup selection lists selected resources and tag',()=>{ const c=file(gen(['ec2','ebs','dynamodb','backup']),'backup_selection.tf'); for(const r of ['aws_instance.main.arn','aws_ebs_volume.data.arn','aws_dynamodb_table.main.arn']) ok(c.includes(r),'missing '+r); ok(/selection_tag \{/.test(c)); ok(/key\s+= var\.backup_selection_tag_key/.test(c)); });
t('backup selection by tags only',()=>{ const c=file(gen(['ec2','backup'],{backup:{selection:'By resource tags'}}),'backup_selection.tf'); ok(!/resources\s*=/.test(c)); ok(/selection_tag/.test(c)); });
t('backup selection by resource ARN without services uses a variable',()=>{ const p=gen(['backup'],{backup:{selection:'By resource ARN'}}); ok(/resources\s+= var\.backup_resource_arns/.test(file(p,'backup_selection.tf'))); });
t('backup selection by resource type uses wildcard ARNs',()=>{ const p=gen(['backup'],{backup:{selection:'By resource type',types:'EBS, RDS, S3'}}); ok(/resources\s+= var\.backup_resource_type_patterns/.test(file(p,'backup_selection.tf'))); const d=JSON.stringify(p.vars.get('backup_resource_type_patterns').def); ok(d.includes('arn:aws:ec2:*:*:volume/*')&&d.includes('arn:aws:rds:*:*:db:*')&&d.includes('arn:aws:s3:::*'),d); ok(/AWSBackupServiceRolePolicyForS3Backup/.test(all(p))); });
t('backup IAM role trusts AWS Backup with managed policies',()=>{ const c=file(gen(['backup']),'backup_selection.tf'); ok(/identifiers = \["backup\.amazonaws\.com"\]/.test(c)); ok(c.includes('arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup')); ok(c.includes('arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores')); ok(!/S3Backup/.test(c)); });
t('backup IAM role adds S3 policies when S3 is selected',()=>{ const c=file(gen(['s3','s3_versioning','backup']),'backup_selection.tf'); ok(c.includes('"arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup"')); ok(c.includes('"arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore"')); ok(c.includes('aws_s3_bucket.main.arn')); });
t('backup existing role is a variable, no role created',()=>{ const p=gen(['backup'],{backup:{role:'Use existing'}}); ok(!/aws_iam_role"/.test(all(p))); ok(/iam_role_arn = var\.backup_iam_role_arn/.test(file(p,'backup_selection.tf'))); ok(!p.outs.has('backup_iam_role_arn')); });
// Backup: vault lock
t('vault lock governance omits changeable_for_days',()=>{ const p=gen(['backup'],{backup:{lock:true}}); const c=file(p,'backup_vault_lock.tf'); ok(/min_retention_days\s+= var\.backup_lock_min_retention_days/.test(c)); ok(!/changeable_for_days\s*=/.test(c)); ok(!has(gen(['backup']),'backup_vault_lock.tf')); });
t('vault lock compliance sets changeable_for_days',()=>{ const c=file(gen(['backup'],{backup:{lock:true,lock_mode:'Compliance'}}),'backup_vault_lock.tf'); ok(/changeable_for_days = var\.backup_lock_changeable_for_days/.test(c)); });
// Backup: variables, outputs, dependencies, checks
t('backup variables with validation',()=>{ const p=gen(['backup']); for(const v of ['backup_vault_name','backup_schedule','backup_retention_days','backup_start_window_minutes','backup_completion_window_minutes']) { ok(p.vars.has(v),'missing '+v); } ok(p.vars.get('backup_schedule').val); ok(p.vars.get('backup_retention_days').val); });
t('backup outputs',()=>{ const p=gen(['backup']); for(const o of ['backup_vault_name','backup_vault_arn','backup_plan_id','backup_plan_arn','backup_selection_id','backup_iam_role_arn']) ok(p.outs.has(o),'missing '+o); ok(/aws_backup_vault\.main\.arn/.test(file(p,'outputs.tf'))); });
t('backup dependencies follow encryption choice',()=>{ ok(depsOf('backup',{encryption:'Auto'},()=>false).includes('kms')); ok(!depsOf('backup',{encryption:'AWS managed key'},()=>false).includes('kms')); });
t('backup checks: retention vs lock, continuous, cold storage, windows',()=>{
  const e1=errors(gen(['backup'],{backup:{lock:true,lock_min:40}}),['backup'],{backup:{lock:true,lock_min:40}}); ok(e1.some(m=>/outside the Vault Lock range/.test(m)),e1.join('|'));
  const c2={backup:{continuous:true,retention:60}}; ok(errors(gen(['backup'],c2),['backup'],c2).some(m=>/at most 35 days/.test(m)));
  const c3={backup:{cold:true,cold_after:30,retention:100}}; ok(errors(gen(['backup'],c3),['backup'],c3).some(m=>/90 days longer/.test(m)));
  const c4={backup:{start_window:120,completion_window:150}}; ok(errors(gen(['backup'],c4),['backup'],c4).some(m=>/completion window/.test(m)));
});
t('backup check: missing vault, plan, selection and role after hand edits',()=>{ const p=gen(['backup']); const files=p.files.filter(f=>!/^backup_/.test(f.name)); const v=validateProject(files,['backup'],{},DEFAULT_GLOBAL); const msgs=Object.values(v).flatMap(c=>c.items).map(i=>i.msg).join('|'); for(const w of ['Missing Backup Vault','Missing Backup Plan','Missing Backup Selection','Missing IAM Backup Role']) ok(msgs.includes(w),'no "'+w+'"'); });
t('backup S3 without versioning warns',()=>{ const it=checks(gen(['s3','backup']),['s3','backup']); ok(it.some(i=>/requires versioning/.test(i.msg))); });

// CloudWatch: logs
t('log group with retention, class and no KMS by default',()=>{ const c=file(gen(['cloudwatch']),'cloudwatch_log_group.tf'); ok(/resource "aws_cloudwatch_log_group" "app"/.test(c)); ok(/retention_in_days = var\.cloudwatch_log_retention_days/.test(c)); ok(/log_group_class\s+= var\.cloudwatch_log_group_class/.test(c)); ok(!/kms_key_id/.test(c)); });
t('log group KMS adds a Logs statement to the key policy',()=>{ const p=gen(['kms','cloudwatch'],{cloudwatch:{log_kms:true}}); ok(/kms_key_id\s+= aws_kms_key\.main\.arn/.test(file(p,'cloudwatch_log_group.tf'))); const k=file(p,'kms.tf'); ok(/policy\s+= data\.aws_iam_policy_document\.kms\.json/.test(k)); ok(k.includes('logs.${var.aws_region}.amazonaws.com')); ok(!/policy\s*=/.test(file(gen(['kms','cloudwatch']),'kms.tf'))); });
t('log stream is optional',()=>{ ok(!/aws_cloudwatch_log_stream/.test(all(gen(['cloudwatch'])))); ok(/resource "aws_cloudwatch_log_stream" "app"/.test(all(gen(['cloudwatch'],{cloudwatch:{log_stream:true}})))); });
t('metric filter and its alarm',()=>{ const p=gen(['cloudwatch']); const c=file(p,'cloudwatch_log_group.tf'); ok(/resource "aws_cloudwatch_log_metric_filter" "app_errors"/.test(c)); ok(/pattern\s+= var\.cloudwatch_filter_pattern/.test(c)); ok(/metric_transformation \{/.test(c)); ok(/resource "aws_cloudwatch_metric_alarm" "app_errors"/.test(file(p,'cloudwatch_alarm.tf'))); });
t('metric filter without a log group reads an existing one',()=>{ const p=gen(['cloudwatch'],{cloudwatch:{log_group:false}}); ok(/log_group_name = var\.cloudwatch_filter_log_group_name/.test(file(p,'cloudwatch_log_group.tf'))); });
// CloudWatch: alarms
t('metric alarm dimensions reference selected EC2',()=>{ const c=file(gen(['ec2','cloudwatch']),'cloudwatch_alarm.tf'); ok(/InstanceId = aws_instance\.main\.id/.test(c)); ok(/alarm_actions = \[aws_sns_topic\.alerts\.arn\]/.test(c)); });
t('metric alarm dimension becomes a variable without EC2',()=>{ const p=gen(['cloudwatch']); ok(/InstanceId = var\.cloudwatch_alarm_instance_id/.test(file(p,'cloudwatch_alarm.tf'))); ok(p.vars.get('cloudwatch_alarm_instance_id').def===undefined); });
t('metric alarm targets RDS, ALB and Lambda',()=>{
  ok(/DBInstanceIdentifier = aws_db_instance\.postgres\.identifier/.test(file(gen(['rds_postgres','cloudwatch'],{cloudwatch:{alarm_target:'RDS CPU'}}),'cloudwatch_alarm.tf')));
  ok(/DBClusterIdentifier = aws_rds_cluster\.main\.cluster_identifier/.test(file(gen(['aurora','cloudwatch'],{cloudwatch:{alarm_target:'RDS CPU'}}),'cloudwatch_alarm.tf')));
  ok(/LoadBalancer = aws_lb\.app\.arn_suffix/.test(file(gen(['alb','cloudwatch'],{cloudwatch:{alarm_target:'ALB 5XX errors'}}),'cloudwatch_alarm.tf')));
  ok(/FunctionName = aws_lambda_function\.main\.function_name/.test(file(gen(['lambda','cloudwatch'],{cloudwatch:{alarm_target:'Lambda errors'}}),'cloudwatch_alarm.tf')));
});
t('custom metric alarm uses variables',()=>{ const c=file(gen(['cloudwatch'],{cloudwatch:{alarm_target:'Custom metric',alarm_dim:'Service'}}),'cloudwatch_alarm.tf'); ok(/namespace\s+= var\.cloudwatch_alarm_namespace/.test(c)); ok(/Service = var\.cloudwatch_alarm_dimension_value/.test(c)); });
t('composite alarm only with two alarms',()=>{ ok(/aws_cloudwatch_composite_alarm" "any"/.test(all(gen(['ec2','cloudwatch'],{cloudwatch:{composite:true}})))); const p=gen(['ec2','cloudwatch'],{cloudwatch:{composite:true,metric_filter:false}}); ok(!/composite_alarm/.test(all(p))); ok(p.notes.some(n=>/composite alarm/.test(n.text))); });
t('alarm without dimensions is flagged (hand edit)',()=>{ const p=gen(['ec2','cloudwatch']); const files=p.files.map(f=>f.name==='cloudwatch_alarm.tf'?Object.assign({},f,{content:f.content.replace(/\n  dimensions = \{\n[^}]*\}\n/,'\n')}):f); const v=validateProject(files,['ec2','cloudwatch'],{},DEFAULT_GLOBAL); ok(Object.values(v).flatMap(c=>c.items).some(i=>/Missing CloudWatch metric dimensions/.test(i.msg))); });
t('infrequent access log class with metric filter is an error',()=>{ const c={cloudwatch:{log_class:'INFREQUENT_ACCESS'}}; ok(errors(gen(['cloudwatch'],c),['cloudwatch'],c).some(m=>/Infrequent Access/.test(m))); });
// CloudWatch: dashboard
t('dashboard widgets follow the selection',()=>{ const p=gen(['ec2','lambda','backup','cloudwatch']); const c=file(p,'cloudwatch_dashboard.tf'); ok(/dashboard_body = jsonencode\(\{/.test(c)); ok(c.includes('"CPUUtilization", "InstanceId", aws_instance.main.id')); ok(c.includes('aws_lambda_function.main.function_name')); ok(c.includes('NumberOfBackupJobsFailed')); ok(!c.includes('AWS/RDS')); ok(p.notes.some(n=>/widgets skipped/.test(n.text))); });
t('dashboard with nothing to graph gets a text widget',()=>{ const c=file(gen(['cloudwatch'],{cloudwatch:{log_group:false,metric_filter:false}}),'cloudwatch_dashboard.tf'); ok(/type\s+= "text"/.test(c)); });
// EventBridge and SNS
t('EventBridge backup failure rule to SNS',()=>{ const p=gen(['backup','cloudwatch']); const c=file(p,'eventbridge.tf'); ok(/resource "aws_cloudwatch_event_rule" "backup_failed"/.test(c)); ok(/state\s+= "ENABLED"/.test(c)); ok(!/is_enabled/.test(c)); ok(c.includes('"Backup Job State Change"')); ok(c.includes('"FAILED", "ABORTED", "EXPIRED"')); ok(/arn\s+= aws_sns_topic\.alerts\.arn/.test(c)); ok(!/backup_completed/.test(c)); });
t('EventBridge targets a log group when SNS is off',()=>{ const p=gen(['backup','cloudwatch'],{cloudwatch:{sns:false}}); const c=file(p,'eventbridge.tf'); ok(/resource "aws_cloudwatch_log_group" "events"/.test(c)); ok(/resource "aws_cloudwatch_log_resource_policy" "events"/.test(c)); ok(/arn\s+= aws_cloudwatch_log_group\.events\.arn/.test(c)); ok(!has(p,'sns.tf')); });
t('EventBridge completion and EC2 rules',()=>{ const c=file(gen(['ec2','backup','cloudwatch'],{cloudwatch:{bk_completed:true,ec2_events:true}}),'eventbridge.tf'); ok(/"backup_completed"/.test(c)); ok(/"ec2_state"/.test(c)); ok(c.includes('"EC2 Instance State-change Notification"')); ok(c.includes('"instance-id" = [aws_instance.main.id]')); });
t('no backup rules without AWS Backup',()=>{ ok(!has(gen(['cloudwatch']),'eventbridge.tf')); });
t('SNS topic policy has one statement per publisher',()=>{ const c=file(gen(['backup','cloudwatch'],{cloudwatch:{bk_vault:true}}),'sns.tf'); ok(/sid\s+= "AllowCloudWatchAlarms"/.test(c)); ok(/sid\s+= "AllowEventBridgeRules"/.test(c)); ok(/sid\s+= "AllowAWSBackup"/.test(c)); ok(/count = var\.cloudwatch_alerts_email == null \? 0 : 1/.test(c)); });
t('backup vault notifications',()=>{ const p=gen(['backup','cloudwatch'],{cloudwatch:{bk_vault:true}}); const c=file(p,'backup_notifications.tf'); ok(/resource "aws_backup_vault_notifications" "main"/.test(c)); ok(c.includes('"RESTORE_JOB_COMPLETED"')); ok(/depends_on = \[aws_sns_topic_policy\.alerts\]/.test(c)); ok(!has(gen(['backup','cloudwatch']),'backup_notifications.tf')); });
t('job events use vault notifications when EventBridge is off',()=>{ const c=file(gen(['backup','cloudwatch'],{cloudwatch:{bk_eventbridge:false}}),'backup_notifications.tf'); ok(c.includes('"BACKUP_JOB_FAILED"')); });
// CloudWatch: variables, outputs, dependencies
t('cloudwatch variables and outputs',()=>{ const p=gen(['ec2','backup','cloudwatch']); for(const v of ['cloudwatch_log_group_name','cloudwatch_log_retention_days','cloudwatch_alarm_period','cloudwatch_alarm_threshold','cloudwatch_dashboard_name','cloudwatch_alerts_email']) ok(p.vars.has(v),'missing var '+v); for(const o of ['cloudwatch_log_group_name','cloudwatch_alarm_arn','cloudwatch_dashboard_arn','sns_topic_arn','eventbridge_rule_arns']) ok(p.outs.has(o),'missing output '+o); });
t('outputs only for generated resources',()=>{ const p=gen(['cloudwatch'],{cloudwatch:{log_group:false,metric_filter:false,alarm:false,dashboard:false,sns:false}}); ok(p.outs.size===0,[...p.outs.keys()].join(',')); ok(has(p,'cloudwatch.tf')); });
t('cloudwatch suggests the watched service',()=>{ ok(depsOf('cloudwatch',{alarm:true,alarm_target:'EC2 CPU'},()=>false).includes('ec2')); ok(!depsOf('cloudwatch',{alarm:true,alarm_target:'EC2 CPU'},id=>id==='asg').includes('ec2')); ok(depsOf('cloudwatch',{alarm:true,alarm_target:'Lambda errors'},()=>false).includes('lambda')); ok(depsOf('cloudwatch',{alarm:false,log_group:true,log_kms:true},()=>false).includes('kms')); });

// File layout, Registry and learning coverage
t('category layout does not double the prefix',()=>{ const p=gen(['backup','cloudwatch'],{}, {layout:'category'}); const n=p.files.map(f=>f.name); ok(n.includes('backup_vault.tf')&&!n.some(x=>x.startsWith('backup_backup')),n.join(',')); ok(n.includes('monitoring_cloudwatch_alarm.tf')); ok(n.includes('monitoring_sns.tf')); });
t('every generated type is declared by its service and documented',()=>{ for(const [ids,cfg] of [[['backup'],{backup:{lock:true,vault_policy:true}}],[['s3','ec2','kms','backup','cloudwatch'],{backup:{lock:true,vault_policy:true},cloudwatch:{log_stream:true,composite:true,bk_vault:true,bk_completed:true,ec2_events:true,log_kms:true}}],[['backup','cloudwatch'],{cloudwatch:{sns:false}}]]) { const p=generateProject(ids,cfg,DEFAULT_GLOBAL); for(const f of p.files.filter(x=>x.svc==='backup'||x.svc==='cloudwatch')) for(const ty of types({files:[f]})) { ok(SVC[f.svc].res.includes(ty),ty+' not in '+f.svc+'.res'); ok(RES_INFO[ty],ty+' has no RES_INFO'); } } });
t('every new resource type has a learning guide',()=>{ for(const id of ['backup','cloudwatch']) for(const ty of SVC[id].res) if(!ty.startsWith('data.')&&!ty.startsWith('aws_iam_')) ok(RES_GUIDE[ty],ty+' has no RES_GUIDE'); });
t('no credentials in generated code',()=>{ const a=all(gen(SERVICES.map(s=>s.id),{tg:{target_type:'ip'},cloudwatch:{bk_vault:true,bk_completed:true,ec2_events:true,composite:true}})); ok(!/AKIA[0-9A-Z]{16}/.test(a)); ok(!/\b(access_key|secret_key)\s*=/.test(a)); });

// Integration combinations from the specification
for(const [label,ids] of [['AWS Backup only',['backup']],['CloudWatch only',['cloudwatch']],['AWS Backup + CloudWatch',['backup','cloudwatch']],['AWS Backup + EC2',['vpc','subnet','sg','ec2','backup']],['AWS Backup + RDS',['vpc','subnet','dbsg','sg','rds_postgres','backup']],['AWS Backup + S3',['s3','s3_versioning','backup']],['EC2 + CloudWatch',['vpc','subnet','sg','ec2','cloudwatch']],['RDS + CloudWatch',['vpc','subnet','dbsg','sg','rds_postgres','cloudwatch']]]) {
  const cfg=ids.includes('rds_postgres')?{sg:{ports:'443, 80, 5432'}}:{};
  t('integration: '+label,()=>{ const p=gen(ids,cfg); noErrors(p,ids,cfg); const v=validateProject(p.files,ids,cfg,DEFAULT_GLOBAL); for(const k of ['variables','refs','outputs']) ok(v[k].status!=='error',k+' '+v[k].items.map(i=>i.msg).join('|')); });
}
t('integration: every option on, full catalog',()=>{ const ids=SERVICES.map(s=>s.id); const cfg={tg:{target_type:'ip'},backup:{lock:true,vault_policy:true,cold:true,retention:150,copy_vault_arn:'arn:aws:backup:us-west-2:111122223333:backup-vault:dr'},cloudwatch:{log_stream:true,composite:true,bk_vault:true,bk_completed:true,ec2_events:true,log_kms:true}}; noErrors(gen(ids,cfg),ids,cfg); });

/* ---------------- AWS Landing Zone ---------------- */
const LZ='landing_zone';
const lz=(model,fn)=>{ const c=JSON.parse(JSON.stringify(lzTemplate(model,'ap-southeast-1'))); if(fn) fn(c); return c; };
const glz=(c,extra=[])=>gen([...extra,LZ],{[LZ]:c});
const lzErr=(c)=>lzCheck(c,DEFAULT_GLOBAL).filter(i=>i.level==='error').map(i=>i.msg);
const lzAll=(c)=>lzCheck(c,DEFAULT_GLOBAL).map(i=>i.msg);
const lzOk=(c,extra=[])=>{ const p=glz(c,extra); noErrors(p,[...extra,LZ],{[LZ]:c}); return p; };
const scp=(c,tpl,targets,over={})=>{ const s=Object.assign(lzNewScp(c,tpl,'ap-southeast-1'),{targets},over); c.scps.push(s); return s; };
// Models
t('lz enterprise: organization, OUs, accounts and Control Tower files',()=>{ const p=lzOk(lz('enterprise')); for(const f of ['organization.tf','organizational_units.tf','default_accounts.tf','custom_accounts.tf','control_tower_roles.tf','control_tower.tf','control_tower_baselines.tf','control_tower_controls.tf']) ok(has(p,f),'missing '+f); });
t('lz non-enterprise: no Control Tower resources',()=>{ const p=lzOk(lz('non-enterprise')); ok(!/aws_controltower_|aws_servicecatalog_/.test(all(p))); ok(!p.files.some(f=>f.name.startsWith('control_tower'))); });
t('lz enterprise with Control Tower off behaves like Organizations only',()=>{ const p=lzOk(lz('enterprise',c=>{c.ct.enabled=false;})); ok(!/aws_controltower_/.test(all(p))); });
// Organization
t('lz organization: feature set, SCP policy type, trusted access, prevent_destroy',()=>{ const c=file(lzOk(lz('non-enterprise')),'organization.tf'); ok(/feature_set\s+= var\.organization_feature_set/.test(c)); ok(c.includes('enabled_policy_types          = ["SERVICE_CONTROL_POLICY"]')); ok(/aws_service_access_principals = var\.organization_service_access_principals/.test(c)); ok(/prevent_destroy = true/.test(c)); ok(/organization_root_id = aws_organizations_organization\.this\.roots\[0\]\.id/.test(c)); });
t('lz organization: Control Tower ignores trusted access drift',()=>{ ok(/ignore_changes = \[aws_service_access_principals, enabled_policy_types\]/.test(file(lzOk(lz('enterprise')),'organization.tf'))); });
t('lz organization: import and existing modes',()=>{ const i=file(lzOk(lz('non-enterprise',c=>{c.org.mode='import';c.org.id='o-abcdef1234';})),'organization.tf'); ok(/import \{\n  to = aws_organizations_organization\.this\n  id = "o-abcdef1234"/.test(i)); const e=lzOk(lz('non-enterprise',c=>{c.org.mode='existing';})); ok(/data "aws_organizations_organization" "this" \{\}/.test(all(e))); ok(!/resource "aws_organizations_organization"/.test(all(e))); ok(/data\.aws_organizations_organization\.this\.roots\[0\]\.id/.test(all(e))); ok(lzErr(lz('non-enterprise',c=>{c.org.mode='import';c.org.id='bad';})).some(m=>/organization needs its ID/.test(m))); });
t('lz organization: consolidated billing rejects SCPs and Control Tower',()=>{ const e=lzErr(lz('enterprise',c=>{c.org.feature_set='CONSOLIDATED_BILLING';})); ok(e.some(m=>/need the ALL feature set/.test(m))); ok(e.some(m=>/Control Tower needs an organization with all features/.test(m))); });
// OUs
t('lz OUs: nested OUs reference their parent, top-level OUs the root',()=>{ const c=file(lzOk(lz('enterprise')),'organizational_units.tf'); ok(/"production" \{\n  name      = var\.organizational_unit_names\["production"\]\n  parent_id = aws_organizations_organizational_unit\.workloads\.id/.test(c)); ok(/"security" \{[\s\S]*?parent_id = local\.organization_root_id/.test(c)); ok(c.indexOf('"workloads"')<c.indexOf('"production"'),'parent before child'); });
t('lz OUs: duplicate names, missing parent, depth and loops',()=>{
  ok(lzErr(lz('non-enterprise',c=>{c.ous.push({key:'dup',name:'Security',parent:'root',desc:''});})).some(m=>/Duplicate OU name/.test(m)));
  ok(lzAll(lz('non-enterprise',c=>{c.ous.push({key:'sec2',name:'Security',parent:'production',desc:''});})).some(m=>/different parents/.test(m)));
  ok(lzErr(lz('non-enterprise',c=>{c.ous.push({key:'x',name:'X',parent:'gone',desc:''});})).some(m=>/no longer exists/.test(m)));
  ok(lzErr(lz('non-enterprise',c=>{let p='root';for(let i=1;i<=6;i++){c.ous.push({key:'d'+i,name:'D'+i,parent:p,desc:''});p='d'+i;}})).some(m=>/five levels/.test(m)));
  ok(lzErr(lz('non-enterprise',c=>{c.ous[0].parent='infrastructure';c.ous[1].parent='security';})).some(m=>/loop/.test(m)));
});
// Accounts
t('lz accounts: created accounts use variables, parent_id placement and safe lifecycle',()=>{ const p=lzOk(lz('non-enterprise')); const c=file(p,'custom_accounts.tf'); ok(/name                       = var\.accounts\["payments_prod"\]\.name/.test(c)); ok(/parent_id                  = aws_organizations_organizational_unit\.production\.id/.test(c)); ok(/role_name                  = var\.account_role_name/.test(c)); ok(/ignore_changes = \[role_name\]/.test(c)); ok(/Application = "Payments"/.test(c)); ok(p.vars.get('accounts').val); });
t('lz accounts: enterprise accounts get the AWSControlTowerExecution role',()=>{ const p=glz(lz('enterprise')); ok(p.vars.get('account_role_name').def==='AWSControlTowerExecution'); ok(lzAll(lz('enterprise',c=>{c.acct.role_name='OrganizationAccountAccessRole';})).some(m=>/AWSControlTowerExecution role/.test(m))); });
t('lz accounts: existing account imported and moved, never recreated',()=>{ const p=lzOk(lz('non-enterprise',c=>{Object.assign(c.accounts.find(a=>a.key==='payments_prod'),{mode:'import',id:'111122223333'});})); ok(/import \{\n  to = aws_organizations_account\.payments_prod\n  id = "111122223333"/.test(file(p,'existing_accounts.tf'))); const b=file(p,'custom_accounts.tf'); ok(/ignore_changes = \[name, email\]/.test(b)); ok(/prevent_destroy = true/.test(b)); ok(!/"payments_prod" \{[^}]*role_name/.test(b)); });
t('lz accounts: referenced account is only a variable',()=>{ const p=lzOk(lz('non-enterprise',c=>{Object.assign(c.accounts.find(a=>a.key==='payments_prod'),{mode:'reference',id:'111122223333'}); scp(c,'leave',['acct:payments_prod']);})); ok(!/aws_organizations_account" "payments_prod"/.test(all(p))); ok(JSON.stringify(p.vars.get('existing_account_ids').def).includes('111122223333')); ok(/target_id = var\.existing_account_ids\["payments_prod"\]/.test(file(p,'scp_attachments.tf'))); });
t('lz accounts: email, ID, duplicate and placement checks',()=>{
  ok(lzErr(lz('non-enterprise',c=>{c.accounts[0].email='not-an-email';})).some(m=>/valid email/.test(m)));
  ok(lzErr(lz('non-enterprise',c=>{c.accounts[1].email=c.accounts[0].email;})).some(m=>/same email/.test(m)));
  ok(lzErr(lz('non-enterprise',c=>{c.accounts[0].mode='import';c.accounts[0].id='123';})).some(m=>/12-digit/.test(m)));
  ok(lzAll(lz('non-enterprise',c=>{c.accounts.find(a=>a.key==='payments_prod').ou='root';})).some(m=>/"payments-prod" has no target OU/.test(m)));
});
t('lz accounts: placement in the root uses the root ID',()=>{ const p=lzOk(lz('non-enterprise',c=>{c.accounts.find(a=>a.key==='sandbox_dev').ou='root';})); ok(/"sandbox_dev" \{[\s\S]*?parent_id\s+= local\.organization_root_id/.test(file(p,'custom_accounts.tf'))); });
// SCPs
t('lz SCPs: none are created or attached unless chosen',()=>{ const p=lzOk(lz('enterprise')); ok(!/aws_organizations_policy/.test(all(p))); });
t('lz SCPs: multiple policies, root, OU and account attachments',()=>{ const c=lz('non-enterprise'); scp(c,'region',['ou:production','ou:non_production']); scp(c,'leave',['root']); scp(c,'root',['acct:payments_prod']); const p=lzOk(c); const pol=file(p,'service_control_policies.tf'); ok((pol.match(/resource "aws_organizations_policy"/g)||[]).length===3); ok(/type        = "SERVICE_CONTROL_POLICY"/.test(pol)); ok(/content = jsonencode\(\{/.test(pol)); ok(/"aws:RequestedRegion" = var\.scp_deny_unapproved_regions_allowed_regions/.test(pol)); const a=file(p,'scp_attachments.tf'); ok((a.match(/resource "aws_organizations_policy_attachment"/g)||[]).length===4); ok(/target_id = local\.organization_root_id/.test(a)); ok(/target_id = aws_organizations_organizational_unit\.production\.id/.test(a)); ok(/target_id = aws_organizations_account\.payments_prod\.id/.test(a)); ok(p.outs.has('scp_attachment_targets')); });
t('lz SCPs: disabled policy is created but not attached',()=>{ const c=lz('non-enterprise'); scp(c,'leave',['root'],{enabled:false}); const p=lzOk(c); ok(/aws_organizations_policy" "deny_leave_organization"/.test(all(p))); ok(!has(p,'scp_attachments.tf')); });
t('lz SCPs: JSON mode converts to jsonencode and escapes interpolation',()=>{ const c=lz('non-enterprise'); scp(c,'custom',['root'],{json:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Deny',Action:'s3:*',Resource:'arn:aws:s3:::${aws:PrincipalAccount}-*'}]})}); const p=lzOk(c); const pol=file(p,'service_control_policies.tf'); ok(pol.includes('"arn:aws:s3:::$${aws:PrincipalAccount}-*"'),pol); });
t('lz SCPs: invalid JSON, size, empty targets and quota are reported',()=>{
  const c1=lz('non-enterprise'); scp(c1,'custom',['root'],{json:'{ "Version": '}); ok(lzErr(c1).some(m=>/not valid JSON/.test(m))); ok(!/aws_organizations_policy"/.test(all(glz(c1))));
  const c2=lz('non-enterprise'); scp(c2,'custom',['root'],{json:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Deny',Action:Array.from({length:400},(_,i)=>'ec2:Action'+i),Resource:'*'}]})}); ok(lzErr(c2).some(m=>/limit is 5,120/.test(m)));
  const c3=lz('non-enterprise'); scp(c3,'leave',[]); ok(lzAll(c3).some(m=>/no attachment target/.test(m)));
  const c4=lz('non-enterprise'); for(const tp of ['region','root','security','logging','leave']) scp(c4,tp,['ou:production']); ok(lzErr(c4).some(m=>/quota is 5/.test(m)));
  const c5=lz('non-enterprise'); scp(c5,'custom',['root'],{json:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Deny',Principal:'*',Action:'*',Resource:'*'}]})}); ok(lzErr(c5).some(m=>/Principal/.test(m)));
});
t('lz SCPs: every template is valid JSON under the size limit',()=>{ const c=lz('enterprise'); for(const tp of ['region','root','security','logging','encryption','leave']) { const d=scpPolicy(lzNewScp(c,tp,'ap-southeast-1')); ok(d&&d.Statement.length,tp); ok(JSON.stringify(d).length<=5120,tp+' size'); for(const s of d.Statement) ok(s.Effect==='Deny'&&(s.Action||s.NotAction),tp); } });
t('lz SCPs: SCP type must be enabled',()=>{ const c=lz('non-enterprise',c=>{c.org.scp=false;}); scp(c,'leave',['root']); ok(lzErr(c).some(m=>/SERVICE_CONTROL_POLICY policy type is not enabled/.test(m))); });
// Control Tower
t('lz Control Tower: landing zone manifest references the log archive and audit accounts',()=>{ const c=file(lzOk(lz('enterprise')),'control_tower.tf'); ok(/resource "aws_controltower_landing_zone" "this"/.test(c)); ok(/version = var\.controltower_landing_zone_version/.test(c)); ok(/accountId = aws_organizations_account\.log_archive\.id/.test(c)); ok(/accountId = aws_organizations_account\.audit\.id/.test(c)); ok(/governedRegions = var\.controltower_governed_regions/.test(c)); ok(/backup = \{\n\s+enabled = false/.test(c)); ok(/aws_iam_role_policy_attachment\.controltower_admin/.test(c)); });
t('lz Control Tower: documented service roles in /service-role/',()=>{ const c=file(lzOk(lz('enterprise')),'control_tower_roles.tf'); for(const r of ['AWSControlTowerAdmin','AWSControlTowerCloudTrailRole','AWSControlTowerStackSetRole']) ok(c.includes(`name               = "${r}"`)||c.includes(`name = "${r}"`)||new RegExp(`name\\s+= "${r}"`).test(c),r); ok(/path\s+= "\/service-role\/"/.test(c)); ok(c.includes('arn:aws:iam::aws:policy/service-role/AWSControlTowerServiceRolePolicy')); ok(c.includes('arn:aws:iam::aws:policy/service-role/AWSControlTowerCloudTrailRolePolicy')); ok(c.includes('arn:aws:iam::*:role/AWSControlTowerExecution')); ok(!/ConfigAggregatorRole/.test(c)); });
t('lz Control Tower: OU registration with baselines and controls on registered OUs',()=>{ const p=lzOk(lz('enterprise')); const b=file(p,'control_tower_baselines.tf'); ok(/resource "aws_controltower_baseline" "workloads"/.test(b)); ok(/target_identifier\s+= aws_organizations_organizational_unit\.workloads\.arn/.test(b)); ok(/"production" \{[\s\S]*?depends_on = \[aws_controltower_landing_zone\.this, aws_controltower_baseline\.workloads\]/.test(b)); ok(!/aws_controltower_baseline" "security"/.test(b)); const k=file(p,'control_tower_controls.tf'); ok(k.includes('control_identifier = "arn:aws:controltower:${var.aws_region}::control/AWS-GR_RESTRICT_ROOT_USER_ACCESS_KEYS"')); ok(/target_identifier\s+= aws_organizations_organizational_unit\.workloads\.arn/.test(k)); });
t('lz Control Tower: existing landing zone is not recreated',()=>{ const p=lzOk(lz('enterprise',c=>{c.ct.mode='existing';})); ok(!/aws_controltower_landing_zone/.test(all(p))); ok(!has(p,'control_tower_roles.tf')); ok(/aws_controltower_baseline" "workloads"/.test(all(p))); });
t('lz Control Tower: dependency checks',()=>{
  ok(lzErr(lz('enterprise',c=>{c.accounts.find(a=>a.core==='audit').enabled=false;})).some(m=>/need the Audit account/.test(m)));
  ok(lzErr(lz('enterprise',c=>{c.accounts.find(a=>a.core==='audit').ou='infrastructure';})).some(m=>/same OU/.test(m)));
  ok(lzErr(lz('enterprise',c=>{c.ct.regions=['us-east-1'];})).some(m=>/home Region/.test(m)));
  ok(lzErr(lz('enterprise',c=>{c.ct.config=false;})).some(m=>/AWS Config integration off/.test(m)));
  ok(lzErr(lz('enterprise',c=>{c.ct.controls=[{id:'AWS-GR_ENCRYPTED_VOLUMES',ous:['suspended']}];})).some(m=>/not registered/.test(m)));
  ok(lzErr(lz('enterprise',c=>{c.ct.controls=[{id:'AWS-GR_MADE_UP',ous:['workloads']}];})).some(m=>/Unknown control/.test(m)));
});
t('lz Control Tower: controls use only documented identifiers',()=>{ ok(CT_CONTROLS.length>=20); for(const x of CT_CONTROLS) { ok(/^AWS-GR_[A-Z0-9_]+$/.test(x.id),x.id); ok(['SCP','AWS Config rule'].includes(x.impl)); ok(['Preventive','Detective'].includes(x.beh)); ok((x.impl==='SCP')===(x.beh==='Preventive'),x.id); } });
t('lz Account Factory: provisioned product into a registered OU',()=>{ const c=lz('enterprise',c=>{c.accounts.find(a=>a.key==='payments_prod').factory=true;}); const p=lzOk(c); const f=file(p,'account_factory.tf'); ok(/resource "aws_servicecatalog_provisioned_product" "payments_prod"/.test(f)); ok(/product_name\s+= "AWS Control Tower Account Factory"/.test(f)); ok(f.includes('value = "${aws_organizations_organizational_unit.production.name} (${aws_organizations_organizational_unit.production.id})"')); ok(/depends_on = \[aws_controltower_baseline\.production\]/.test(f)); ok(!/aws_organizations_account" "payments_prod"/.test(all(p))); ok(p.vars.get('account_factory_provisioning_artifact_id').def===undefined); });
t('lz Account Factory: OU must be registered and account SCP targets are refused',()=>{ ok(lzErr(lz('enterprise',c=>{const a=c.accounts.find(a=>a.key==='sandbox_dev');a.factory=true;a.ou='suspended';})).some(m=>/registered with Control Tower/.test(m))); const c=lz('enterprise',c=>{c.accounts.find(a=>a.key==='payments_prod').factory=true;}); scp(c,'leave',['acct:payments_prod']); ok(lzErr(c).some(m=>/Account Factory creates/.test(m))); });
// Outputs, variables, security, docs
t('lz outputs and variables',()=>{ const p=glz(lz('enterprise')); for(const o of ['organization_id','organization_root_id','management_account_id','organizational_unit_ids','organizational_unit_arns','account_ids','controltower_landing_zone_arn','controltower_registered_ou_baselines','controltower_enabled_controls']) ok(p.outs.has(o),'missing output '+o); for(const v of ['landing_zone_name','organization_feature_set','organizational_unit_names','accounts','account_role_name','controltower_governed_regions']) ok(p.vars.has(v),'missing var '+v); ok(p.vars.get('accounts').val.condition.includes('regex')); });
t('lz never generates credentials or passwords',()=>{ const c=lz('enterprise',c=>{c.accounts.find(a=>a.key==='payments_prod').factory=true;}); for(const tp of ['region','root','security','logging','encryption','leave']) scp(c,tp,['ou:sandbox']); c.scps=c.scps.slice(0,4); const a=all(glz(c)); ok(!/AKIA[0-9A-Z]{16}/.test(a)); ok(!/\b(access_key|secret_key|password|token)\s*=/.test(a)); ok(!/-----BEGIN/.test(a)); });
t('lz every resource type is documented and has a guide',()=>{ for(const ty of SVC[LZ].res) { ok(RES_INFO[ty],ty+' has no RES_INFO'); if(!ty.startsWith('data.')&&!ty.startsWith('aws_iam_')) ok(RES_GUIDE[ty],ty+' has no RES_GUIDE'); } const c=lz('enterprise',c=>{c.accounts.find(a=>a.key==='payments_prod').factory=true;c.accounts.find(a=>a.key==='payments_nonprod').mode='import';c.accounts.find(a=>a.key==='payments_nonprod').id='111122223333';}); scp(c,'leave',['root']); for(const ty of types(glz(c))) ok(SVC[LZ].res.includes(ty),ty+' is not declared in res'); });
t('lz learning topics are complete',()=>{ ok(LZ_TOPICS.length===17); for(const tp of LZ_TOPICS) { for(const k of ['t','concept','purpose','arch','tf','example','aws']) ok(tp[k],tp.t+' missing '+k); ok(tp.mistakes.length&&tp.reg.length,tp.t); ok(/^https:\/\/docs\.aws\.amazon\.com\//.test(tp.aws)); for(const r of tp.reg) ok(SVC[LZ].res.includes(r),r); } });
t('lz combined with other services',()=>{ lzOk(lz('enterprise'),['vpc','subnet','tgw','s3','backup','cloudwatch']); });
t('lz category layout prefixes files',()=>{ const n=gen([LZ],{[LZ]:lz('non-enterprise')},{layout:'category'}).files.map(f=>f.name); ok(n.includes('landingzone_organization.tf')&&n.includes('landingzone_custom_accounts.tf'),n.join(',')); });

console.log(`\nBackup, CloudWatch and Landing Zone tests: ${pass} passed, ${fails.length} failed`);
for(const f of fails) console.log('  FAIL '+f);
if(fails.length) process.exitCode=1;
