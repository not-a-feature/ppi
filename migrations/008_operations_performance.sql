CREATE INDEX email_outbox_expiring_body ON email_outbox(expires_at,id) WHERE body<>'';
CREATE INDEX auth_email_token_expiry ON auth_email_token(expires_at,token_hash);
CREATE INDEX rate_limit_last_request ON "rateLimit"("lastRequest",id);
CREATE INDEX lecture_archive_expiring_file ON lecture_archive(expires_at,id) WHERE storage_key IS NOT NULL;
