// V7 视觉宪法（对齐 Today 冷色浅主题）：淡蓝背景、近黑文字、冰蓝层次；状态色仅用于错误/警告/成功。
// 实测 Today：顶部 #ACCDEC，页面淡蓝 #EFF3F9~#DDEBF7，卡片冰蓝 #F0FAFE，导航纯白，选中近黑。
export const colors = {
  // 文本层级（近黑 + 冷灰）
  text: '#171717',
  textSecondary: '#686868',
  textMuted: '#8A97A3',

  // 背景与表面（淡蓝底 + 白卡片 + 冰蓝软底）
  background: 'transparent',
  surface: 'rgba(255,255,255,0.86)',
  accentSoft: 'rgba(255,255,255,0.52)',
  pressed: 'rgba(255,255,255,0.64)',

  // 主色即近黑（主操作/强调用黑色，与 Today 选中态一致）
  primary: '#171717',
  accent: '#171717',

  // 品牌冷蓝（Today 顶部柔蓝与氛围强调色）
  brand: '#6FA8DC',
  brandSoft: '#ACCDEC',

  // 线条与分隔（冷色细线）
  border: 'rgba(120, 146, 174, 0.26)',

  // 状态色（仅用于错误/警告/成功）
  success: '#0A9B67',
  warning: '#B54708',
  danger: '#D92D20',
  successSoft: '#EEF7F1',
  warningSoft: '#FEF4E6',
  dangerSoft: '#FEF0EF',
} as const;
