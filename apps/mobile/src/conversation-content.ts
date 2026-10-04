export function conversationContent(value: string | null | undefined) {
  return value?.trim() ? value : '请补充你的需求后继续';
}

export function shouldFollowConversation(contentHeight: number, viewportHeight: number, offset: number) {
  return contentHeight - viewportHeight - offset < 80;
}

export function emptyConversationRequest(mode: 'TEMPORARY' | 'PLAN') {
  return { method: 'POST' as const, body: JSON.stringify({ mode }) };
}

export function conversationKeyboardBehavior(platform: string) {
  return platform === 'ios' ? 'padding' as const : undefined;
}
