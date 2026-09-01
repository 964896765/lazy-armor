import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanIntentAdapterService } from '../ai-adapter/plan-intent-adapter.service';
import { PlansService } from '../plans/plans.service';
import { getPlanTemplateByKey, listPlanTemplates, resolvePlanTemplate } from './template-registry';
import { ZodError } from 'zod';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly plans: PlansService,
    private readonly adapter: PlanIntentAdapterService,
  ) {}

  list() {
    return listPlanTemplates().map((template) => ({
      key: template.key,
      domain: template.domain,
      group: template.group,
      name: template.name,
      description: template.description,
      icon: template.icon,
      templateVersion: template.templateVersion,
      status: template.status,
      automationLevel: template.automationLevel,
      requiredConnectors: template.requiredConnectors,
    }));
  }

  get(key: string) {
    const template = getPlanTemplateByKey(key);
    if (!template) throw new NotFoundException('Template not found');
    const fieldDefaults = Object.fromEntries(template.configFields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]));
    const defaultConfig = template.configSchema.safeParse(fieldDefaults).success
      ? template.configSchema.parse(fieldDefaults)
      : fieldDefaults;
    return {
      key: template.key,
      domain: template.domain,
      group: template.group,
      name: template.name,
      description: template.description,
      icon: template.icon,
      templateVersion: template.templateVersion,
      status: template.status,
      automationLevel: template.automationLevel,
      requiredConnectors: template.requiredConnectors,
      details: template.details,
      configFields: template.configFields,
      defaultConfig,
    };
  }

  install(userId: string, key: string, config?: Record<string, unknown>) {
    const resolved = this.safeResolve(key, config);
    if (!resolved) throw new NotFoundException('Template not found');
    return this.plans.createFromTemplate(userId, resolved.definition, resolved.metadata);
  }

  parseNaturalLanguage(query: string) {
    return this.adapter.generatePlanDraft(query);
  }

  async installFromNaturalLanguage(userId: string, query: string) {
    const generated = this.adapter.generatePlanDraft(query);
    if (!generated.canInstallDirectly) {
      throw new BadRequestException({
        message: 'Natural language plan draft requires more config',
        template: generated.template,
        config: generated.config,
        missingFields: generated.missingFields,
        humanSummary: generated.humanSummary,
      });
    }
    const resolved = this.safeResolve(generated.template.key, generated.config);
    if (!resolved) throw new NotFoundException('Template not found');
    const created = await this.plans.createFromTemplate(userId, resolved.definition, resolved.metadata);
    return {
      ...created,
      naturalLanguageSummary: generated.humanSummary,
      matchedTemplate: generated.template,
      generatedConfig: generated.config,
    };
  }

  createVersionFromTemplate(userId: string, planId: string, config?: Record<string, unknown>) {
    if (config && typeof config !== 'object') throw new BadRequestException('Invalid template config');
    return this.plans.createVersionFromTemplate(userId, planId, config);
  }

  private safeResolve(key: string, config?: Record<string, unknown>) {
    try {
      return resolvePlanTemplate(key, config);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ message: 'Invalid template config', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
      }
      throw error;
    }
  }
}
