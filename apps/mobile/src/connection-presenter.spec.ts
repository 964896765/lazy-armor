import { describe, expect, it } from 'vitest';
import { connectionBucket, connectionBucketLabel, isDeveloperConnector, mobileAppStateLabel, splitCapabilitiesByOperation } from './connection-presenter';

describe('Connection presenter consumer grouping', () => {
  it('groups connections into the four top-level buckets', () => {
    expect(connectionBucket('gmail', 'provider')).toBe('ONLINE_SERVICES');
    expect(connectionBucket('com.taobao', 'device_app')).toBe('PHONE_APPS');
    expect(connectionBucket('trusted-device', 'trusted_device')).toBe('DEVICES');
    expect(connectionBucket('mcp', 'provider')).toBe('DEVELOPER');
    expect(connectionBucketLabel('DEVELOPER')).toBe('开发者连接');
  });

  it('recognizes developer/MCP connectors without highlighting them to normal users', () => {
    expect(isDeveloperConnector('mcp')).toBe(true);
    expect(isDeveloperConnector('gmail', 'oauth2')).toBe(false);
    expect(isDeveloperConnector('github', 'mcp')).toBe(true);
  });

  it('translates mobile app states into consumer language', () => {
    expect(mobileAppStateLabel('INSTALLED')).toBe('已安装');
    expect(mobileAppStateLabel('SUPPORTED')).toBe('支持连接');
    expect(mobileAppStateLabel('AUTHORIZED')).toBe('已授权');
    expect(mobileAppStateLabel('HEALTHY')).toBe('运行正常');
    expect(mobileAppStateLabel('ONLINE')).toBe('手机在线');
    expect(mobileAppStateLabel('AVAILABLE')).toBe('当前可用');
    expect(mobileAppStateLabel('UNKNOWN')).toBe('暂不可用');
  });

  it('splits capabilities into readable vs executable', () => {
    const { reads, executes } = splitCapabilitiesByOperation([
      { key: 'READ_TRACKING', operation: 'READ' },
      { key: 'CREATE_EVENT', operation: 'EXECUTE' },
      { key: 'RECEIVE_WEBHOOK', operation: 'SUBSCRIBE' },
    ]);
    expect(reads).toEqual(['READ_TRACKING', 'RECEIVE_WEBHOOK']);
    expect(executes).toEqual(['CREATE_EVENT']);
  });
});
