# Auth V2 · M2-01 用户级密码凭据兼容迁移

日期：2026-10-13。基线 c9829ad，codex/v83-persistent-runtime。范围：M2 的密码凭据 Expand/兼容双写/回填/受控读取切片，保留原 User ID、原 Session 和所有业务数据。任意新邮箱绑定、停止旧表写入、Argon2id 和完整 M2 不在本批关闭。

## 行为与数据

新增前向迁移 0093_user_password_credentials.sql，仅创建 password_credentials；原93条SQL不修改，不自动回填。新表以 user_id 唯一保存 bcrypt hash、参数、version、来源旧身份ID、记录时间；source FK 保留旧记录，用户及邮箱/手机号归属不迁移。回填原 hash 不重新散列、不伪造邮箱验证，也不把迁移时刻标为历史密码设置时刻。

| 模式 | 读取和写入 | 登录标识 |
| --- | --- | --- |
| LEGACY（默认） | 原表读写；无需新表，便于先部署兼容代码 | 保持原邮箱密码接口 |
| SHADOW | 核对新旧 hash、源ID、算法与参数；存在差异拒绝密码签发；注册/设置/修改/重置同事务双写 | 仍保持原邮箱入口 |
| UNIFIED | 已验证标识解析 User ID，再读取用户级密码；旧 hash 缺失镜像时仅在合法证明下复制 | 已验证邮箱/手机号共用同一密码；旧未验证邮箱密码兼容保留 |

SHADOW/UNIFIED 在启动时要求0093表可读，缺表拒绝启动；模式由部署配置校验，不能用客户端参数开启。默认LEGACY没有在本人库中创建/读写新凭据表。密码镜像缺失时复制版本1；改密/重置递增version并保留来源。版本/归属/原hash均在签发会话事务内重查；不凭相同邮箱自动合并历史账号。

成功密码登录审计与Session创建同事务，过期证明、其他用户的证明及回滚不能留下成功会话/成功审计。修改、重置的两表更新、版本、恢复token、原全会话撤销和审计同事务；原身份角色与Runtime高风险审批权威保持。

兼容窗口继续使用bcrypt。仅支持经核对的bcrypt参数，未知算法、多个旧密码、source/hash/参数差异需要核对，不挑一条覆盖。Argon2id及旧凭据停写/收缩需要后续独立迁移与回滚设计，当前不承诺支持。

## 产品入口

密码页面读取服务端passwordIdentifiers能力；仅UNIFIED显示手机号选项。已绑定且验证的号码输入原密码进入同一User ID，不发送短信、不创建新用户。安全中心按本账号实际验证标识显示共用密码。默认Beta仍邮箱验证码优先，手机号正式OTP、绑定/换号与真实供应商验收不因本切片完成。

任意新邮箱绑定尚未实现；M1“验证已有旧邮箱”和“可选首个密码”入口继续沿本人证明工作。后续M2-02必须验证当前账号（原密码或已验证渠道）与新邮箱，挑战绑定服务端用户/当前会话/用途/目标邮箱/凭据版本，禁止自动合并、跨会话和改密后重用。

## 可审阅的审计与回填

只读审计脚本仅返回聚合：旧密码用户数、多凭据、算法/参数、非规范邮箱、owner冲突、缺失镜像、差异及兼容状态。SQL可在内部比较hash，但回包/报告不包含hash、邮箱、User ID或Session凭据。

本地根.env指向的lazy_armor只读结果：11个旧密码用户，0093未执行，缺失镜像11，数据冲突/格式阻断0；readyForUnified=false。没有执行个人库回填，没有改写旧凭据或会话。私有报告auth-password-migration-audit-20261013-01.json保存在忽略的artifacts中；它不是生产审计证据。

~~~powershell
node scripts/migrate-auth-password-credentials.mjs --env .env --expected-database lazy_armor --mode audit --out artifacts/auth-password-audit-FRESH.json
~~~

apply明确限制为127.0.0.1:3311、完整匹配的lazy_armor_*_test库与预期库名；原库及错误目标在连接前拒绝。该脚本不是生产回填入口，不运行全App/Worker。隔离apply按用户锁回填并事务审计，重跑只核对，不覆盖差异；一个用户回填失败全部回滚，批处理中断可重跑已完成前缀。

~~~powershell
node scripts/verify-password-credentials-isolated.mjs --log artifacts/auth-m2-FRESH.log --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --screenshots artifacts/auth-m2-FRESH
node --test scripts/migrate-auth-password-credentials.test.mjs
~~~

该验收脚本先核对独立MySQL3311容器，再创建唯一空test库/Redis6391前缀；迁移94条、准备普通账号、运行真实CLI首次/重跑、实际Nest回归和Chrome，然后dump/restore到另外的新test库。原身份/会话/会员资料的回填前后摘要保持；非空恢复核对9张认证与账号表，包括hash、源ID、版本、token状态和Session，并且不输出这些数据。备份、env、模型虚拟凭据、日志、截图仅留私有artifacts。

## 部署与回滚边界

1. 保持LEGACY，先取得本环境备份/恢复与正式迁移证据，再部署0093（本批只有隔离库执行证据）。
2. 全部密码写入实例升级后进入SHADOW，受控回填、持续核对新旧归属/hash/参数；旧版本单写会造成差异，不能自动覆盖镜像。
3. 本环境缺失与冲突/差异清零、旧接口/恢复/角色/本人旅程通过后才灰度UNIFIED。代码保留合法证明下的惰性复制，以处理兼容窗口新增旧账号；不取代生产全量核对门。
4. 出错先停止新模式/新入口。回到LEGACY前核对旧表确为当前密码；不删除新表、改User ID或恢复旧密码。LEGACY期间发生单写后，重新进入SHADOW/UNIFIED需重新审计；本工具不会覆盖差异实现无证据切回。

正式生产回填工具、停写/收缩、受控算法升级、任意新邮箱绑定及手机号绑定/换号仍需独立实施。原2 high/1 moderate依赖、0083正式发布证据、真实短信/邮件、本人真机和消费者Web长期会话等门仍开放。

## 验收与失败记录

最终r6：6文件、73项API/SQL/Redis/Chrome联合回归全部通过，CLI首次回填2、重跑新增0、原账号资料/旧密码/会话摘要不变。完整dump/restore后20个用户密码凭据与9张认证/账号表摘要一致，版本与source保持；脚本退出0。浏览器实际验证手机号密码进入原User ID、真实安全状态，以及原邮箱验证、定时刷新保留草稿和恢复深链旅程。安全中心的“共用密码”文案不将未验证旧邮箱说成已验证。没有把fixture手机号映射当作真实短信/换号证明。

另有Mobile441、Config64、Database31和回填CLI连接前目标守卫2项通过，总计611项，不含未运行的其他套件。八包typecheck/build各8/8无缓存；末次核心改动后API类型/构建重验，Android/Hermes JS导出通过。未构建/安装新APK、未做本人真机或生产部署。CI YAML解析及接入新回归完成，不声明远端CI Green。94条迁移分段通过，migration:safety因原0083正式证据缺失仍exit1。

保留失败：只读审计的REGEXP匹配参数在MySQL准备语句下受限，改用静态SQL字面量（没有插入用户文本）；CLI的DISTINCT排序未选列被拒绝，改为选中别名；新配置被Nest在启动时固定，原夹具运行中改env没有切换模式，改为受控fixture provider并保留真实启动校验；首次非空restore中binary UUID被UTF-8替代而发生键冲突，新增--hex-blob后重验。失败均只涉及新test库，不涉及个人/生产库。

完整Auth V2路线见[统一认证方案](AUTH_V2_IMPLEMENTATION_PLAN.md)。
