import { describe, expect, it } from 'vitest';
import { conversationContent, conversationKeyboardBehavior, emptyConversationRequest, shouldFollowConversation } from './conversation-content';

describe('conversation content', () => {
  it('preserves long prose, technical terms, Markdown and line breaks without summary filtering', () => {
    const content = '# 调研报告\n\nOAuth 与 schema\n' + '长内容与详细分析。'.repeat(5000) + '\nhttps://example.com/' + 'path'.repeat(500);
    expect(conversationContent(content)).toBe(content);
    expect(conversationContent('SCENARIO_NOT_RESOLVED')).toBe('SCENARIO_NOT_RESOLVED');
  });
  it('only substitutes genuinely empty messages', () => {
    expect(conversationContent('  \n')).toBe('请补充你的需求后继续');
    expect(conversationContent(undefined)).toBe('请补充你的需求后继续');
    expect(conversationContent('  保留正文  ')).toBe('  保留正文  ');
  });
  it('does not pull readers to the bottom while they are reading earlier content', () => {
    expect(shouldFollowConversation(4000, 600, 1200)).toBe(false);
    expect(shouldFollowConversation(4000, 600, 3370)).toBe(true);
    expect(shouldFollowConversation(300, 600, 0)).toBe(true);
  });

  it('creates fresh sessions without copying the previous plan, draft or template context', () => {
    expect(emptyConversationRequest('TEMPORARY')).toEqual({ method: 'POST', body: '{"mode":"TEMPORARY"}' });
    expect(JSON.parse(emptyConversationRequest('PLAN').body)).toEqual({ mode: 'PLAN' });
  });

  it('lets Android resize the window without a second keyboard height subtraction', () => {
    expect(conversationKeyboardBehavior('android')).toBeUndefined();
    expect(conversationKeyboardBehavior('web')).toBeUndefined();
    expect(conversationKeyboardBehavior('ios')).toBe('padding');
  });
});
