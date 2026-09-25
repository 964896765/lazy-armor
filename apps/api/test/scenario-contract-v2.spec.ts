import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RuntimeCatalogRegistryService } from '../src/runtime-catalog/runtime-catalog-registry.service';

describe('RuntimeCatalogRegistryService Scenario Contract V2', () => {
  const service = new RuntimeCatalogRegistryService(null as never, null as never, null as never);

  it('returns only reviewed V2 sidecars while preserving the V1 endpoint authority', () => {
    const contract = service.getScenarioContractV2('daily_life.delivery');
    expect(contract.contractVersion).toBe(2);
    expect(contract.scenario).toEqual({ key: 'daily_life.delivery', revision: 2 });
    expect(contract.governance.state).toBe('DETERMINISTIC_SANDBOX');
  });

  it('does not fabricate a V2 contract for an existing unreviewed scenario', () => {
    expect(service.getScenario('finance.bill').key).toBe('finance.bill');
    expect(() => service.getScenarioContractV2('finance.bill')).toThrow(NotFoundException);
  });
});
