export interface PlanCatalogGroup { title?: string; templates: readonly string[] }
export interface PlanDomainCatalog { key: string; label: string; english: string; description: string; groups: readonly PlanCatalogGroup[] }

export const PLAN_DOMAIN_CATALOG: readonly PlanDomainCatalog[] = [
  { key: "life", label: "日常", english: "life", description: "日常核心计划，由 AI 根据需求个性化", groups: [{ templates: ["今日重点","待办与提醒","日历整理","通知整理","文件整理","周期事项跟进","截止日期守护","生活缴费与订阅提醒"] }] },
  { key: "living", label: "生活", english: "living", description: "生活核心计划，由 AI 根据需求个性化", groups: [{ templates: ["生活采购","冰箱与食材管理","一周饮食安排","周末与休闲安排","本地活动与新店推荐","聚会与约会安排","快递退换货跟进","发票、保修与生活资料整理"] }] },
  { key: "family", label: "家庭", english: "family", description: "家庭核心计划，由 AI 根据需求个性化", groups: [{ templates: ["家庭日程协调","家务与家庭分工","家庭采购与补给","家庭快递管理","孩子接送与活动","家校消息整理","家人健康与复诊","家庭账单与消费","家庭维修与家电维护"] }] },
  { key: "health", label: "健康", english: "health", description: "健康核心计划，由 AI 根据需求个性化", groups: [{ templates: ["健康改善计划","运动计划","饮食与体重管理","睡眠改善","用药与复诊提醒","体检与就医准备","健康记录与指标分析","健康周期总结"] }] },
  { key: "finance", label: "财务", english: "finance", description: "财务核心计划，由 AI 根据需求个性化", groups: [{ templates: ["账单汇总","固定账单检查","消费分类与支出分析","订阅费用管理","财务资料整理","月度财务复盘","投资账户与持仓跟踪","公司与财报研究","市场与行业分析","资产配置与投资研究"] }] },
  { key: "work", label: "工作", english: "work", description: "工作核心计划，由 AI 根据需求个性化", groups: [{ templates: ["今日工作安排","周工作计划","项目管理","客户与协作跟进","工作消息与邮件整理","会议管理","汇报与总结","工作待办整理","内容发布与多平台分发"] }] },
  { key: "study", label: "学习", english: "study", description: "学习核心计划，由 AI 根据需求个性化", groups: [{ templates: ["学习计划","课程进度跟进","外语学习","阅读与笔记","知识整理","练习与错题分析","考试复习","研究与学习报告"] }] },
  { key: "information", label: "信息", english: "information", description: "信息核心计划，由 AI 根据需求个性化", groups: [{ templates: ["每日信息简报","行业研究","公司动态跟踪","政策与规则变化","技术与 AI 动态","主题长期追踪","信息核查与来源整理","热点与舆情跟踪"] }] },
  { key: "travel", label: "出行", english: "travel", description: "出行核心计划，由 AI 根据需求个性化", groups: [{ templates: ["旅行计划","行程与预订整理","目的地攻略","路线优化","机票酒店价格跟踪","航班与交通变化","签证与出发准备","行李与落地信息","旅行预算与结束整理"] }] },
  { key: "social", label: "人际", english: "social", description: "人际核心计划，由 AI 根据需求个性化", groups: [{ templates: ["待回复与承诺跟进","联系人关系维护","重要谈话准备","沟通与消息草稿","聚会与多人协调","生日纪念日与礼物","人际关系回顾"] }] },
  { key: "entertainment", label: "兴趣", english: "entertainment", description: "兴趣核心计划，由 AI 根据需求个性化", groups: [{ templates: ["影视推荐与更新","播客与内容订阅","演出展览与票务","游戏推荐与更新","游戏价格与攻略","体育赛事跟踪","户外活动准备","兴趣收藏与个人创作"] }] },
  { key: "asset", label: "资产", english: "asset", description: "资产核心计划，由 AI 根据需求个性化", groups: [{ templates: ["房屋维护","房租物业管理","家电保养","车辆维护","车辆证照与保险","设备耗材与维护","数字账号与安全","家庭资产与到期事项"] }] },
  { key: "identity", label: "事务", english: "identity", description: "事务核心计划，由 AI 根据需求个性化", groups: [{ templates: ["证件到期与换证","签证与证件材料","政务事项办理","办事材料准备","合同管理","法律事项资料","报销、发票与申报","重要资料归档与办理跟进"] }] },
];

export function catalogTemplateCount(domain: PlanDomainCatalog) {
  return domain.groups.reduce((total, group) => total + group.templates.length, 0);
}

export function coreTemplateIntent(domain: PlanDomainCatalog, name: string) {
  return '我想创建「' + domain.label + '」领域的「' + name + '」计划。请先询问我的具体目标、范围、周期与已有资源，再个性化细化；未经确认不要执行操作。';
}
