import { describe,it,expect } from 'vitest';
import { CANONICAL_PRODUCT_CATALOG,catalogTemplateCount } from '../src/product-catalog';
import {scenarioDefinitionByKey} from '../src/runtime-catalog';
import { CANONICAL_SCENARIOS,PRODUCT_DOMAINS } from '../src/product-model';
describe('Canonical Product Catalog',()=>{it('keeps 108 product entries separate from immutable runtime taxonomy',()=>{expect(CANONICAL_PRODUCT_CATALOG.domains).toHaveLength(13);expect(CANONICAL_PRODUCT_CATALOG.domains.reduce((sum,d)=>sum+catalogTemplateCount(d),0)).toBe(108);expect(CANONICAL_SCENARIOS).toHaveLength(96);expect(PRODUCT_DOMAINS).toHaveLength(19);});});

it('maps all product templates explicitly without implying verified runtime capabilities',()=>{expect(CANONICAL_PRODUCT_CATALOG.templates).toHaveLength(108);for(const template of CANONICAL_PRODUCT_CATALOG.templates){expect(template.scenarioMapping.scenarioKeys.length).toBeGreaterThan(0);expect(template.scenarioMapping.readinessClaim).toBe(false);for(const key of template.scenarioMapping.scenarioKeys)expect(scenarioDefinitionByKey(key),key).not.toBeNull();}});
