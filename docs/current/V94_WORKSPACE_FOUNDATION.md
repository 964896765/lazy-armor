# V94 PC 工作台首批界面

2026-10-12：新增消费者 `/workspace` 页面，复用现有 Expo Web 构建、账号及 owner-scoped Consumer API；Admin 运维面板保持独立。V94 IN_PROGRESS / REAL_PENDING。

宽屏采用三栏：左侧目标列表及计划、资源、能力中心、个人信息入口；中间原目标条件、最新答复和完整报告历史；右侧原投影给出的下一步、状态、时间与原方案入口。窄屏按同一顺序排布，不显示没有规则依据的完成百分比。Web“今天”新增工作台入口，手机导航不变。

目标从原 `/consumer/goal-experience` 读取，每次最多20条，保留截断和不可用标识。内容从原 owned Conversation 读取，严格核对请求ID；切换账号、目标时使用独立缓存key，读取失败时不继续显示旧内容。进行中的原报告继续按实际状态刷新，旧失败与旧完成版本分别可查看，不以任意成功报告代表当前任务成功。

首批完整正文沿原报告的安全文本展示，来源、提示词、本人决定及方案审阅打开原入口。页面本身不创建Plan、不执行外部操作、不替代原审批。当前还没有Markdown表格/图表排版、方案比较、复杂编辑、手机接力及稳定的PC会话；不要据三栏布局声称这些已经实现。

当前Web沿原访问令牌内存会话，页面明确提示刷新后重新登录；没有把refresh token写入localStorage。持久PC登录后续需独立的HttpOnly/Secure/SameSite Cookie及CSRF/BFF设计与回归，不使用Admin运维令牌，也不导出手机令牌。

## 验证

- `artifacts/v94-workspace-typecheck-r1.log`：Mobile/Web类型通过。
- `artifacts/v94-workspace-regression-r1.log`：4文件10/10（新工作台2项，其余原目标/组合/展示回归），覆盖不同目标拒绝及失败/历史报告区分。
- `artifacts/v94-workspace-web-build-r2.log`：最终Expo Web导出成功，能力入口沿原方法选择页，产物位于私有 `artifacts/v94-workspace-web-r2`。

自动审批拒绝启动带远程调试端口的浏览器，随后也拒绝单独启动本地预览服务，均仅返回“blocked by policy”，没有更具体原因。没有启动服务或浏览器，不把编译通过计为画面验收。认证后的PC目标/报告阅读、跨端真实旅程和视觉检查仍待验；未生产发布。
