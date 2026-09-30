const fs=require('fs');
const src=['catalog.js','engine.js','learn.js'].map(f=>fs.readFileSync(f,'utf8').replace(/if \(typeof module[^\n]*\n/,'')).join('\n');
const vm=require('vm'); const ctx={console}; vm.createContext(ctx); vm.runInContext(src+'\nthis.API={SERVICES,SVC,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL,depsOf,RES_INFO,RES_GUIDE};',ctx);
const {SERVICES,SVC,PRESETS,generateProject,validateProject,DEFAULT_GLOBAL,highlightHCL,depsOf,RES_INFO,RES_GUIDE}=ctx.API;
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

console.log(`\nBackup and CloudWatch tests: ${pass} passed, ${fails.length} failed`);
for(const f of fails) console.log('  FAIL '+f);
if(fails.length) process.exitCode=1;
