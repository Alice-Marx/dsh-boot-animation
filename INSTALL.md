# 安装说明（给别人看的）

> Current 0.4.0 installation commands, Desktop offline upgrades, permissions and compatibility are in [README.md](README.md). The optional link-based methods below are legacy alternatives. Import videos through the settings card to keep copies outside the installed package.

这是一份**可分享的副本**：解压后照下面做就能装上。全程不需要原作者的那台机器。

> 只是想自己用？看 [MANUAL.md](MANUAL.md)。想改代码？看 [AGENTS.md](AGENTS.md)。

## 你需要什么

| 条件 | 说明 |
|---|---|
| **DSH** | 实测于 `0.2.0-rc.2`。设置契约在这一版变过（插件改为声明 `Config`，不再注册命名空间），更旧的版本要用旧版插件。本包在 `package.json` 里声明了 `>=0.2.0-rc.2`，装到更旧的运行时会被官方安装器直接拒绝并说明原因 |
| **Node.js** | `^22.19.0` 或 `>=24`（DSH 自己就要求这个，通常已经有） |
| **git** | 只有「路 A 贴 GitHub 地址」才需要；贴 npm 包名或本地目录不需要 |
| 浏览器 | Chromium 内核（Chrome / Edge）。Firefox 没测过 |

## 安装：四条路，选一条

### 路 A：官方「添加插件」页面（推荐）

**设置 → 插件 → 添加插件**，在输入框里贴以下任意一种，等它装完、按提示重启：

| 贴什么 | 例子 |
|---|---|
| npm 包名 | `@ljwei-stak/dsh-boot-animation`（发布到 npm 后；装的是最新版） |
| GitHub 仓库地址 | `https://github.com/Alice-Marx/dsh-boot-animation`（简写 `github:Alice-Marx/dsh-boot-animation` 也行） |
| 本地目录 | 解压出来的那个目录的**绝对路径**（注意：pnpm 按「链接」处理，见下方警告） |
| 离线包 | `xxx.tgz` 的路径或网址 |

这条路装的是「包」：pnpm 会把依赖一起装好（包括设置卡片要用的 `@deepseek-ai/schemastery`），
DSH 会把这个包装进 profile 的插件层，**不需要手改任何配置文件**。桌面版和 `dsh web` 都能用。

> **本地目录这一路有个坑**：pnpm 把裸目录路径当成「链接」（`package.json` 里记成
> `link:C:/...`），它只建一个指向该目录的软链，**不会安装这个目录自己声明的依赖**。
> 所以那个目录必须已经是装好依赖的状态——先在目录里跑一次 `npm install`（或把整个
> 带 `node_modules` 的目录原样搬来），否则 `entry.js` 静态 import 的
> `@deepseek-ai/schemastery` 解析不到，插件装上也不会有任何反应。
> 只是体验一下的话，优先用 npm 包名 / GitHub / `.tgz` 这三种，那三条路依赖全自动。
> 另外链接是指向目录的：装完之后把那个目录删了或挪了，插件就一起没了。

> 从 GitHub 装需要机器上有 `git`；装完页面提示重启时重启一次，因为 `entry.js` 的改动
> 只有在 DSH 进程启动时才会加载。

### 路 B：官方命令（命令行，web profile）

```sh
dsh plugin --profile web add <解压出来的目录，或 npm 包名>
```

和路 A 是同一条官方通道（pnpm + 插件层对账），装完**重启一次 DSH**。

> 桌面版（DSH Desktop）的 profile 名叫 `desktop`，而这个命令不允许直接改它
> （会报 `profile "desktop" is managed exclusively by the Electron application`）。
> 桌面版请走路 A。

### 路 C：脚本（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

它自己找 DSH 的安装位置（先看环境变量 `DSH_HOME`，再找 `%USERPROFILE%\.dsh`），
在 profile 里建一个目录链接、追加一行配置，并**顺手把设置卡片需要的依赖链上**
（DSH 自带那份）。不碰 `package.json`，不跑 pnpm。

- 找不到 profile 会**明确报错并列出有哪些 profile**，不会乱写
- 装之前**自动备份** `cordis.patch.yml`
- 大多数 profile 会热加载（几秒内生效）；不热加载的，脚本会提醒你手动重启
- **撤销**：`powershell -ExecutionPolicy Bypass -File tools\uninstall.ps1 -ProfileName desktop`
  （桌面版 profile 叫 `desktop`，脚本默认找的是 `web`；详见下面的「卸掉」）

### 路 D：macOS / Linux（脚本）

```sh
sh tools/install.sh --profile desktop   # 桌面版（DSH Desktop 用的那个 profile）
sh tools/install.sh                     # dsh web 用的那个（默认就是 web）
```

和路 A / 路 B 走的不是同一条通道：它找 DSH 的位置（先看 `DSH_HOME`，再找 `~/.dsh`）、
在 profile 里建目录链接、追加一行配置，并把设置卡片需要的 `@deepseek-ai/schemastery` 链上
（DSH 自带那份，要 3.18.4 及以上）。**不跑 pnpm、不改 `package.json`。** 装完重启一次
（大多数 profile 会热加载，几秒内生效）。

- 找不到 profile 会**明确报错并列出有哪些 profile**，不会乱写
- 装之前**自动备份** `cordis.patch.yml`
- 已经作为 bundle 层挂着的机器上它会直接收工，不会挂出第二条同 id 的 entry
- 大多数 profile 会热加载（几秒内生效）；不热加载的，脚本会提醒你手动重启
- **撤销**：`sh tools/uninstall.sh`（`--profile` 同上）；它只摘掉自己追加的那行、删掉链接，
  并断言 `cordis.patch.yml` 回到安装前的字节

## 装完检查

1. **重启（或等几秒）后刷新浏览器**
2. 看到深海底背景 + 一条短片铺满窗口 → 装好了
3. 刷新后进 **设置 → 插件**，找到「启动动画」这一行（默认是收起的），点开：
   - 能看到「淡入时长 / 进入方式 / 素材池」三节 → 完全正常
   - **看不到这一行** → 设置卡片没注册上。贴 npm 包名 / GitHub 地址 / `.tgz` 装的话，
     `@deepseek-ai/schemastery` 是 pnpm 跟着装的（本包声明 `^3.18.4`），现有版本几乎不会
     遇到这个问题。只有「本地目录」路（link 语义不装依赖）和走路 C / 路 D（脚本链接）
     才可能是链接指错了副本：要 3.18.4 及以上，它才有 `Schema.prototype.volatile`，
     没有这个方法的旧副本会让卡片静默消失。
     看 DSH 控制台里 `boot-animation:` 开头的黄色告警，照那句话把链接换掉即可：
     把内核那份（随 DSH 一起发布、在 `app.asar` 里）解成盘上目录，再把
     `node_modules\@deepseek-ai\schemastery` 指过去。

**重启一次是必须的。** `entry.js` 的改动由 DSH 进程启动时加载；只刷新页面不会生效
（`src/boot-screen.js` 与素材不同，那两个刷新即可）。

## 换掉自带的片子

包里四段 mp4 是作者自己的动画，**随 MIT 一起给你**，你可以直接换：

1. 把你的视频丢进 `assets/videos/`（只认 `.mp4` `.webm` `.m4v` `.mov`；推荐 H.264 + AAC 的 mp4）
2. 打开设置卡片看素材池那一行——有黄色 **`未优化`** 徽章的话，双击
   `tools\apply-faststart.bat` 处理一下（原片自动备份到 `assets\videos\originals\`）
3. 刷新页面

不想留作者的片子，直接把那三个 `.mp4` 删掉再放自己的即可（池子空了也不会卡住，只是没有画面）。

## 卸掉

| 想要 | 怎么做 |
|---|---|
| 暂时不要动画 | 设置卡片里关掉「开启启动动画」 |
| 摘掉插件（走路 A / B 装的） | 官方「插件」页面上卸，或 `dsh plugin --profile web remove @ljwei-stak/dsh-boot-animation`，然后重启 |
| 摘掉插件（Windows，脚本装的） | `powershell -ExecutionPolicy Bypass -File tools\uninstall.ps1 -ProfileName desktop`（桌面版 profile 叫 `desktop`，默认找 `web`），然后刷新 |
| 摘掉插件（macOS / Linux，脚本装的） | `sh tools/uninstall.sh --profile desktop`，然后刷新 |
| 彻底删掉 | 先跑上面的卸载，再删掉整个目录 |

profile 是热加载的，摘掉后刷新页面就回到 DSH 原生启动页，不必重启。

**走路 C / 路 D（脚本链接）装的**，摘掉插件无非两件事：删掉 `cordis.patch.yml` 里那个
`- insert:` 块（它未必在文件末尾，DSH 自己会重排这一层，所以**搜 `boot-animation` 找，
别按位置找**），再删掉 profile 下的 `node_modules\@ljwei-stak\dsh-boot-animation` 链接
（用 `cmd /c rmdir`，它只删链接，不会跟到插件目录里）。不想跑脚本就手工这么来。
走路 A / 路 B 装的没有这两样东西——它就是个普通依赖，卸载由官方通道负责。

> 早先版本的 `uninstall.ps1` 不能用：它读回再写出 `cordis.patch.yml` 时按 ANSI 解码无 BOM 的
> UTF-8，会把你 profile 里的中文写成乱码并加上 BOM。当前版本已改成按 UTF-8 原样读写。

## 这份副本里没有什么

- **没有** `node_modules/`（依赖要现装）
- **没有** `assets/videos/originals/`（作者重排前的原片备份，对使用者无用）
- **没有**开发用的自检套件与安装脚本（`tools/verify-*`、`apply-boot-animation.ps1` 等）。
  那些绑定在作者的开发机上（要指向 DSH 源码 checkout），发出来只会让你困惑。
  要改代码看 [AGENTS.md](AGENTS.md)
- README.md 是作者的完整开发记录，里面会提到上面那些没随包发出来的脚本——那是历史记录，不是使用说明

## 许可

MIT，见 [LICENSE](LICENSE)。改、用、再分发都可以，保留版权声明即可。
