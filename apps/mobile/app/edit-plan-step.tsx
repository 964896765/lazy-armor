import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, EditorPage, Field, ui } from '../src/editor-ui';
import { PlanResources } from '../src/plan-resources';
import { usePlanDraft } from '../src/plan-editor-store';
export default function EditStep() { const { id } = useLocalSearchParams<{ id: string }>(); const draft = usePlanDraft(); const original = draft.steps.find(s => s.id === id); const [step, setStep] = useState(original); const [error, setError] = useState(''); if (!step) return <EditorPage title="编辑步骤"><Text>步骤不存在或已删除</Text></EditorPage>;
 return <EditorPage title="编辑步骤" action={<Pressable accessibilityLabel="删除步骤" onPress={() => { draft.update({ steps: draft.steps.filter(s => s.id !== id) }); router.back(); }}><Text style={ui.error}>删除</Text></Pressable>}><Text style={[ui.detail, { textAlign: 'center' }]}>用于修改这一步的内容、资源和完成条件</Text><Card><Field label="步骤名称" value={step.name} onChange={name => setStep({ ...step, name })} max={50} /><Field label="这一步做什么？" value={step.description} onChange={description => setStep({ ...step, description })} multiline /><Text style={ui.title}>需要哪些资源？</Text><PlanResources selected={step.resources} onChange={resources => setStep({ ...step, resources })} /><Field label="完成条件（选填）" value={step.completion} onChange={completion => setStep({ ...step, completion })} multiline />{error ? <Text style={ui.error}>{error}</Text> : null}<Button label="保存" onPress={() => { if (!step.name.trim()) return setError('请填写步骤名称'); draft.update({ steps: draft.steps.map(s => s.id === id ? step : s) }); router.back(); }} /></Card></EditorPage>; }

