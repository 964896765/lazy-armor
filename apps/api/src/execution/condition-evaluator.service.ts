import { Injectable } from '@nestjs/common';
import { canonicalStringify, type JsonValue, type NormalizedCondition } from '@lazy-armor/plan-schema';
import { ExecutionRuntimeError } from './execution.types';

type Context = Record<string, unknown>;

@Injectable()
export class ConditionEvaluator {
  evaluate(conditions: NormalizedCondition[], context: Context): boolean {
    if (conditions.length === 0) return true;
    let aggregate: boolean | undefined;
    for (const condition of [...conditions].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const result = this.evaluateOne(condition, context);
      aggregate = aggregate === undefined ? result : condition.logicalOperator === 'AND' ? aggregate && result : aggregate || result;
    }
    return aggregate ?? true;
  }

  evaluateOne(condition: NormalizedCondition, context: Context): boolean {
    const { exists, value } = this.readPath(context, condition.fieldPath);
    const expected = condition.comparisonValue;
    switch (condition.operator) {
      case 'EXISTS': return exists;
      case 'NOT_EXISTS': return !exists;
      case 'EQ': return this.stable(value) === this.stable(expected);
      case 'NE': return this.stable(value) !== this.stable(expected);
      case 'GT': return this.numbers(value, expected, (a, b) => a > b);
      case 'GTE': return this.numbers(value, expected, (a, b) => a >= b);
      case 'LT': return this.numbers(value, expected, (a, b) => a < b);
      case 'LTE': return this.numbers(value, expected, (a, b) => a <= b);
      case 'IN': return this.array(expected, condition.operator).some((item) => this.stable(item) === this.stable(value));
      case 'NOT_IN': return !this.array(expected, condition.operator).some((item) => this.stable(item) === this.stable(value));
      case 'CONTAINS':
        if (typeof value === 'string' && typeof expected === 'string') return value.includes(expected);
        if (Array.isArray(value)) return value.some((item) => this.stable(item) === this.stable(expected));
        throw this.invalid('CONTAINS requires a string or array source value');
      case 'CHANGED': {
        const pair = this.changePair(value);
        return this.stable(pair.previous) !== this.stable(pair.current);
      }
      case 'PERCENT_CHANGE_GT': {
        const pair = this.changePair(value);
        if (typeof pair.previous !== 'number' || typeof pair.current !== 'number' || typeof expected !== 'number' || pair.previous === 0) throw this.invalid('PERCENT_CHANGE_GT requires non-zero numeric previous/current values');
        return Math.abs(((pair.current - pair.previous) / pair.previous) * 100) > expected;
      }
      case 'TIME_RANGE': {
        const range = this.array(expected, condition.operator);
        if (range.length !== 2 || typeof value !== 'string' || typeof range[0] !== 'string' || typeof range[1] !== 'string') throw this.invalid('TIME_RANGE requires a string value and [start,end]');
        const point = this.time(value); const start = this.time(range[0]); const end = this.time(range[1]);
        return start <= end ? point >= start && point <= end : point >= start || point <= end;
      }
    }
  }

  private readPath(context: Context, path: string): { exists: boolean; value: unknown } {
    let current: unknown = context;
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, part)) return { exists: false, value: undefined };
      current = (current as Record<string, unknown>)[part];
    }
    return { exists: true, value: current };
  }

  private numbers(left: unknown, right: JsonValue | null, compare: (a: number, b: number) => boolean) {
    if (typeof left !== 'number' || typeof right !== 'number' || !Number.isFinite(left) || !Number.isFinite(right)) throw this.invalid('Numeric comparison requires finite numbers');
    return compare(left, right);
  }

  private array(value: JsonValue | null, operator: string): JsonValue[] {
    if (!Array.isArray(value)) throw this.invalid(`${operator} requires an array`);
    return value;
  }

  private changePair(value: unknown): { previous: unknown; current: unknown } {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('previous' in value) || !('current' in value)) throw this.invalid('Change operator requires {previous,current}');
    return value as { previous: unknown; current: unknown };
  }

  private time(value: string): number {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw this.invalid('Time must use HH:mm');
    const hours = Number(match[1]); const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) throw this.invalid('Time must use valid HH:mm');
    return hours * 60 + minutes;
  }

  private stable(value: unknown) { return canonicalStringify(value); }
  private invalid(message: string) { return new ExecutionRuntimeError('CONDITION_INPUT_INVALID', message, false); }
}
