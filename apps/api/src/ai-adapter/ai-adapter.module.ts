import { Module } from '@nestjs/common';
import { PlanIntentAdapterService } from './plan-intent-adapter.service';
import { AgentContextCompiler } from './agent-context-compiler.service';
import { FakeAgentModel, FixtureAgentModel } from './agent-model-adapter';
import { AGENT_MODEL, AgentPlannerService } from './agent-planner.service';
import { PortableSkillsModule } from '../portable-skills/portable-skills.module';
import { RuntimeCatalogModule } from '../runtime-catalog/runtime-catalog.module';
import { RealityPipelineModule } from '../reality-pipeline/reality-pipeline.module';
import { McpModule } from '../mcp/mcp.module';
import { AuditModule } from '../audit/audit.module';

// Adapter boundary only; the Agent Planner extends this module, it is not a
// second Agent Engine. The model is swappable via the AGENT_MODEL token.
@Module({
  imports: [PortableSkillsModule, RuntimeCatalogModule, RealityPipelineModule, McpModule, AuditModule],
  providers: [
    PlanIntentAdapterService,
    AgentContextCompiler,
    FakeAgentModel,
    FixtureAgentModel,
    AgentPlannerService,
    { provide: AGENT_MODEL, useExisting: FixtureAgentModel },
  ],
  exports: [PlanIntentAdapterService, AgentContextCompiler, AgentPlannerService, AGENT_MODEL],
})
export class AiAdapterModule {}
