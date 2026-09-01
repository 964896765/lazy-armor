import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

export interface TemplateConfigFieldOption {
  value: string;
  label: string;
}

export interface TemplateConfigField {
  key: string;
  type: 'number' | 'boolean' | 'select' | 'multiselect' | 'text' | 'date' | 'time';
  required: boolean;
  label: string;
  helpText: string;
  defaultValue?: string | number | boolean | string[];
  min?: number;
  max?: number;
  options?: TemplateConfigFieldOption[];
}

export type TemplateConfigValue = string | boolean | string[];
export type TemplateConfigValues = Record<string, TemplateConfigValue>;

export function buildInitialTemplateConfig(
  fields: TemplateConfigField[],
  defaults: Record<string, unknown> | null | undefined,
  current: Record<string, unknown> | null | undefined,
) {
  const values: TemplateConfigValues = {};
  for (const field of fields) {
    const currentValue = current?.[field.key];
    const defaultValue = defaults?.[field.key] ?? field.defaultValue;
    const raw = currentValue ?? defaultValue;
    if (field.type === 'boolean') {
      values[field.key] = typeof raw === 'boolean' ? raw : Boolean(raw);
      continue;
    }
    if (field.type === 'multiselect') {
      values[field.key] = Array.isArray(raw) ? raw.map(String) : [];
      continue;
    }
    values[field.key] = raw === undefined || raw === null ? '' : String(raw);
  }
  return values;
}

export function normalizeTemplateConfig(
  fields: TemplateConfigField[],
  values: TemplateConfigValues,
) {
  const config: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (field.type === 'boolean') {
      config[field.key] = Boolean(raw);
      continue;
    }
    if (field.type === 'multiselect') {
      const items = Array.isArray(raw) ? raw.filter((item): item is string => Boolean(String(item).trim())).map((item) => String(item).trim()) : [];
      if (items.length > 0) config[field.key] = items;
      continue;
    }
    const text = String(raw ?? '').trim();
    if (!text) continue;
    if (field.type === 'number') {
      config[field.key] = Number(text);
      continue;
    }
    config[field.key] = text;
  }
  return config;
}

export function TemplateConfigForm({
  fields,
  values,
  onChange,
}: {
  fields: TemplateConfigField[];
  values: TemplateConfigValues;
  onChange: (key: string, value: TemplateConfigValue) => void;
}) {
  return (
    <View>
      {fields.map((field) => (
        <View key={field.key} style={local.block}>
          <Text style={local.label}>{field.label}{field.required ? ' *' : ''}</Text>
          {field.type === 'text' || field.type === 'number' || field.type === 'date' || field.type === 'time' ? (
            <TextInput
              style={local.input}
              keyboardType={field.type === 'number' ? 'numeric' : 'default'}
              placeholder={field.helpText}
              value={String(values[field.key] ?? '')}
              onChangeText={(text) => onChange(field.key, text)}
            />
          ) : null}
          {field.type === 'boolean' ? (
            <View style={local.switchRow}>
              <Text style={local.switchValue}>{values[field.key] ? '开启' : '关闭'}</Text>
              <Switch value={Boolean(values[field.key])} onValueChange={(next) => onChange(field.key, next)} />
            </View>
          ) : null}
          {field.type === 'select' ? (
            <View style={local.optionWrap}>
              {(field.options ?? []).map((option) => {
                const active = String(values[field.key] ?? '') === option.value;
                return (
                  <Pressable key={option.value} style={[local.option, active ? local.optionActive : null]} onPress={() => onChange(field.key, option.value)}>
                    <Text style={[local.optionText, active ? local.optionTextActive : null]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {field.type === 'multiselect' ? (
            <View style={local.optionWrap}>
              {(field.options ?? []).map((option) => {
                const rawSelected = values[field.key];
                const selected = Array.isArray(rawSelected)
                  ? rawSelected.filter((item): item is string => typeof item === 'string')
                  : [];
                const active = selected.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    style={[local.option, active ? local.optionActive : null]}
                    onPress={() => {
                      const next = active
                        ? selected.filter((item) => item !== option.value)
                        : [...selected, option.value];
                      onChange(field.key, next);
                    }}
                  >
                    <Text style={[local.optionText, active ? local.optionTextActive : null]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Text style={local.help}>{field.helpText}</Text>
        </View>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  block: { marginTop: 14 },
  label: { color: '#24342C', fontWeight: '700', marginBottom: 8, fontSize: 15 },
  input: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#FAFBFA' },
  help: { color: '#6B7770', marginTop: 6, lineHeight: 18 },
  switchRow: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FAFBFA', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchValue: { color: '#24342C', fontWeight: '600' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { borderWidth: 1, borderColor: '#D9DEDA', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FAFBFA' },
  optionActive: { borderColor: '#287052', backgroundColor: '#EAF5EF' },
  optionText: { color: '#425149', fontWeight: '600' },
  optionTextActive: { color: '#287052' },
});
