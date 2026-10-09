CREATE TABLE agent_task_graphs (
  id binary(16) NOT NULL PRIMARY KEY,
  user_id binary(16) NOT NULL,
  plan_id binary(16) NULL,
  plan_version_id binary(16) NULL,
  execution_id binary(16) NOT NULL,
  status varchar(32) NOT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY agent_task_graph_execution_uq (execution_id),
  KEY agent_task_graph_owner_plan_idx (user_id, plan_id, created_at, id),
  CONSTRAINT agent_task_graph_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT agent_task_graph_plan_fk FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
  CONSTRAINT agent_task_graph_version_fk FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE RESTRICT,
  CONSTRAINT agent_task_graph_execution_fk FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE agent_tasks (
  id binary(16) NOT NULL PRIMARY KEY,
  graph_id binary(16) NOT NULL,
  parent_task_id binary(16) NULL,
  execution_step_id binary(16) NULL,
  task_order int NOT NULL,
  title varchar(200) NOT NULL,
  status varchar(32) NOT NULL,
  priority int NOT NULL DEFAULT 5,
  depends_on_json json NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  resource_lock varchar(100) NOT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  UNIQUE KEY agent_task_graph_order_uq (graph_id, task_order),
  UNIQUE KEY agent_task_step_uq (execution_step_id),
  CONSTRAINT agent_task_graph_fk FOREIGN KEY (graph_id) REFERENCES agent_task_graphs(id) ON DELETE RESTRICT,
  CONSTRAINT agent_task_parent_fk FOREIGN KEY (parent_task_id) REFERENCES agent_tasks(id) ON DELETE RESTRICT,
  CONSTRAINT agent_task_step_fk FOREIGN KEY (execution_step_id) REFERENCES execution_steps(id) ON DELETE RESTRICT
);
