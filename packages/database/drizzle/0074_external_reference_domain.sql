ALTER TABLE `external_service_references` ADD COLUMN `domain` varchar(24);
--> statement-breakpoint
UPDATE `external_service_references` SET `domain` = CASE `category` WHEN '生活' THEN 'life' WHEN '家庭' THEN 'family' WHEN '出行' THEN 'travel' WHEN '健康' THEN 'health' WHEN '工作' THEN 'work' WHEN '其他' THEN 'other' ELSE NULL END;
