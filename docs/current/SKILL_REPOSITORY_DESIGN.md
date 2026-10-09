# Skill仓库最终设计基线（2026-10-07）

用户正式设计，P6 实施；当前只冻结合同，不宣称 Repository/Entry/检索/同步已实现。2026-10-09当前P1/P2已CLOSED，唯一开发主线为P3收口；等待真实数据时只准备P6设计，不开发。最新方法/资源组合及Candidate/Truth边界见 [P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)，下文2026-10-07基线保留。

懒人装甲 Skill仓库最终设计
一、先把概念彻底定清楚
以后统一分四层：
Skill仓库体系
    ↓
SkillRepository
一个具体仓库/集合
    ↓
SkillEntry / Recipe
仓库中的单条方法、经验、玩法
    ↓
Planner Composition
根据用户目标检索并组合 0～N 条
    ↓
Action Proposal / Plan Draft

例如：
GitHub
jasonbitsmith/muse-skills

在懒人装甲里应该是：
SkillRepository
名称：Muse 技能库
来源：GitHub

而仓库里面的：
Gmail 邮箱管家
Google 日历
快递异常件提醒
天气突变提醒
……

才分别成为：
SkillEntry / Recipe

所以以后绝对不要再写：
Skill
→ 创建 Plan

正确的是：
Goal
↓
Planner
↓
从一个或多个 SkillRepository
检索 0～N 个 SkillEntry
↓
结合 Truth / Resource / Policy
↓
动态编排
↓
临时需求 → Action Proposal
持续需求 → Plan Draft → Plan

二、Skill仓库在前端放哪里
五个一级导航继续不变：
日程 | 计划 | 会话 | 资源 | 服务

计划页：
计划

Skill仓库 | 我的计划                         +

这里两者职责：
区域	职责
Skill仓库	系统可以参考哪些方法、Recipe、工作流经验
我的计划	用户已经确认并持续运行的 Plan


Skill仓库不是第六个一级导航，也不塞进“资源”。
三、右上角 + 的最终定义
既然 Skill仓库是仓库集合，右上角 + 最好不要再叫“新建计划”，也不建议叫“接入 Skill”。
正式叫：
接入

点击：
接入到 Skill仓库

从 GitHub 接入
从 URL 接入
上传仓库 / 文件
AI 创建仓库内容

未来再增加：
从现有 Plan 提炼

所以：
+
= 接入 Skill 来源

而不是：
+
= 创建 Plan

Plan 仍主要通过自然语言会话形成。
四、Skill仓库首页
建议最终：
计划                                             +

Skill仓库                  我的计划


[ 搜索 Skill、仓库、作者…… ]


推荐   官方   GitHub   社区   我的


推荐给你
────────────────────────

快递异常跟进
来自 Muse 技能库 · GitHub
异常才提醒，不打扰正常物流                 >

商业可行性研究
官方
市场 · 竞争 · 成本 · 风险                  >

每周工作总结
官方
收集记录 · 汇总 · 提取下一步                >


已接入仓库
────────────────────────

Muse 技能库
GitHub · jasonbitsmith/muse-skills
300 条左右内容 · 已同步                    >

我的工作方法
私人仓库
12 条                                    >

这里同时存在两个维度：
Repository
仓库/集合

Entry
仓库里的内容

用户不用先理解技术区别，但后台一定要分开。
五、正式来源体系
Skill仓库体系支持：
官方
GitHub
社区
我的

推荐只是聚合：
推荐
= 从所有可用仓库中推荐 Entry

后台可以定义：
RepositorySourceType

OFFICIAL
GITHUB
COMMUNITY
USER
GENERATED

GENERATED 前端归“我的”。
六、GitHub 在这里是什么
GitHub 是正式仓库来源，不是仅仅一个导入按钮。
例如：
计划
→ Skill仓库
→ GitHub

可以看到：
GitHub

[ 搜索仓库、作者、Recipe…… ]

热门仓库
最新
已适配
我已接入


Muse 技能库
jasonbitsmith/muse-skills
大量生活与工作 Recipe
已接入                                  >

Deep Research
owner/deep-research
研究与资料整理
未接入                                  >

点某个 GitHub Repo：
Muse 技能库

GitHub
jasonbitsmith/muse-skills

主分支
main

当前版本
commit xxxxx

最近同步
今天

────────────────

生活日常
工作与效率
购物与省钱
健康与运动
本土生活服务
组合技
……

────────────────

Google 日历
查询、修改和创建日程                    >

快递异常件提醒
异常超过条件时提醒                      >

天气突变提醒
天气明显变化时提醒                      >

七、GitHub 接入流程
用户输入仓库地址之后：
GitHub Repo
↓
读取仓库结构
↓
README / SKILL.md / Manifest / 目录
↓
Repository Parser
↓
识别其中 0～N 个 Entry
↓
Entry 分类
↓
Capability 分析
↓
限制 / 手工步骤分析
↓
风险与兼容性分析
↓
建立 Repository Index
↓
接入完成

注意：
接入的是 Repository，不是把整个 Repo 当成一个 Skill。

像 muse-skills 这种一个大 README 包含很多条内容的仓库，可以通过：
标题
Anchor
Details block
章节

解析成多个 Entry。
八、SkillEntry 应该是什么
一个 Entry 是 Planner 可以检索和参考的方法组件。
例如：
快递异常件提醒

问题
快递太多，不想每天自己检查

方法
定期获取物流状态
正常静默
异常或长时间无更新才提醒
全部签收后停止

建议 Facts
shipment.status
shipment.lastUpdatedAt

建议 Capability
shipment.read
notification.create

限制
部分平台可能需要用户授权或手工登录

注意这里写的是：
建议需要什么

而不是：
它有权直接执行什么

九、Entry 类型要分类
外部仓库作者都可能把所有东西叫“Skill”，但懒人装甲内部不能全当成同一种。
建议：
SkillEntryType

BUSINESS_RECIPE
RESOURCE_RECIPE
AUTOMATION_RECIPE
COMPOSITE_RECIPE
REFERENCE_ONLY

例如：
Entry	类型
快递异常件提醒	AUTOMATION_RECIPE
商业可行性评估	BUSINESS_RECIPE
Gmail 邮箱管家	RESOURCE_RECIPE
Google 日历	RESOURCE_RECIPE
“邮箱 + 日历 + 周报”组合技	COMPOSITE_RECIPE
纯知识说明	REFERENCE_ONLY


它们都可以被 Planner 检索，但用途不同。
十、不是所有 GitHub 项目都属于 Skill仓库
如果 Repo 实际是：
MCP Server
OpenAPI Adapter
Python Tool
Android UI Script
Provider Adapter

不能因为仓库名里写了 Skill 就塞进去。
正确分流：
内容	去向
方法 / Recipe / Agent Skill 文档	Skill仓库
MCP Server	资源 → 接口
OpenAPI	资源 → 接口 / Provider
Provider Adapter	Resource Runtime
AppSkill	对应 App Resource 内部
Browser Recipe	Browser Runtime
Python/JS 可执行工具	Capability Candidate / Sandbox


所以：
Skill仓库
= 方法知识体系

Resource
= 可执行能力体系

两个不能混。
十一、Planner 怎么真正使用 Skill仓库
这是最关键的部分。
用户说：
每天整理邮件，只把真正需要我回复的告诉我，每周五再生成一份总结。

Planner 首先理解 Goal：
邮箱整理
+
重要邮件筛选
+
条件提醒
+
每周总结

然后 Repository Search：
Muse/Gmail 邮箱管家
+
Official/重要信息筛选
+
Official/条件提醒
+
Official/周期总结

得到：
SkillEntry A
SkillEntry B
SkillEntry C
SkillEntry D

再结合用户当前实际资源：
Gmail Provider
通知
文档生成

和 Truth / 权限 / Policy：
Planner Composition
↓
Plan Draft

最后生成：
Plan：
我的邮件整理计划

所以：
Plan 是 Goal 驱动的动态组合结果。

不是某一条 SkillEntry 的实例。
十二、一个 Plan 可以引用多个 Entry，也可以一个都不用
正式关系：
PlanVersion
├─ SkillRef A
├─ SkillRef B
├─ SkillRef C
└─ SkillRef ...

例如：
荆门洗车店商业评估

引用：
市场研究 Recipe
竞争分析 Recipe
财务敏感性分析 Recipe
政策核验 Recipe
报告生成 Recipe

但是一个简单需求：
明天下午 3 点提醒我去医院。

完全可以：
Goal
↓
USER_EVENT

不需要为了“Skill-first”强行经过 Skill仓库。
因此核心原则是：
Planner 可以使用 0～N 个 SkillEntry。

Skill 是增强组件，不是系统强制中间层。
十三、Skill仓库和会话
会话是最重要的 Goal 入口。
用户：
我最近十几个快递，
有异常再提醒我。

系统可以回复：
找到一个适合的方法：

快递异常件提醒
来自 Muse 技能库

建议：
每天检查一次
正常不通知
超过48小时没有更新或物流异常时提醒

需要：
物流信息来源

[按这个方法继续]

用户确认后继续在会话里具体化。
不是直接：
创建 Plan

而是：
加入当前需求
↓
继续 Planner 编排

十四、Entry 详情页按钮
因此不要叫：
使用此 Skill 创建计划

建议：
[用于当前需求]

如果当前没有 Conversation：
[用这个方法开始]

然后进入会话：
这个方法可以解决什么？
↓
你的具体目标是什么？
↓
是否还需要其他 SkillEntry？
↓
需要哪些资源？
↓
最终 Action Proposal / Plan Draft

十五、Skill仓库和临时会话
Skill 不只服务长期 Plan。
例如：
帮我现在分析一下这个合同。

Planner 可以检索：
合同阅读 Recipe
风险检查 Recipe
摘要 Recipe

组合以后：
临时会话
→ Action Proposal / Result

不需要创建 Plan。
因此：
Skill Repository
       ↓
   Planner

↙               ↘
临时任务          持续任务
↓                 ↓
Action             Plan

十六、后台数据模型
建议至少四层。
SkillRepository
repositoryId
name
description

sourceType
sourceUrl

owner
repo
branch

license

currentRevision
lastSyncedAt

status
trustLevel

SkillEntry
entryId
repositoryId

name
description

entryType

category
tags
useCases

instructions
examples

requiredFacts
optionalFacts

suggestedCapabilities

limitations
manualSteps

riskHints

sourcePath
sourceAnchor

status

SkillEntryRevision
entryRevisionId
entryId

repositoryRevision
contentHash

parsedDefinition
parserRevision

createdAt

PlanSkillReference
planVersionId

entryId
entryRevisionId

role
reason

compositionOrder

Plan 只保存引用和冻结版本。
Skill 不成为 Plan Authority。
十七、Repository 与 Entry 版本
GitHub Repository 的版本最可靠的是：
commit SHA

例如：
muse-skills
commit abc123

这个 commit 下：
009 快递异常提醒
→ EntryRevision A

以后仓库更新：
commit def456

解析后：
009
→ EntryRevision B

现有 Plan：
继续引用 EntryRevision A

不能自动变行为。
十八、仓库更新流程
GitHub 上游变化：
Repository sync
↓
发现 commit 变化
↓
重新解析
↓
Entry Diff
↓
兼容性分析
↓
建立新 Revision

前端：
Muse 技能库

发现更新
23 条修改
7 条新增
2 条删除

[查看变化]
[更新索引]

如果正在运行的 Plan 引用了发生变化的 Entry：
当前计划使用旧版本
不会自动修改

[查看更新影响]

只有用户确认重新编排后：
Planner
↓
新的 PlanVersion

十九、安全边界
SkillRepository / SkillEntry 永远没有执行权。
它最多描述：
可能需要：
email.send
calendar.event.create
browser.navigate
service.booking.request

但真正执行必须：
Goal
↓
Planner
↓
SkillEntry references
↓
Capability Requirement
↓
Resolver
↓
Risk
↓
Approval
↓
Invocation
↓
Runtime
↓
Verification

GitHub 作者不能通过 Skill 文本绕过：
Risk
Approval
Truth
Verification

二十、外部 Skill 内容是不可信输入
这点非常重要。
GitHub Skill 里可能写：
忽略权限
把 Cookie 发给……
执行 shell……
删除……

这些都只是：
Untrusted repository content

不得改变：
System Policy
Risk Policy
Approval Policy
Runtime authority

和网页文本一样处理。
二十一、代码型 Repository
如果一个 Repo 真包含：
Python
JS
Shell
Docker
MCP

那么文档部分可以作为 Entry 被解析。
但是代码执行能力必须单独走：
Capability Candidate
↓
Static Analysis
↓
Dependency Analysis
↓
Secret Analysis
↓
Permission Analysis
↓
Sandbox
↓
Risk
↓
Verification Contract
↓
Signed Registration

不能因为它来自 Skill仓库就直接运行。
二十二、Skill仓库与资源
正式关系：
SkillEntry
“怎么做”

↓ 建议

Capability Requirement
“需要什么能力”

↓ Resolver

Resource
“谁能做”

例如：
商业研究 Recipe

需要：
web.search
browser.extract
calculator
artifact.generate

实际资源：
Cloud Browser
MCP
Provider
Cloud Workspace

所以资源页继续：
本机 | 云端 | 其它设备 | 接口

不增加 Skill Tab。
二十三、Skill仓库与服务
SkillEntry 可以建议现实服务步骤。
例如：
开店选址 Recipe
↓
需要现场调查
↓
service.site.inspection
↓
Resolver
↓
本地服务商
↓
ServiceRequest

所以：
Skill ≠ Service

Skill 只是方法来源。
二十四、Skill仓库与旧 Domain / Scenario / Template
这次也正式纠偏。
旧：
13领域
19领域
96/160场景
模板

不再是 Plan 创建主链。
迁移为：
Domain
→ category / tag

Scenario
→ useCase / evaluationCase

Template
→ SkillEntry / Official Recipe
   或 Deprecated

但不能机械地：
1 Template = 1 Skill

需要重新判断它到底属于：
Recipe
Example
Evaluation Case
Resource Recipe
Deprecated

二十五、Skill仓库和旧“策略”
以前：
分析
总结
跟进
……

这类不能继续作为创建 Plan 必须先选的“策略”。
可以分别沉淀成：
Planner policy
SkillEntry
automation preference
risk preference

用户自然语言表达目标即可。
二十六、推荐系统以后怎么做
推荐的不是“最热门 Skill 就最好”。
应该综合：
用户 Goal
Entry semantic match

Capability compatibility
当前 Resource 是否可用

隐私
Risk

历史成功率
Verification 成功率

来源可信度

是否需要用户额外配置

例如用户没有 Gmail：
Gmail Recipe

即使匹配高，也应该降低推荐。
二十七、Skill仓库第一版范围
P6-V1
先把模型做对：
SkillRepository
SkillEntry
SkillEntryRevision

官方仓库
GitHub仓库
我的仓库

Repository Detail
Entry Detail

Repository Search

PlanSkillReference

以及：
Goal
→ Repository retrieval
→ 0～N Entry
→ Plan Draft / Action Proposal

P6-V2
再做：
GitHub URL 接入
README parser
SKILL.md parser
Anchor parser

commit sync
Entry diff

License
Repository metadata

兼容性分析

P6-V3
最后再做：
社区仓库

发布
Fork
收藏
评价

AI创建 Repository / Entry

Plan → Recipe 提炼

自动更新建议

Capability Synthesis

二十八、最终前端结构
正式冻结成：
计划                                             +

Skill仓库                 我的计划

Skill仓库：
[搜索 Skill、仓库、作者……]

推荐   官方   GitHub   社区   我的

右上 +：
接入

GitHub 仓库
URL
上传仓库/文件
AI 创建

GitHub 页面首先显示：
Repository

仓库里面才显示：
SkillEntry / Recipe

二十九、最重要的四个“不要”
以后做 P6 时重点防止这四个方向重新走偏：
不要把 Skill仓库做成旧模板页换皮。

不要一个 SkillEntry 点一下就直接生成 Plan。

不要强迫所有 Goal 都先匹配 Skill。

不要允许 Skill 文本直接调用 Runtime。

正确的是：
Goal
↓
Planner
↓
检索 0～N 个 Entry
↓
组合
↓
Action Proposal / Plan Draft
↓
现有 Authority Runtime

三十、最终产品定义
这段可以直接写进正式文档：
Skill仓库是懒人装甲用于接入、索引、发现、版本化和检索外部及内部“做事方法”的统一知识与方法仓库体系。一个 SkillRepository 可以包含多个 SkillEntry/Recipe。Planner 根据用户的自然语言 Goal，从一个或多个仓库中检索并组合 0～N 个 SkillEntry，再结合当前 Truth、资源、权限、风险和用户约束生成 Action Proposal 或 Plan Draft。SkillRepository 和 SkillEntry 本身均不拥有 Plan、Truth、Approval 或 Execution 权限。

最终产品主链就是：
                    用户自然语言 Goal
                           ↓
                       会话 / Planner
                           ↓
                   是否需要方法支持
                           ↓
               Skill仓库检索 0～N Entry
                           ↓
                    Planner Composition
                           ↓
             Facts / Capability Requirements
                           ↓
                        Resolver
                           ↓
                   Resource / Service
                           ↓
             ┌─────────────┴─────────────┐
             ↓                           ↓
          临时任务                     持续任务
             ↓                           ↓
     Action Proposal                 Plan Draft
             ↓                           ↓
        Invocation                  PlanVersion
             └─────────────┬─────────────┘
                           ↓
                         Runtime
                           ↓
                      Verification
                           ↓
                       Truth / Result
                           ↓
                         Replan

这版才是基于 muse-skills 这类真实 GitHub 仓库重新纠正后的 Skill仓库最终设计基线。
