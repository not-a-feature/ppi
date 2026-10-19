INSERT INTO "user"(id,name,email,"emailVerified","createdAt")
SELECT 'load-user-'||i,'Synthetic Student '||i,
 'zx'||chr(97+((i-1)/67600)%26)||chr(97+((i-1)/2600)%26)||chr(97+((i-1)/100)%26)||lpad(((i-1)%100)::text,2,'0')||'@student.uni-tuebingen.de',true,
 now()-(i%1825)*interval '1 day' FROM generate_series(1,10000) i;
INSERT INTO ppi_user(user_id,is_admin,status) SELECT id,substring(id from 11)::integer<=10,'active' FROM "user";
INSERT INTO credit_account(user_id,balance) SELECT id,28 FROM "user";
INSERT INTO lecture(id,name,normalized_name,approval_status)
SELECT md5('lecture-'||i)::uuid,'Benchmark Lecture '||lpad(i::text,4,'0'),'benchmark lecture '||lpad(i::text,4,'0'),
 CASE WHEN i%20=0 THEN 'pending' ELSE 'approved' END FROM generate_series(1,1000) i;
INSERT INTO examiner(id,name,normalized_name)
SELECT md5('examiner-'||i)::uuid,'Synthetic Examiner '||i,'synthetic examiner '||i FROM generate_series(1,100) i;
INSERT INTO lecture_examiner(lecture_id,examiner_id)
SELECT md5('lecture-'||i)::uuid,md5('examiner-'||((i-1)%100+1))::uuid FROM generate_series(1,1000) i;
INSERT INTO submission(id,uploader_id,review_state,visibility,created_at)
SELECT md5('submission-'||i)::uuid,'load-user-'||(11+(i%9990)),
 CASE WHEN i%5=0 THEN 'awaiting_review' ELSE 'accepted' END,
 CASE WHEN i%5=0 THEN 'unpublished' ELSE 'published' END,
 now()-(i%1825)*interval '1 day'-(i%86400)*interval '1 second' FROM generate_series(1,50000) i;
INSERT INTO stored_file(id,storage_key,sha256,byte_count,media_type,original_name,safety_status)
SELECT md5('file-'||i||'-'||v)::uuid,md5('file-'||i||'-'||v),repeat('a',64),1024,'text/plain','protocol-'||i||'-'||v||'.txt','clean'
FROM generate_series(1,50000) i CROSS JOIN generate_series(1,2) v;
INSERT INTO submission_revision(id,submission_id,revision_number,file_id,examiner_id,term,remarks,attested,created_at)
SELECT md5('revision-'||i||'-'||v)::uuid,md5('submission-'||i)::uuid,v,md5('file-'||i||'-'||v)::uuid,
 md5('examiner-'||((i-1)%100+1))::uuid,'SS2026','Synthetic protocol for database load testing',true,
 now()-(i%1825)*interval '1 day'+v*interval '1 second'
FROM generate_series(1,50000) i CROSS JOIN generate_series(1,2) v;
UPDATE submission s SET current_revision_id=md5('revision-'||i||'-2')::uuid,
 published_revision_id=CASE WHEN i%5<>0 THEN md5('revision-'||i||'-2')::uuid END
FROM generate_series(1,50000) i WHERE s.id=md5('submission-'||i)::uuid;
INSERT INTO revision_lecture(revision_id,lecture_id)
SELECT md5('revision-'||i||'-'||v)::uuid,md5('lecture-'||((i-1)%1000+1))::uuid
FROM generate_series(1,50000) i CROSS JOIN generate_series(1,2) v;
INSERT INTO moderation_decision(revision_id,actor_id,outcome,public_feedback,created_at)
SELECT md5('revision-'||i||'-'||v)::uuid,'load-user-1',CASE WHEN v=1 THEN 'changes_requested' ELSE 'accepted' END,
 'Synthetic review',now()-(i%1825)*interval '1 day'+v*interval '1 minute'
FROM generate_series(1,50000) i CROSS JOIN generate_series(1,2) v WHERE v=1 OR i%5<>0;
INSERT INTO credit_entry(user_id,amount,kind,business_key,policy_version,reason,created_at)
SELECT 'load-user-'||i,CASE WHEN k%5=0 THEN -1 ELSE 2 END,
 CASE WHEN k%5=0 THEN 'purchase' ELSE 'periodic_grant' END,'load-credit-'||i||'-'||k,1,
 CASE WHEN k%5=0 THEN 'Benchmark Lecture 0001' ELSE 'Periodic grant' END,
 now()-k*interval '30 days' FROM generate_series(1,10000) i CROSS JOIN generate_series(1,20) k;
INSERT INTO lecture_access(user_id,lecture_id,starts_at,expires_at,policy_version)
SELECT 'load-user-'||i,md5('lecture-'||k)::uuid,now()-interval '1 day',now()+interval '27 days',1
FROM generate_series(1,10000) i CROSS JOIN generate_series(1,20) k;
INSERT INTO audit_event(actor_id,action,entity_id,detail,created_at)
SELECT 'load-user-'||((i-1)%10000+1),
 CASE i%4 WHEN 0 THEN 'auth.login' WHEN 1 THEN 'submission.created' WHEN 2 THEN 'submission.reviewed' ELSE 'lecture.purchased' END,
 md5('lecture-'||((i-1)%1000+1))::text,jsonb_build_object('source','synthetic-load-test','sequence',i),
 now()-(i%1825)*interval '1 day'-(i%86400)*interval '1 second' FROM generate_series(1,500000) i;
