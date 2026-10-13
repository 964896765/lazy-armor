# S0 第三批整改：生产依赖处置 · 2026-10-13

关联[方案 V1.1](PROJECT_OPTIMIZATION_PLAN_V1_1.md)的 FIX-04。基线 `25e2d82`，源码提交 `92a4429e5ff1292630e188442b953dc4202fd9c9`。可用补丁的5项告警已清除；**FIX-04整体 IN_PROGRESS，S0-A 与正式发布仍未关闭**。

**本轮结果**

重新联网审计确认基线为2 critical / 5 high / 1 moderate。升级及锁文件收口后为 **0 critical / 2 high / 1 moderate**。原 `pnpm audit:dependencies` 最终仍以exit1拒绝发布，原因是node-forge与braces的两项high；没有更改等级阈值或增加忽略名单。

| 依赖 | 升级 | 实际范围与验证 |
| --- | --- | --- |
| proxy-addr | 2.0.7→2.0.8 | Express/Nest实际依赖；正确IPv4/映射IPv6网段保持，错误短前缀不相信伪造X-Forwarded-For，可信/非可信代理HTTP行为通过 |
| sharp | 0.35.4→0.35.5 | API直接依赖及Next传递依赖；同步原生平台包与libvips。实际Windows模块0.35.5、libvips8.18.7、librsvg2.63.2；缩放、JPEG输出、真实API图片元数据清理及文档/附件处理通过 |
| shell-quote | 1.10.0→1.12.0 | RN DevTools依赖包；comment之后4种行终止符拒绝，正常编辑器参数解析/引用通过；测试不执行shell命令 |
| compression | 1.8.1→1.8.2 | Expo CLI的Metro bundle/map压缩；gzip往返通过，真实客户端断开后原生gzip流close已确认 |
| source-map-js | 1.2.1→1.2.2 | Next/PostCSS、Expo工具链；正常indexed映射保持，Infinity/负值/超大offset在展开前拒绝，Next及Expo实际构建通过 |

API直接固定sharp版本，根overrides固定上述5项并覆盖传递路径；锁文件内旧受影响版本已移除。只改变这5个包族及sharp平台包，其他包版本/完整性不变。pnpm9重算时遗漏的既有Linux glibc/musl条件已保留，Sharp新平台包沿用相同目标条件；注册表核对linux-x64仍为glibc。冻结安装不会改写最终锁文件。

**无已发布补丁的剩余项**

| 依赖与advisory | 当前状态与可达性证据 | 后续与发布状态 |
| --- | --- | --- |
| node-forge1.4.0，[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)，high | npm最新仍1.4.0，advisory没有patched version。Expo CLI开发证书/签名库及iOS签名工具路径存在verify；当前app.json没有EAS项目/updates签名配置，Android导出JS图未包含该包 | 安全发行版或兼容替换/可审查补丁仍待实施；本批没有关闭证书验证漏洞，原high门继续阻断 |
| braces3.0.3，[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，high | npm最新仍3.0.3。Metro文件watcher经micromatch使用，当前glob由项目配置/扩展名生成；未发现个人上传文件成为该glob输入，Android导出JS图未包含该包 | 工具链深递归缺陷仍存在；输入范围检查不是漏洞修复，原high门继续阻断 |
| sprintf-js1.0.3，[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)，moderate | npm最新1.1.3也在受影响范围。Mammoth的CLI→argparse引入；API的extractRawText实际提取fixture后require缓存没有argparse/sprintf-js，AndroidJS图也未包含 | CLI依赖告警保留，等待安全版本/兼容处置；没有宣称所有格式字符串输入安全 |

上述是当前项目路径核对，不是其他Expo/RN项目、所有DevTools分发内嵌代码或生产环境的安全保证。Android代码图排除不能消除开发机/CI工具链告警；原完整生产依赖门仍执行。FIX-04整体及S0-A不能因critical降至0就标CLOSED。

**最终验证与证据**

| 检查 | 结果与私有本地证据 |
| --- | --- |
| 依赖安装 | 在线拉取成功；最终 `pnpm install --frozen-lockfile --offline` exit0，锁SHA256保持 `7f54f79d0ab00a2971f145c2d1b7470489098aabec3da059377259efdc012da8`；artifacts/optimization-s0-dependency-install-r3.log |
| 全仓typecheck | 强制执行8/8、0缓存，artifacts/optimization-s0-dependency-typecheck-r1.log |
| 全仓build | 强制实际构建8/8、0缓存，含API、Next与Expo Web；artifacts/optimization-s0-dependency-build-r1.log |
| 依赖行为 | 16/16，artifacts/optimization-s0-dependency-runtime-r1.log |
| Mobile | 72文件434/434，artifacts/optimization-s0-dependency-mobile-tests-r1.log |
| Admin | 2文件50/50，artifacts/optimization-s0-dependency-admin-tests-r1.log |
| 隔离API | 3文件21/21，artifacts/optimization-s0-dependency-api-integration-r1.log；真实Nest/MySQL/Redis，服务图片、owner/重放边界、PDF/DOCX worker与附件路径 |
| Android实际JS导出 | 成功，artifacts/optimization-s0-dependency-android-export-r1.log；1829个source-map来源中node-forge/braces/sprintf-js及其他本批告警包计数均0，artifacts/optimization-s0-dependency-android-graph-r1.json |
| DOCX依赖可达性 | 实际extractRawText成功，CLI模块加载数0，artifacts/optimization-s0-dependency-docx-reachability-r1.json |
| 最终依赖门 | JSON审计0 critical/2 high/1 moderate；原命令exit1，artifacts/optimization-s0-dependency-audit-r2.json、optimization-s0-dependency-high-gate-r3.log |
| 其他检查 | 新文件纳入hygiene后通过；术语/data-truth/diff及CI YAML解析通过；CI增加前置依赖行为回归及图片/文档API集成 |

本批相关测试 **521项（16+434+50+21）**，不与前批或重复执行累计。Android导出是生产JS及source map，未新建/安装APK或作真机验收；Windows原生模块通过不替代Linux实际部署。上批Admin浏览器证据是其时点，本批验证Admin单测/类型/构建。远端CI没有声明Green，保留原审核与正式迁移门。

SQL验收只使用新库lazy_armor_dependency_6ed50026de23445d_test（MySQL3311，93条既有迁移）和Redis6391/15的独立随机前缀，模型调用关闭。没有访问个人3307数据库、变更真实用户角色或运行生产迁移。日志、导出、source map、fixture凭据和测试库是私有证据，不上传GitHub。

可复验命令：`pnpm --filter @lazy-armor/api test -- test/dependency-runtime.spec.ts`；构建API后 `node scripts/verify-dependency-isolated.mjs --log artifacts/dependency-fresh.log`。后者只使用确切测试MySQL3311，新库/独立Redis前缀，日志须全新。

**当前分析与下一切片**

类型、Connector合同、备份目标、Admin访客鉴权已按原冻结范围收口；本轮移除了2项critical及3项high。依赖剩余2 high/1 moderate、0083正式证据、非空恢复、其他身份/队列/交互问题继续开放，当前不具备正式发布条件。

下一独立安全切片：**FIX-06密码重置令牌原子领取及会话撤销**，先用隔离SQL复现并发，再修复/回归；FIX-07邮箱身份一致性随后处理。FIX-04剩余项继续跟踪安全发行版或专项处置，阶段发布门不提前关闭。

回滚应配套撤回manifest与锁文件的源码提交，再冻结安装及重建；原受影响依赖会恢复。零新SQL迁移、执行/授权入口和生产部署。
