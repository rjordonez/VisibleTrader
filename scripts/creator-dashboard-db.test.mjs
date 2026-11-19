import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {strict as assert} from 'node:assert'
const require=createRequire(`${process.env.PGLITE_PACKAGE_DIR||process.cwd()}/package.json`)
const {PGlite}=require('@electric-sql/pglite')
const db=new PGlite()
const ids={owner:'00000000-0000-0000-0000-000000000001',anthony:'00000000-0000-0000-0000-000000000002',stranger:'00000000-0000-0000-0000-000000000003',unverified:'00000000-0000-0000-0000-000000000004'}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now(),raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;`)
 for(const file of ['20261118195940_referral_payment_tracking.sql','20261119021330_private_creator_dashboard.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
 await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
 ('${ids.owner}','tavasyag@gmail.com',now()),('${ids.anthony}','anthony@example.invalid',now()),
 ('${ids.stranger}','outsider@example.invalid',now()),('${ids.unverified}','visibletraderhq@gmail.com',null);
 insert into creator_dashboard_access values('anthony@example.invalid','anthony',now());
 insert into creator_click_history values('anthony',16,'2026-10-01','2026-11-18') on conflict(creator) do update set clicks=16,measured_through='2026-11-18';
 insert into signup_attributions(account_id,user_id,referral_code,signed_up_at,finalized_at,source) values
 ('00000000-0000-0000-0000-000000000099',null,'anthony',now(),now(),'legacy');`)
 const auth=async id=>db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${id}';`)
 const read=async()=> (await db.query('select public.creator_dashboard() as report')).rows[0].report
 await auth(ids.owner)
 assert.equal((await read()).creators.length,21)
 await auth(ids.anthony)
 let report=await read();assert.equal(report.creators.length,1);assert.equal(report.creators[0].creator,'anthony');assert.equal(report.creators[0].signups,1);assert.equal(report.creators[0].clicks,16)
 await assert.rejects(()=>db.exec('select * from creator_dashboard_access'),/permission denied/)
 await assert.rejects(()=>db.exec("insert into creator_dashboard_access(email,creator) values('anthony@example.invalid','*')"),/permission denied/)
 await assert.rejects(()=>db.exec("select record_creator_link_click(gen_random_uuid(),'anthony',repeat('a',64))"),/permission denied/)
 await auth(ids.stranger);await assert.rejects(read,/does not have creator dashboard access/)
 await auth(ids.unverified);await assert.rejects(read,/does not have creator dashboard access/)
 await db.exec('reset role;set role anon');await assert.rejects(read,/permission denied/)
 await db.exec('reset role;set role service_role')
 const clickId='00000000-0000-0000-0000-000000000100'
 for(let i=0;i<2;i++)await db.query('select record_creator_link_click($1,$2,$3)',[clickId,'anthony','a'.repeat(64)])
 assert.equal((await db.query('select count(*)::int as n from creator_link_clicks')).rows[0].n,1)
 for(let i=0;i<29;i++)await db.query("select record_creator_link_click(gen_random_uuid(),'anthony',repeat('a',64))")
 assert.equal((await db.query("select record_creator_link_click(gen_random_uuid(),'anthony',repeat('a',64)) as accepted")).rows[0].accepted,false)
 await auth(ids.anthony);assert.equal((await read()).creators[0].clicks,46)
 // Removing access takes effect immediately, without waiting for JWT refresh.
 await db.exec("reset role;delete from creator_dashboard_access where email='anthony@example.invalid'")
 await auth(ids.anthony);await assert.rejects(read,/does not have creator dashboard access/)
 console.log('PASS: owner scope, creator isolation, anonymous denial, verified email, immediate revocation, private tables, unique clicks and atomic burst limit')
}catch(error){console.error(error.message);process.exitCode=1}finally{await db.close()}
