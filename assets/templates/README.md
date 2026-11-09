# 内置开屏模板（vendored）

这些模板随插件发布，全部是**纯数据**（template.json + 素材），由
assets/splash/splash.js 运行时解释执行。来源与授权见各模板 template.json
内的 author / license 字段，以及包根的 CREDITS.md。

| 模板 | 引擎 | 说明 |
|---|---|---|
| archive-warm | steps | the classic authorisation sequence (沈宏宏) |
| deep-sonar | steps | dark five-scene descent with voice lines |
| terminal-phosphor | steps | terminal phosphor, six scenes |
| whale-girl-scan | timeline | full-screen video act (BSD-3-Clause) |
| 550c-homage | timeline | character-particle globe, six segments |
| chars-globe | timeline | minimal character globe |
| earth-globe | timeline | rotating earth |
| world-line | timeline | world line |
| timeline-demo | timeline | keyframe primer |
| wipe-demo | timeline | wipe transition primer |
| effects-gallery | timeline | overlay effects gallery |
| division-bigfish-codex | iframe | a whole document with an easter egg |

由 tools/pack-templates.mjs 从 dsh-boot-suite 打包；改动请回源仓库后重跑。
