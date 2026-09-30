import type { ServicePlanProjection, ServiceSection } from './service-presenter';

export interface ServiceFilterOption {
  key: string;
  label: string;
  icon: string;
  color: string;
}
const option = (key: string, label: string, icon: string, color = '#6C87B6'): ServiceFilterOption => ({ key, label, icon, color });
const all = option('all', '全部', 'briefcase', '#1684FF');
const more = option('more', '更多', 'ellipsis-horizontal', '#7E8BA7');
const categories = [
  option('design', '设计创作', 'color-palette', '#AC74F5'),
  option('development', '开发技术', 'code-slash', '#7F97BD'),
  option('video', '视频影音', 'videocam', '#A365FF'),
  option('writing', '写作翻译', 'document-text', '#8C91D3'),
  option('marketing', '运营营销', 'bar-chart', '#FFA82B'),
  option('life', '生活服务', 'home', '#537ABB'),
];
export const SERVICE_FILTER_OPTIONS: Record<ServiceSection, readonly ServiceFilterOption[]> = {
  recommended: [all, ...categories, more],
  following: [option('all', '全部', 'grid', '#1684FF'), option('followed', '我关注的', 'heart', '#FF6286'), ...categories.slice(0, 5), more],
  nearby: [option('all', '全部', 'location', '#1684FF'), option('1km', '1km内', 'location', '#FF6684'), option('3km', '3km内', 'location', '#FFB444'), option('5km', '5km内', 'location', '#8B96B0'), option('10km', '10km内', 'location', '#FFB444'), option('city', '同城', 'business', '#748AB0'), option('campus', '校园', 'school', '#71A5BE'), more],
  active: [option('all', '全部', 'timer', '#1684FF'), option('running', '进行中', 'play-circle', '#9A69FF'), option('waiting', '待确认', 'time', '#FFA930'), option('payment', '待支付', 'checkbox', '#4D78C5'), option('completed', '已完成', 'checkmark-circle', '#2FC4B2'), option('cancelled', '已取消', 'close-circle', '#8995B0'), option('refunded', '已退款', 'return-up-back', '#FF627E'), more],
  publish: [all, option('review', '审核中', 'time-outline', '#8B96B0'), option('listed', '已上架', 'arrow-up', '#FFAF3B'), option('unlisted', '已下架', 'arrow-down', '#8896B2'), option('draft', '草稿', 'document-text-outline', '#8B96B0'), option('ended', '已结束', 'flame', '#FFB23F'), option('rejected', '已拒绝', 'close-circle', '#FF627E'), more],
};
export const EXTRA_SERVICE_FILTER_OPTIONS: Record<ServiceSection, readonly ServiceFilterOption[]> = {
  recommended: [option('education', '教育咨询', 'school', '#6B92DA'), option('health', '健康运动', 'fitness', '#45B8A4'), option('supply', '家庭补给', 'cube', '#F2A64A'), option('business', '企业服务', 'business', '#878BDC')],
  following: [categories[5], option('education', '教育咨询', 'school', '#6B92DA'), option('health', '健康运动', 'fitness', '#45B8A4'), option('supply', '家庭补给', 'cube', '#F2A64A')],
  nearby: [option('20km', '20km内', 'location', '#C88D4F'), option('50km', '50km内', 'location', '#8E96B2')],
  active: [option('paused', '已暂停', 'pause-circle', '#D2A347'), option('failed', '需处理', 'alert-circle', '#D86D75')],
  publish: [option('design', '设计创作', 'color-palette', '#AC74F5'), option('development', '开发技术', 'code-slash', '#7F97BD'), option('life', '生活服务', 'home', '#537ABB')],
};
export const CATEGORY_PATTERNS: Record<string, RegExp> = {
  design: /design|ppt|设计|美化|海报|图文/i,
  development: /code|program|website|开发|网站|小程序|编程|技术/i,
  video: /video|photo|视频|影音|摄影|拍摄|剪辑|航拍/i,
  writing: /write|translate|写作|翻译|简历|文案|文章/i,
  marketing: /marketing|运营|营销|推广|电商/i,
  life: /clean|repair|care|family|supply|生活|家庭|清洁|保洁|照护|维修|洗护|补给|纸品|收纳|入住/i,
  education: /study|learn|教育|学习|咨询|辅导/i,
  health: /health|fitness|健康|运动|训练|健身/i,
  supply: /supply|inventory|补给|库存|纸品|采购/i,
  business: /business|企业|工商|商务|财税/i,
};
export function matchesServiceCategory(text: string, key: string): boolean {
  return key === 'all' || Boolean(CATEGORY_PATTERNS[key]?.test(text));
}
export function filterServiceProjections(plans: readonly ServicePlanProjection[], section: ServiceSection, key: string): ServicePlanProjection[] {
  if (key === 'all') return [...plans];
  if (section === 'following' || section === 'nearby' || section === 'publish') return [];
  if (section === 'recommended') return plans.filter(plan => matchesServiceCategory([plan.name, plan.templateKey, plan.currentVersion?.name].filter(Boolean).join(' '), key));
  return plans.filter(plan => {
    const status = plan.status.toLowerCase();
    const execution = plan.latestExecution?.status.toLowerCase();
    switch (key) {
      case 'running': return !['waiting_approval', 'pending'].includes(execution ?? '') && (['active', 'running'].includes(status) || ['running', 'queued'].includes(execution ?? ''));
      case 'waiting': return ['waiting_approval', 'pending'].includes(execution ?? '');
      case 'completed': return status === 'completed' || ['succeeded', 'completed'].includes(execution ?? '');
      case 'cancelled': return ['cancelled', 'canceled'].includes(status) || ['cancelled', 'canceled'].includes(execution ?? '');
      case 'paused': return status === 'paused';
      case 'failed': return status === 'failed' || execution === 'failed';
      // Payment and refund facts are absent from this projection.
      default: return false;
    }
  });
}
export interface ServiceTabTap { section: ServiceSection; at: number }
export function isServiceTabDoubleTap(previous: ServiceTabTap | null, section: ServiceSection, at: number): boolean {
  return previous?.section === section && at >= previous.at && at - previous.at <= 350;
}
