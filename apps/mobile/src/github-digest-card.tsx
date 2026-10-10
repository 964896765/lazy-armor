import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { githubDigestSchema } from '@lazy-armor/plan-schema/mobile';
import { Button, Card, ui } from './editor-ui';

export function GithubDigestCard({ outputs, delivered }: { outputs?: Array<{ output: Record<string, unknown> }>; delivered: boolean }) {
  const [prompt, setPrompt] = useState(false), [proof, setProof] = useState(false);
  const parsed = githubDigestSchema.safeParse(outputs?.find(o => o.output.githubDigest)?.output.githubDigest);
  if (!parsed.success) return null;
  const digest = parsed.data;
  return <Card title="GitHub 日榜前 10" detail={delivered ? '摘要已保存并发送站内通知' : '已生成摘要，本次发送尚未完成'}>
    <Text style={ui.detail}>{new Date(digest.source.retrievedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）· 所有语言</Text>
    <Text style={ui.detail}>{digest.overview}</Text>
    <Text style={ui.detail}>{digest.baselineAt ? `名次对比：上次成功读取 ${new Date(digest.baselineAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '本次没有历史对比基线，以下为当前榜单。'}</Text>
    {digest.source.repositories.map((repo, index) => { const item = digest.items[index]!; return <View key={repo.fullName} style={ui.listRow}>
      <Text selectable style={ui.title}>{repo.rank}. {repo.fullName}</Text><Text style={ui.detail}>{item.summary}</Text>
      <Text style={ui.detail}>{repo.language ?? '语言未标明'} · 总星标 {repo.stars ?? '未取得'} · 今日新增 {repo.todayStars ?? '未取得'}</Text>
      {digest.baselineAt ? <Text style={ui.detail}>{item.previousRank === null ? '上次前 10 未出现' : item.previousRank === repo.rank ? '名次未变' : `上次第 ${item.previousRank} → 本次第 ${repo.rank}`}</Text> : null}
      <Button secondary label="打开仓库" onPress={() => { void Linking.openURL(repo.url); }} />
    </View>; })}
    <Text style={ui.detail}>榜单只反映读取时刻的公开网页；项目用途为 AI 根据网页描述生成，未读取提交或发行日志。</Text>
    <Button secondary label="打开日榜来源" onPress={() => { void Linking.openURL(digest.source.url); }} />
    <Button secondary label={prompt ? '收起自动提示词' : '查看自动提示词'} onPress={() => setPrompt(!prompt)} />
    {prompt ? <Text selectable style={ui.detail}>{digest.prompt}</Text> : null}
    <Button secondary label={proof ? '收起读取依据' : '查看读取依据'} onPress={() => setProof(!proof)} />
    {proof ? <Text selectable style={ui.detail}>原页面 SHA256：{digest.source.sha256}{'\n'}模型：{digest.modelId}</Text> : null}
  </Card>;
}
