export type GoalCapabilityState = 'catalog_only' | 'mapped';

export interface GoalCapability {
  key: string;
  name: string;
  description: string;
  state: GoalCapabilityState;
}

export interface GoalCapabilityCategory {
  key: string;
  name: string;
  capabilities: readonly GoalCapability[];
}

export interface GoalCapabilityGroup {
  key: string;
  name: string;
  description: string;
  categories: readonly GoalCapabilityCategory[];
}

type Definition = readonly [name: string, description: string];

function category(key: string, name: string, definitions: readonly Definition[]): GoalCapabilityCategory {
  return {
    key,
    name,
    capabilities: definitions.map(([capabilityName, description], index) => ({
      key: `${key}.${String(index + 1).padStart(2, '0')}`,
      name: capabilityName,
      description,
      // 目录项不是实现证明。只有经过运行时映射和验收后才可改为 mapped。
      state: 'catalog_only' as const,
    })),
  };
}

export const GOAL_CAPABILITY_GROUPS: readonly GoalCapabilityGroup[] = [
  {
    key: 'information_acquisition', name: '信息获取', description: '获取现实信息', categories: [
      category('query_retrieval', '查询检索', [['搜索', '搜索指定的信息或内容'], ['查询', '查询指定对象的状态或数据'], ['查找', '定位文件、记录、联系人等'], ['筛选', '按条件找到符合要求的信息'], ['信息订阅', '持续获取指定主题的信息']]),
      category('collection_input', '采集录入', [['收集', '从指定来源收集信息'], ['扫描', '扫描纸质材料、二维码等'], ['记录', '记录用户提供的信息'], ['导入', '导入文件、表格或其他数据'], ['数据同步采集', '从已连接来源获取更新']]),
      category('recognition_extraction', '识别提取', [['OCR文字识别', '从图片中识别文字'], ['语音转写', '将语音转换为文字'], ['内容提取', '提取指定字段和关键信息'], ['对象识别', '识别图片、视频中的指定对象'], ['文档解析', '解析文档结构和数据']]),
      category('monitoring_sensing', '监测感知', [['状态监测', '持续关注指定对象的状态'], ['变化检测', '检测信息或状态发生的变化'], ['异常发现', '识别符合预设条件的异常'], ['进度追踪', '持续获取事项进展'], ['阈值监测', '判断数据是否达到预设阈值']]),
    ],
  },
  {
    key: 'information_processing', name: '信息处理', description: '整理、计算、分析与验证信息', categories: [
      category('organization_classification', '整理分类', [['分类', '按指定规则分类'], ['去重', '删除或标记重复信息'], ['排序', '按时间、重要性等排序'], ['汇总', '合并并概括多项信息'], ['归档', '按规则整理和归档资料']]),
      category('accounting_statistics', '核算统计', [['计算', '执行数学与规则计算'], ['记账', '形成标准化收支记录'], ['核算', '按规则核算费用或数据'], ['统计', '统计数量、频率及指标'], ['结算', '计算应收、应付及结算结果']]),
      category('analysis_comparison', '分析比较', [['数据分析', '分析数据特征及关联'], ['趋势分析', '识别数据随时间变化的趋势'], ['对比', '比较多个对象或方案'], ['评估', '按指定标准评估结果'], ['预测', '根据已有数据生成预测']]),
      category('verification_review', '核验复核', [['数据核对', '检查数据是否一致'], ['结果验证', '根据证据判断结果'], ['差异检查', '识别并列出数据差异'], ['回执核实', '核实操作回执及业务状态'], ['完整性检查', '检查必要资料是否齐全']]),
    ],
  },
  {
    key: 'planning_organization', name: '计划组织', description: '安排时间、任务、人员与资源', categories: [
      category('calendar_scheduling', '日历排程', [['日历管理', '创建和管理日历事项'], ['日程安排', '安排具体事项的执行时间'], ['预约排程', '安排预约事项及时间'], ['周期排程', '设置重复执行时间'], ['时间协调', '检测和协调时间冲突']]),
      category('reminder_followup', '提醒跟进', [['定时提醒', '在指定时间提醒'], ['条件提醒', '满足指定条件后提醒'], ['催办', '对尚未完成的事项发出催办'], ['持续跟进', '按规则持续处理未完成事项'], ['周期回访', '定期回访或检查事项']]),
      category('communication_collaboration', '沟通协作', [['消息沟通', '通过受支持的渠道交换消息'], ['邮件处理', '准备、整理或发送邮件'], ['状态通知', '向相关人员发送事项通知'], ['信息共享', '向授权对象共享指定信息'], ['任务协同', '协调多人参与的任务']]),
      category('preparation_orchestration', '筹备编排', [['清单准备', '自动生成需要准备的事项清单'], ['资源安排', '安排执行任务所需的资源'], ['流程编排', '组织多个能力的执行顺序'], ['任务分配', '将任务分配给指定执行主体'], ['前置条件检查', '检查执行前是否满足必要条件']]),
    ],
  },
  {
    key: 'content_production', name: '内容生产', description: '制作文字、图片、音频与视频', categories: [
      category('capture_recording', '拍摄录制', [['拍照', '拍摄或辅助拍摄照片'], ['录像', '拍摄或辅助拍摄视频'], ['录音', '录制声音'], ['屏幕录制', '录制设备屏幕内容'], ['素材采集', '采集和整理拍摄素材']]),
      category('generation_creation', '生成创作', [['文案生成', '生成文章、标题、脚本等'], ['图片生成', '根据要求生成图片'], ['音频生成', '生成配音、声音等内容'], ['视频生成', '根据素材或描述生成视频'], ['文档生成', '生成结构化文档']]),
      category('editing_processing', '编辑加工', [['剪辑', '剪辑视频和音频'], ['裁剪', '裁剪图片、视频等素材'], ['修图', '编辑、调整或修复图片'], ['字幕制作', '生成、编辑和同步字幕'], ['格式转换', '转换文件或媒体格式']]),
    ],
  },
  {
    key: 'delivery_execution', name: '交付执行', description: '保存、传播成果并执行实际事务', categories: [
      category('save_sync', '保存同步', [['保存', '保存指定内容或结果'], ['备份', '创建文件或数据备份'], ['上传', '向指定且授权的位置上传'], ['下载', '从指定来源下载资料'], ['跨端同步', '在授权设备之间同步数据']]),
      category('publish_distribution', '发布分发', [['内容发布', '向指定平台发布内容'], ['定时发布', '在指定时间发布内容'], ['多平台分发', '向多个指定平台分发内容'], ['内容转发', '转发已有内容'], ['批量分发', '向多个经过授权的目标分发']]),
      category('transaction_execution', '事务执行', [['表单提交', '提交指定表单或申请'], ['预约办理', '通过支持的渠道发起预约'], ['订单发起', '根据用户授权发起订单'], ['设备控制', '控制已授权的设备功能'], ['人工任务交接', '将无法自动完成的步骤交给用户或指定人员']]),
    ],
  },
];

export const GOAL_CAPABILITY_CATEGORIES = GOAL_CAPABILITY_GROUPS.flatMap((group) => group.categories);
export const GOAL_CAPABILITIES = GOAL_CAPABILITY_CATEGORIES.flatMap((item) => item.capabilities);

export function findGoalCapabilities(query: string): readonly GoalCapability[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return GOAL_CAPABILITIES;
  return GOAL_CAPABILITIES.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase('zh-CN').includes(normalized));
}
