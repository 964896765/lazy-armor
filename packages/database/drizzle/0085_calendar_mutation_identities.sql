INSERT INTO capability_identities(id,revision) VALUES ('calendar.event.delete','canonical-capability-v1');
--> statement-breakpoint
INSERT INTO capability_aliases(alias,canonical_id,revision) VALUES ('calendar.update','calendar.event.update','canonical-capability-v1'),('calendar.delete','calendar.event.delete','canonical-capability-v1');
