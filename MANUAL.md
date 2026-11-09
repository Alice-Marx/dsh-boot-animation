# 使用手册

`dsh-boot-animation` —— 给 DSH 换一段开机动画：每次打开页面，先铺满窗口放一段短片，然后淡入进界面。

> 这份是给人看的。给人写的维护/排查细节在 [README.md](README.md)，给下一个 AI 接手看的在 [AGENTS.md](AGENTS.md)。

## 安装

**设置 → 插件 → 添加插件**，贴 npm 包名 `@ljwei-stak/dsh-boot-animation`、GitHub 仓库地址
`https://github.com/Alice-Marx/dsh-boot-animation`、或解压后目录的绝对路径，装完按提示重启。
更多安装方式与卸载见 [INSTALL.md](INSTALL.md)。

### Upgrade from 0.3.0

Update `@ljwei-stak/dsh-boot-animation` to **0.3.2 or later** through DSH's plugin
manager. Version 0.3.0 used the old, unscoped Host module name in its bundle patch,
so installation could succeed while the video routes and boot scripts never
loaded. The current patch resolves the full scoped package name and keeps the
settings namespace `boot-animation` unchanged.

After updating, **quit DeepSeek Harness from the system tray, then launch it
again**. Closing only the window can leave the old Host running; refreshing the
page does not replace the Desktop process's cached startup injections.

## 它长什么样

开屏有两种**形式**，在设置里切换（见下面的「开屏形式」）：

1. **影片**——深海底背景 + 一条短片铺满窗口（从素材池里随机取）
2. **模板动画**——按模板数据演出：分幕（中文主字 + 英文等宽副标题 + 配音）、
   时间线（图层关键帧）、或整页 iframe（模板自己是一个网页）

### 影片形式

1. 深海底背景 + 一条短片铺满窗口（从素材池里随机取一条）
2. 底部一条细进度条，跟真实启动进度走
3. **片尾开始溶解进界面**——淡入正好在片子放完那一刻结束
4. 想早点进：点一下画面，或者按 Esc / 空格 / 回车

短片以**静音**开始。**点一下**画面才开声音（浏览器的硬规矩：没有你的点击，任何网页都不许自动放声音）。点完继续演，放完自动进。

退场时**片子的声音会和画面一起淡出**，淡出时长就是设置里那个「淡入时长」——画面收干净的那一刻，声音也正好到 0。**提前点一下跳过**时，声音会比画面多留 1.3 秒淡完（这 1.3 秒过去是满音量留着、到点一刀切，现在用来淡出）。两种情况都不会出现"画面没了声音还在响"或"声音被硬切掉"。

不想让它出声、不想看文字、想一下点进去，都在设置里（见下面的三个开关）。

### 模板动画形式

模板是**纯数据**（一个 `template.json` 加若干素材文件），不是代码——插件自带一个
运行时来解释它，所以别处做的开屏动画可以整套搬过来跑。三种引擎：

| 引擎 | 长什么样 | 内置样例 |
|---|---|---|
| **分幕 steps** | 一幕一幕往下走：中文大字 + 英文副标题 + 底部日志，可以等你按按钮 | 档案暖白、深海声呐、终端荧光 |
| **时间线 layers** | 每个图层按关键帧时间线动：文字/线条/面板/图片/视频/字符球/地球/身份卡 | 鲸鱼娘扫描睁眼、550C 复刻、时间线演示 |
| **整页 iframe** | 模板自己就是一个网页，自己演自己；插件只负责挂载和收尾 | 全景大肥鱼（含彩蛋） |

两种形式都遵循同一条底线：**这一页绝不会黑屏**。模板读不出来、素材缺失、字段坏了，
一律回落到影片形式（并在日志里说明原因），不会把界面锁死。

## 设置在哪

**设置 → 插件 →「插件配置」**，找到「启动动画」这一行，**点一下展开**：

| 控件 | 作用 |
|---|---|
| **开启启动动画** | 总开关。关掉＝完全不出现动画，回到 DSH 原来的启动页 |
| **开屏形式** | **影片**（默认，上面的短片）／**模板动画**（下面的模板引擎） |
| **播放影片声音** | 默认开。关掉＝**彻底静音**：不再尝试开声音，右下角那个声音按钮也不出现 |
| **点鼠标直接进入** | 默认关。打开后**按一下画面就直接进界面**，不再用第一下开声音 |
| **显示底部提示文字** | 默认开。关掉只隐藏画面底部那行「点击进入」之类的提示，标题和进度条保留 |
| **淡入时长** | 1 / 1.5 / 2 / 3 / 4 秒，默认 2 秒 |
| **进入方式** | **片尾交叉溶解**（默认）／放完再淡／点击才进 |
| **素材池** | 勾选哪些片子参与随机轮播。取消勾选的会留在文件夹里，只是不再被抽中 |

**改完刷新页面生效**，不用重启 DSH。

选**模板动画**后，同一张卡片下半部分换成模板的控件：

| 控件 | 作用 |
|---|---|
| **第一幕模板** | 下拉选一个模板；下面是所有可用模板（内置 + 你自己的） |
| **第二幕模板（可选）** | 第一幕演完接着演第二幕；选「不播第二幕」就是单幕 |
| **预览这一模板** | 立刻满屏跑一遍选中的模板——用的是**当前设置**，不等保存 |
| **播放速度** | 0.5× ~ 2×，默认 1× |
| **版式** | 亮色／暗色；模板自带深色底时会自动切暗色，除非你指定过 |
| **播放时机** | 每次打开／每个浏览器会话一次／每天一次 |
| **等待用户确认** | 序列里标了需要确认的步骤等你按按钮；关掉则自动往下走 |
| **允许跳过** | 播放期间可以按 Esc 或点跳过按钮提前进入 |
| **界面音效** | 选项音、确认音等界面音效 |
| **女声播报** | 序列每一步念出台词：有配音素材用素材，没有就用系统语音 |
| **播报语言** | 英语／中文／中英 |
| **声音效果** | 给配音加一层：原声／AI 机械／机器人／无线电／老电视／低沉 |
| **身份名称 / 代号** | 序列结尾念出的名字和编号 |
| **强调色** | 主色 + 两个故障色；模板自己指定过的颜色以模板为准 |
| **入场 / 两幕之间 / 退场 转场** | 每段的过场怎么走：叠化／闪白／故障／扫描线／滑移／圆形拉开／黑场／硬切 |
| **转场时长** | 0.2 ~ 2 秒 |
| **液态玻璃** | 底板和黑幕变半透明磨砂，能透出背后的界面（经典档案版的默认观感） |
| **玻璃参数** | 不透明度、磨砂半径、背景模糊（背景模糊直接糊在应用本体上） |
| **背景音乐** | 用你自己的音乐给模板伴奏。文件只存在本机 profile 里，不上传任何服务器 |
| **主音乐 / 第二段** | 导入的音频里选哪首播哪段；第二段可选，选了两段之间交叉淡入 |
| **音量与节奏** | 音量、拍速、两段的拍数与起点、交叉时长 |
| **整体循环 / 第二段也循环 / 配音时压低音乐** | 循环怎么算；配音时自动把音乐压低（闪避） |

> **适配 DSH 0.2.0-rc.2。** DSH 换了「插件怎么提供设置」的接法：以前是插件向 Host
> **注册**一个设置命名空间，现在是插件自己**声明**一份 `Config` 描述，命名空间就是它在
> profile 补丁里的条目 id（`boot-animation`），设置页照这份描述渲染卡片。
> 对你的影响：**用法一模一样**，只有两点要知道——设置值现在存在 profile 的
> `cordis.patch.yml` 里（老版本存在 `settings.yaml`）；另外插件旁边链接的
> `@deepseek-ai/schemastery` 必须是 DSH 内核用的那份（3.18.4 或更新），旧副本没有
> `.volatile()`，卡片会整张不出现，并在控制台留一条 `boot-animation:` 开头的黄色告警。

三种进入方式的区别：

| 方式 | 什么时候进 |
|---|---|
| 片尾交叉溶解（默认） | 片子放到最后 N 秒开始溶解，放完正好进 |
| 放完再淡 | 片子完整放完、停住，再淡出 |
| 点击才进 | 短片循环播放，直到你点一下 |

三个开关各自管什么：

| 开关 | 打开 | 关上 |
|---|---|---|
| 播放影片声音 | 照常尝试带声播放，右下角有声音按钮 | 彻底静音，连声音按钮都不生成 |
| 点鼠标直接进入 | 按一下画面＝进入（跳过开声音那一步） | 按一下先开声音，再按一下才进 |
| 显示底部提示文字 | 显示「点击进入」这类操作提示 | 只保留标题和进度条，提示文字不显示 |

> 声音这一项**不改浏览器本身的规矩**：如果这个站点还没被 Chrome 记住，片子照样以静音开始，还是要你点一下才出声。「播放影片声音」关掉是**更彻底**的方向——不是「先静音播放」，而是整条音频路径都不走：不尝试开声音，也不再生出那个按钮。

## Import your own video and set playback effects

Open **设置 → 插件 → 启动动画** and expand the card. Under **素材池**, use
**导入自己的视频** to choose an MP4, WebM, M4V or MOV file, up to 256 MB.
H.264 video with AAC audio in an MP4 container is recommended. The browser still
needs to support the video's codec; an unsupported file is identified in the pool.

A successful import selects that video for the next boot. **设为开屏** selects
one existing clip; selecting several checkboxes creates a random pool. **预览**
plays that clip with the current sound, fade, entry mode, click and hint settings.
An imported clip can be removed with **移除** after confirmation. Removing the
last selected custom clip first selects another available video.

Imported files live in the current DSH profile, outside the installed plugin, so
package upgrades retain them. Profiles have separate pools. No original source
file is moved or overwritten. Preview reflects the current controls immediately;
Desktop's next startup uses them after quitting from the system tray and relaunching.

## Import your own template

Templates are plain data — a directory holding `template.json` plus its assets:

```
<你的模板目录>/
  template.json          # 描述演什么、怎么演（分幕 / 时间线 / iframe）
  assets/                # 模板引用的音频、图片、视频
  index.html             # 仅 iframe 模板需要：模板自己的网页
```

To install one, copy the directory into the profile's data folder:

```
<DSH 配置目录>/data/dsh-boot-animation/templates/<模板 id>/
```

The default DSH config directory is `~/.dsh` (Windows:
`C:\Users\<你>\.dsh`). The template id is the directory name: lower-case letters,
digits and hyphens, up to 40 characters. A user template with the same id as a
built-in one **overrides** it — that is how a built-in template is customised
without touching the installed package.

The dropdown in the card lists both the built-in templates and yours, and the
card shows which is which. A template that fails validation is skipped rather
than served: the boot then falls back to the clip screen and says so in the log.

Templates written for **dsh-boot-suite** run here unchanged — the format and the
`template.json` schema are that project's, and this package's runtime is an
adapted copy of its engine (see [CREDITS.md](CREDITS.md) for the full
attribution). Anything that project's template store offers can be dropped in.

还有两条不用碰文件夹的路：

- **模板编辑器**：设置卡片里点「打开模板编辑器」，会开一个新页面，可视化地改
  文字、图层、关键帧和配色，改完存进用户模板目录（旧版本自动备份到
  `backups/`，保留最近 30 份）。编辑器里也能直接预览和试听。
- **模板商店**：同一张卡片里的「模板商店」分段，列出公开模板，点「安装」就会
  把模板和它自带的素材写到本机 profile——不上传任何东西，也不经过任何账号。
  装完就出现在上面的第一幕下拉框里。商店连不上时会显示上次读到的列表，并说明
  原因。

## Legacy folder-based media

**第一步：把视频放进素材池**

插件目录下的 **`assets\videos\`**——就是这份文档旁边的那个目录。

支持的格式：`.mp4` `.webm` `.m4v` `.mov`。**推荐 mp4（H.264 + AAC）**，兼容性最好；`.mkv` 会被忽略。

**第二步：跑一次「重排」**

视频文件里有张**索引表**（告诉播放器每一帧在文件哪个位置）。索引表如果被存在**文件末尾**，浏览器就得把整段下完才肯出画面——这段时间屏幕上什么都没有。这一步就是把它挪到文件最前面（**只搬位置，不重编码，画质零损失**）。

**双击插件目录下的 `tools\apply-faststart.bat` 就行。**

它会把需要处理的都处理掉，原片自动备份到 `assets\videos\originals\`（这个子目录不参与轮播）。也可以开终端跑：

```sh
node tools/apply-faststart.mjs          # 只看需不需要处理，不动文件
node tools/apply-faststart.mjs --apply  # 真的处理
```

**第三步：刷新页面。** 新片子会被自动发现（清单是每次请求实时扫描的），不用重启、不用重新构建。

> 怎么知道要不要重排？展开设置卡片看素材池那一行：带**「未优化」**黄徽章的就是需要处理；没有徽章就是已经优化过了。

## 素材池后面的徽章是什么意思

| 徽章 | 意思 | 要做什么 |
|---|---|---|
| `12.42s` 这样的灰色数字 | 这段片子的时长 | 没事 |
| **黄** `未优化` | 索引表在文件末尾，出画面会慢（黑屏更久） | 跑一次上面的重排 |
| **黄** `一直没有画面` | 能开始播，但 8 秒内一帧都没出来——放启动动画只会看到背景色 | 换一段，或重新导出 |
| **红** `浏览器播不了` | 浏览器拒绝解码这一段（编码不支持，或文件不完整） | 用剪映等工具重新导出成 H.264 mp4 |

卡片会**真的把每段播一遍**来给这个结论，不是只看文件信息。展开卡片时会短暂读一下这几段素材，属于正常现象。

## 不想看到它 / 想彻底删掉

| 想要的效果 | 怎么做 |
|---|---|
| **暂时不要动画** | 设置卡片里关掉「开启启动动画」，刷新 |
| **只删某一段片子** | 把它从 `assets\videos\` 移走，刷新 |
| **把插件摘掉（保留文件）** | 跑 `tools\uninstall.ps1`，然后刷新 |
| **彻底拆除** | 跑 `tools\uninstall.ps1`，再把整个插件目录删掉 |

> `uninstall.ps1` 默认摘的是 `web` 这个 profile；桌面版 DSH 用的是 `desktop`，要加一句
> `-ProfileName desktop`（装回去用 `tools\install.ps1`，同样带这个参数）。
>
> profile 是热加载的，摘掉之后**刷新页面**就回到 DSH 原生启动页，不必重启。

摘掉插件就是两件事：删掉 `cordis.patch.yml` 里那个 `- insert:` 块，再删掉 profile 里的
`node_modules\dsh-boot-animation` 链接。手工做也行——**这个块未必在文件末尾**（DSH 自己会重排
这一层），所以按名字找，别按位置找；链接用 `rmdir` 删（它只删链接，不会跟进到插件目录里）：

```powershell
$Profile = "$env:USERPROFILE\.dsh\profiles\desktop"
# 1. 在 cordis.patch.yml 里找到这三行并删掉（位置不定，搜 boot-animation）
#      - insert:
#          - id: boot-animation
#            name: dsh-boot-animation
# 2. 删掉链接（不要用 Remove-Item -Recurse，它会顺着链接删进插件目录）
cmd /c rmdir "$Profile\node_modules\dsh-boot-animation"
```

> **别用旧版 `uninstall.ps1` 手工改这个文件。** 早先的版本用 PowerShell 读回再写出
> `cordis.patch.yml`，而 PS 5.1 会把无 BOM 的 UTF-8 当成 ANSI 解码——你 profile 里的中文
> （比如某个 provider 的 `displayName`）会被写成乱码，文件还会多个 BOM。当前版本的脚本已经
> 改成按 UTF-8 原样读写，上面那条手工路子在任何版本上都安全。

## 出问题时

| 现象 | 怎么办 |
|---|---|
| 启动时只有背景色，没有画面 | 展开设置卡片看素材池那一行，有没有黄/红徽章；有就按上面的表处理 |
| 改了设置没反应 | 刷新页面。设置是下一次加载生效的 |
| 某次刷新不正常、但硬刷新正常 | 说明浏览器缓存里留了坏副本。现在素材已设为不可缓存，正常情况下不会再出现；出现就硬刷新一次（Ctrl+Shift+R）并告诉我 |
| 没有声音 | 先看设置里「播放影片声音」是不是被关掉了；没关就点一下画面。彻底免点击的办法：多点几次让 Chrome 记住这个站点，或在地址栏左侧「网站设置 → 声音」里改成**「允许」**（注意**「自动」不等于「允许」**） |
| 底部那行提示不见了 | 是「显示底部提示文字」被关掉了，打开即可；这只影响提示文字，标题和进度条一直都在 |
| 点一下就直接进去了 | 「点鼠标直接进入」被打开了（或声音关了，没有需要解锁的东西）。想恢复「第一下开声音」，把它关掉并确认「播放影片声音」是开的 |
| 找不到设置卡片 | 看 DSH 启动时的控制台有没有 `boot-animation:` 开头的黄色告警——有，就是插件旁边链接的 `@deepseek-ai/schemastery` 版本太旧（缺 `.volatile()`），照告警里那句话把链接指向内核那份；没有，就确认 DSH 重启过、卡片在「设置 → 插件 → 插件配置」里，是**收起的一行**，要点开 |
| 想看它到底在干什么 | 地址后面加 `?dshbootdiag=1`，画面底部会变成实时读数；卡片里那行素材信息也是同样用途 |

## 文件都在哪

**插件目录**（就是 `MANUAL.md` 所在这一层）里：

```
entry.js                 Host 半侧（不用管）
src\boot-screen.js       开机动画本体
src\client.js            设置卡片（改代码后要跑 build-client.mjs 重新出产物）
lib\client.js            上面那个的构建产物
assets\videos\           素材池 —— 你的视频放这里
assets\videos\originals\ 重排前的原片备份（不参与轮播）
tools\                   各种脚本（重排、诊断、安装/卸载）
cordis.patch.yml         让 DSH 认识这个插件的那一行
MANUAL.md                这份使用手册
INSTALL.md               安装说明（给别人看的）
AGENTS.md                维护简令（给接手的 AI / 人看）
README.md                开发记录（很长，出怪问题时再翻）
```

> 作者的开发副本比发布副本多一层：插件本体在 `package\` 子目录里，同层还有 `assets\ref\`（角色定妆图）、`prompts.md`（生成片头的提示词）和一个双击版装机入口。发布副本是平的，上面这张表就是全部。
