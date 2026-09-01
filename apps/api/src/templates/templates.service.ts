import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { getPlanTemplateByKey, listPlanTemplates, resolvePlanTemplate } from './template-registry';
import { ZodError } from 'zod';

@Injectable()
export class TemplatesService {
  constructor(private readonly plans: PlansService) {}

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
      defaultConfig: template.configSchema.parse({}),
    };
  }

  install(userId: string, key: string, config?: Record<string, unknown>) {
    const resolved = this.safeResolve(key, config);
    if (!resolved) throw new NotFoundException('Template not found');
    return this.plans.createFromTemplate(userId, resolved.definition, resolved.metadata);
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
