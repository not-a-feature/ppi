DROP INDEX credit_entry_user_created;
CREATE INDEX credit_entry_user_created_id ON credit_entry(user_id,created_at DESC,id DESC);
DROP INDEX submission_uploader_created;
CREATE INDEX submission_uploader_created_id ON submission(uploader_id,created_at DESC,id DESC);
CREATE INDEX audit_event_purchase_lookup ON audit_event(actor_id,action,created_at);
CREATE INDEX moderation_decision_revision_created_id ON moderation_decision(revision_id,created_at,id);
CREATE INDEX reconsideration_revision_created_id ON reconsideration(revision_id,created_at,id);

CREATE INDEX audit_event_created_id ON audit_event(created_at DESC,id DESC);
CREATE INDEX token_request_created_id ON token_request(created_at DESC,id DESC);
CREATE INDEX token_request_pending_created_id ON token_request(created_at DESC,id DESC) WHERE status='pending';
CREATE INDEX content_report_created_id ON content_report(created_at DESC,id DESC);
CREATE INDEX content_report_open_created_id ON content_report(created_at DESC,id DESC) WHERE status='open';
CREATE INDEX submission_created_id ON submission(created_at,id);
CREATE INDEX submission_pending_created_id ON submission(created_at,id)
  WHERE files_deleted_at IS NULL AND review_state IN ('processing','awaiting_review','changes_requested');
CREATE INDEX lecture_name_id ON lecture(name,id);
CREATE INDEX user_email_id ON "user"(email,id);
